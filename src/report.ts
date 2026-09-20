/**
 * Turning reports into something a person reads at 1 a.m. and believes.
 *
 * Two rules the output obeys:
 *   - Never state a verdict without the reason next to it.
 *   - Never state a reason without somewhere to go and check it.
 */

import type { CheckId, Finding, IssueReport, Severity } from "./types.ts";
import { refToString } from "./types.ts";

/**
 * Colour is for terminals, not for files — but "is this a terminal?" is the
 * wrong question when the output is being piped somewhere that renders it
 * anyway (`less -R`, a CI log, a recorded demo). So the two standard overrides
 * win over the TTY check in both directions, `NO_COLOR` first.
 *
 * Exported pure so the precedence is testable without a pseudo-terminal.
 */
export function shouldUseColour(
  env: Record<string, string | undefined>,
  isTTY: boolean,
): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  if (env.CLICOLOR_FORCE !== undefined) return env.CLICOLOR_FORCE !== "0";
  return isTTY;
}

const useColour = shouldUseColour(process.env, process.stdout.isTTY === true);

const ESC = String.fromCharCode(27);
const paint = (code: string, text: string) => (useColour ? `${ESC}[${code}m${text}${ESC}[0m` : text);

const dim = (t: string) => paint("2", t);
const bold = (t: string) => paint("1", t);
const red = (t: string) => paint("31", t);
const yellow = (t: string) => paint("33", t);
const green = (t: string) => paint("32", t);

const MARK: Record<Severity, string> = {
  blocker: red("×"),
  warning: yellow("!"),
  info: dim("·"),
  ok: green("✓"),
};

const CHECK_LABEL: Record<CheckId, string> = {
  "repo-alive": "repo alive",
  "existing-pr": "existing PR",
  "blocked-label": "blocked / umbrella",
  claimants: "claimants",
  prerequisites: "prerequisites",
  environment: "environment",
  "claim-protocol": "claim protocol",
};

function verdictLabel(report: IssueReport): string {
  if (report.verdict === "discard") return red(bold("DISCARD"));
  if (report.verdict === "reservations") return yellow(bold("CAUTION"));
  return green(bold("VIABLE "));
}

/** One line per issue — the scan view. */
export function formatLine(report: IssueReport): string {
  const ref = bold(refToString(report.ref).padEnd(38));
  return `${verdictLabel(report)}  ${ref}  ${dim(report.reason)}`;
}

/** Everything known about one issue — the inspect view. */
export function formatDetail(report: IssueReport, opts: { showOk?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${verdictLabel(report)}  ${bold(refToString(report.ref))}  ${report.title}`);
  lines.push(`         ${dim(report.url)}`);
  lines.push("");
  lines.push(`  ${bold("Why:")} ${report.reason}`);
  lines.push("");

  const shown = opts.showOk
    ? report.findings
    : report.findings.filter((f) => f.severity !== "ok" || report.verdict === "viable");

  const byCheck = new Map<CheckId, Finding[]>();
  for (const finding of shown) {
    const list = byCheck.get(finding.check);
    if (list) list.push(finding);
    else byCheck.set(finding.check, [finding]);
  }

  for (const [check, findings] of byCheck) {
    lines.push(`  ${dim(CHECK_LABEL[check])}`);
    for (const finding of findings) {
      lines.push(`    ${MARK[finding.severity]} ${finding.message}`);
      for (const evidence of finding.evidence ?? []) {
        lines.push(`      ${dim(evidence)}`);
      }
    }
  }

  // Filters that could not run are listed, always. A check that silently did
  // not happen is indistinguishable from a check that passed, and that is the
  // one way this tool could quietly mislead someone.
  const notRun = report.skipped.filter((s) => !s.why.startsWith("not run"));
  const shortCircuited = report.skipped.filter((s) => s.why.startsWith("not run"));

  if (notRun.length > 0) {
    lines.push("");
    lines.push(`  ${yellow("Could not check:")}`);
    for (const skip of notRun) {
      lines.push(`    ${yellow("?")} ${CHECK_LABEL[skip.check]} — ${skip.why}`);
    }
  }

  if (shortCircuited.length > 0) {
    lines.push("");
    lines.push(
      dim(`  Not run (already ruled out): ${shortCircuited.map((s) => CHECK_LABEL[s.check]).join(", ")} — use --thorough to run them anyway`),
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function formatSummary(reports: IssueReport[]): string {
  const viable = reports.filter((r) => r.verdict === "viable").length;
  const caution = reports.filter((r) => r.verdict === "reservations").length;
  const discard = reports.filter((r) => r.verdict === "discard").length;
  return dim(
    `\n${reports.length} checked — ${green(`${viable} viable`)}, ${yellow(`${caution} caution`)}, ${red(`${discard} discard`)}\n`,
  );
}
