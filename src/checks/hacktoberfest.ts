/**
 * Opt-in, with `--hacktoberfest`: will a pull request here count?
 *
 * Not one of the seven filters, because it does not ask whether the work is
 * free — it asks whether the work is worth something to a participant. The
 * rule is Hacktoberfest's own (hacktoberfest.com/participation): a PR counts
 * only if the repository carries the `hacktoberfest` topic, or a maintainer
 * labels the PR `hacktoberfest-accepted`; and only if it is opened between
 * October 1 and October 31.
 *
 * A repository without the topic is a warning rather than a blocker. The fix
 * may be every bit as valuable, and a maintainer can still accept it into
 * the event — but a participant should know that before the weekend, not
 * after the merge.
 */

import { getIssue, getRepo, now } from "../fetchers.ts";
import { labelNames } from "./blocked-label.ts";
import type { Finding, IssueRef } from "../types.ts";

const RULES = "https://hacktoberfest.com/participation/";

/** Is `at` inside the event, in any time zone on Earth (UTC-12 to UTC+14)? */
export function duringHacktoberfest(at: number): boolean {
  const year = new Date(at).getUTCFullYear();
  const opens = Date.UTC(year, 9, 1) - 14 * 3_600_000;
  const closes = Date.UTC(year, 10, 1) + 12 * 3_600_000;
  return at >= opens && at < closes;
}

export async function checkHacktoberfest(ref: IssueRef): Promise<Finding[]> {
  const repo = await getRepo(ref);
  const issue = await getIssue(ref);
  const findings: Finding[] = [];
  const repoUrl = `https://github.com/${ref.owner}/${ref.repo}`;

  if ((repo.topics ?? []).some((t) => t.toLowerCase() === "hacktoberfest")) {
    findings.push({
      check: "hacktoberfest",
      severity: "ok",
      message: "the repository carries the `hacktoberfest` topic, so an accepted PR here counts",
      evidence: [repoUrl],
    });
  } else {
    findings.push({
      check: "hacktoberfest",
      severity: "warning",
      message:
        "the repository does not carry the `hacktoberfest` topic — a PR here counts only if a maintainer labels it `hacktoberfest-accepted`, so ask before you start",
      evidence: [repoUrl, RULES],
    });
  }

  const label = labelNames(issue.labels).find((name) => /hacktoberfest/i.test(name));
  if (label) {
    findings.push({
      check: "hacktoberfest",
      severity: "info",
      message: `labelled \`${label}\` — the maintainers picked this one for the event`,
      evidence: [issue.html_url],
    });
  }

  if (!duringHacktoberfest(now())) {
    findings.push({
      check: "hacktoberfest",
      severity: "info",
      message: "Hacktoberfest counts pull requests opened October 1–31; one opened today would not count",
      evidence: [RULES],
    });
  }

  return findings;
}
