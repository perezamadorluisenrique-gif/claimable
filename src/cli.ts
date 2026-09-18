#!/usr/bin/env node
/**
 * claimable — is this GitHub issue actually claimable?
 *
 * Run before you start work, not after.
 */

import { analyze } from "./analyze.ts";
import { api, hasToken, requestCount } from "./github.ts";
import { parseRefs, parseRepo } from "./refs.ts";
import { formatDetail, formatLine, formatSummary } from "./report.ts";
import { CHECK_ORDER } from "./types.ts";
import type { CheckId, GhIssue, IssueRef, IssueReport } from "./types.ts";

const USAGE = `
claimable — tells you whether a GitHub issue is actually claimable.

  "unassigned" is not the same as "free". This runs the checks that a careful
  contributor runs by hand: is the repo alive, is a PR already open against the
  issue, is it on hold or an umbrella, has someone claimed it in the thread,
  does the fix depend on code that does not exist yet, can you even build the
  project, and what does the project demand before it accepts your work.

USAGE
  claimable <issue> [<issue> ...]
  claimable --repo <owner/repo> [--label <label>] [--limit <n>]

ISSUE FORMS
  owner/repo#123
  https://github.com/owner/repo/issues/123

OPTIONS
  --repo <owner/repo>   Scan open issues in a repository instead of named ones
  --label <label>       With --repo: only issues carrying this label (repeatable)
  --limit <n>           With --repo: how many issues to scan (default 20)
  --thorough            Run every filter even after one rules an issue out
  --skip <check>        Skip a filter (repeatable). One of:
                        ${CHECK_ORDER.join(", ")}
  --json                Machine-readable output
  --quiet               One line per issue, no detail
  --viable-only         Print only issues that survive every filter
  -h, --help            This text

EXIT CODES
  0  at least one issue is viable (or, with a single issue, it is viable)
  1  nothing viable
  2  usage or network error
`;

type Options = {
  refs: string[];
  repo: string | null;
  labels: string[];
  limit: number;
  thorough: boolean;
  skip: CheckId[];
  json: boolean;
  quiet: boolean;
  viableOnly: boolean;
  help: boolean;
};

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    refs: [],
    repo: null,
    labels: [],
    limit: 20,
    thorough: false,
    skip: [],
    json: false,
    quiet: false,
    viableOnly: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--repo":
        opts.repo = next();
        break;
      case "--label":
        opts.labels.push(next());
        break;
      case "--limit": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) throw new Error("--limit needs a positive integer");
        opts.limit = value;
        break;
      }
      case "--thorough":
        opts.thorough = true;
        break;
      case "--skip": {
        const value = next() as CheckId;
        if (!CHECK_ORDER.includes(value)) {
          throw new Error(`unknown check "${value}" — expected one of ${CHECK_ORDER.join(", ")}`);
        }
        opts.skip.push(value);
        break;
      }
      case "--json":
        opts.json = true;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "--viable-only":
        opts.viableOnly = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option "${arg}"`);
        opts.refs.push(arg);
    }
  }

  return opts;
}

async function listRepoIssues(repo: string, labels: string[], limit: number): Promise<IssueRef[]> {
  const parsed = parseRepo(repo);
  if (!parsed) throw new Error(`--repo expects owner/repo, got "${repo}"`);

  const params = new URLSearchParams({ state: "open", per_page: String(Math.min(limit, 100)) });
  if (labels.length > 0) params.set("labels", labels.join(","));

  const issues = await api<GhIssue[]>(`/repos/${parsed.owner}/${parsed.repo}/issues?${params}`);
  return issues
    .filter((issue) => !issue.pull_request) // this endpoint returns PRs too
    .slice(0, limit)
    .map((issue) => ({ owner: parsed.owner, repo: parsed.repo, number: issue.number }));
}

async function main(argv: string[]): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\nRun claimable --help\n`);
    return 2;
  }

  if (opts.help || (opts.refs.length === 0 && opts.repo === null)) {
    process.stdout.write(USAGE);
    return opts.help ? 0 : 2;
  }

  let targets: IssueRef[] = [];

  if (opts.repo) {
    targets = await listRepoIssues(opts.repo, opts.labels, opts.limit);
    if (targets.length === 0) {
      process.stderr.write(`No open issues found in ${opts.repo}${opts.labels.length ? ` with label(s) ${opts.labels.join(", ")}` : ""}.\n`);
      return 1;
    }
  } else {
    const { refs, invalid } = parseRefs(opts.refs);
    if (invalid.length > 0) {
      process.stderr.write(`Could not parse: ${invalid.join(", ")}\nExpected owner/repo#123 or a GitHub issue URL.\n`);
      return 2;
    }
    targets = refs;
  }

  if (!hasToken() && targets.length > 3 && !opts.json) {
    process.stderr.write(
      "Note: no GitHub token found, so this runs at 60 requests/hour and may stop partway.\n" +
        "      Run `gh auth login` or set GITHUB_TOKEN to raise that to 5000.\n\n",
    );
  }

  const reports: IssueReport[] = [];
  for (const ref of targets) {
    // Sequential on purpose. Parallel requests trip GitHub's secondary rate
    // limit, and scanning forty issues slightly slower beats being blocked for
    // an hour halfway through.
    const report = await analyze(ref, { thorough: opts.thorough, skip: opts.skip });
    reports.push(report);

    if (opts.json) continue;
    if (opts.viableOnly && report.verdict !== "viable") continue;
    process.stdout.write(opts.quiet ? `${formatLine(report)}\n` : formatDetail(report));
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  } else if (reports.length > 1) {
    process.stdout.write(formatSummary(reports));
    if (process.env.CLAIMABLE_DEBUG) {
      process.stdout.write(`${requestCount()} API requests\n`);
    }
  }

  return reports.some((r) => r.verdict === "viable") ? 0 : 1;
}

const invokedDirectly = process.argv[1] && import.meta.filename === process.argv[1];
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    });
}

export { main };
