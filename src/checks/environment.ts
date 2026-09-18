/**
 * Filter 5 — can this even be built on the machine you have?
 *
 * Asked before cloning, not after. A project that requires WSL2 on a Windows
 * box without WSL2 installed is not a hard issue, it is an impossible one until
 * an unrelated afternoon is spent on the machine — and that cost belongs in the
 * decision, not in the surprise.
 *
 * The setup docs also confess things worth catching: instructions the project
 * itself marks as broken, disk and RAM floors, and toolchains that only work on
 * one OS.
 */

import { getDocs, getIssue } from "../fetchers.ts";
import type { Finding, IssueRef } from "../types.ts";

type Signal = {
  id: string;
  pattern: RegExp;
  /** Platforms on which this requirement actually costs something. */
  costlyOn?: NodeJS.Platform[];
  severity: "warning" | "info";
  describe: (hit: string) => string;
};

const SIGNALS: Signal[] = [
  {
    id: "wsl",
    pattern: /\b(wsl\s*2?|windows subsystem for linux)\b/i,
    costlyOn: ["win32"],
    severity: "warning",
    describe: () =>
      "setup requires WSL2 — on Windows that means an admin-rights install, a reboot, and several GB before you can run a single test",
  },
  {
    id: "docker",
    pattern: /\b(docker|docker[- ]compose|devcontainer)\b/i,
    severity: "info",
    describe: () => "setup involves Docker",
  },
  {
    id: "linux-only",
    pattern: /\b(linux|ubuntu|macos)[- ]only\b|only (supported|works) on (linux|ubuntu|macos)/i,
    costlyOn: ["win32"],
    severity: "warning",
    describe: (hit) => `the docs say the toolchain is restricted: "${hit.trim()}"`,
  },
  {
    id: "broken-docs",
    pattern: /(these|the) instructions are (currently )?not working|currently (broken|not supported)|do not use these instructions/i,
    severity: "warning",
    describe: (hit) => `the project's own setup docs say they are broken: "${hit.trim()}"`,
  },
  {
    id: "disk",
    pattern: /\b(\d{2,3})\s*(gb|gib)\b[^.\n]{0,40}(disk|space|storage|free)/i,
    severity: "info",
    describe: (hit) => `a disk-space floor is documented: "${hit.trim()}"`,
  },
  {
    id: "ram",
    pattern: /\b(\d{1,3})\s*(gb|gib)\b[^.\n]{0,30}(ram|memory)/i,
    severity: "info",
    describe: (hit) => `a memory floor is documented: "${hit.trim()}"`,
  },
];

/** Setup instructions that live somewhere this tool cannot read. */
const EXTERNAL_DOCS =
  /https?:\/\/(?:github\.com\/[^/\s)]+\/[^/\s)]+\/wiki[^\s)]*|[^\s)]*readthedocs[^\s)]*|[^\s)]*\.gitbook\.io[^\s)]*|docs\.[^\s)]+)/i;

export async function checkEnvironment(ref: IssueRef): Promise<Finding[]> {
  const docs = await getDocs(ref);
  const issue = await getIssue(ref);
  const findings: Finding[] = [];

  if (docs.size === 0 && !issue.body) {
    return [
      {
        check: "environment",
        severity: "info",
        message: "no CONTRIBUTING/README found — setup cost unknown, check the repo before cloning",
      },
    ];
  }

  const seen = new Set<string>();

  // The issue body is read alongside the docs: setup constraints specific to
  // one piece of work are stated there, not in CONTRIBUTING.
  const sources: [string, string][] = [
    [`issue #${ref.number}`, issue.body ?? ""],
    ...[...docs].map(([path, content]): [string, string] => [path, content]),
  ];

  for (const [path, content] of sources) {
    for (const signal of SIGNALS) {
      if (seen.has(signal.id)) continue;
      const hit = content.match(signal.pattern);
      if (!hit) continue;
      seen.add(signal.id);

      const costly = !signal.costlyOn || signal.costlyOn.includes(process.platform);
      findings.push({
        check: "environment",
        severity: costly ? signal.severity : "info",
        message: costly
          ? signal.describe(hit[0])
          : `${signal.describe(hit[0])} (not a cost on ${process.platform})`,
        evidence: [
          path.startsWith("issue #")
            ? issue.html_url
            : `https://github.com/${ref.owner}/${ref.repo}/blob/HEAD/${path}`,
        ],
      });
    }
  }

  // Saying "no heavy setup found" when the setup guide is a wiki page would be
  // a confident answer to a question that was never actually asked. Projects
  // that keep installation docs outside the repo — Oppia is one — get an honest
  // "not checked" instead of a false all-clear.
  let external: string | null = null;
  for (const [, content] of sources) {
    const hit = content.match(EXTERNAL_DOCS);
    if (hit) {
      external = hit[0];
      break;
    }
  }

  if (external && findings.every((f) => f.severity === "info")) {
    findings.push({
      check: "environment",
      severity: "warning",
      message: `setup instructions live outside the repository (${external}) — this filter only reads files in the repo, so the real setup cost is unverified`,
      evidence: [external],
    });
  }

  if (findings.length === 0) {
    findings.push({
      check: "environment",
      severity: "ok",
      message:
        docs.size > 0
          ? `no heavy setup requirements found in ${[...docs.keys()].join(", ")}`
          : "no setup docs in the repo to check",
    });
  }

  return findings;
}
