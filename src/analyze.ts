/**
 * The orchestrator: run the filters in order and turn them into one verdict.
 *
 * Order matters and is not cosmetic. The filters are sequenced cheapest-and-most
 * decisive first, exactly as they are when run by hand, so that scanning a list
 * of forty issues spends its request budget on the ones still in the running.
 * Pass `thorough` to run every filter anyway — useful when you want the full
 * picture of one issue rather than a fast triage of many.
 */

import { checkBlockedLabel } from "./checks/blocked-label.ts";
import { checkClaimants } from "./checks/claimants.ts";
import { checkExistingPr } from "./checks/existing-pr.ts";
import { checkRepoAlive } from "./checks/repo-alive.ts";
import { checkPrerequisites } from "./checks/prerequisites.ts";
import { checkEnvironment } from "./checks/environment.ts";
import { checkClaimProtocol } from "./checks/claim-protocol.ts";
import { checkHacktoberfest } from "./checks/hacktoberfest.ts";
import { getIssue } from "./fetchers.ts";
import { HttpError } from "./github.ts";
import { CHECK_ORDER, refToString } from "./types.ts";
import type { CheckId, Finding, IssueRef, IssueReport, Verdict } from "./types.ts";

type CheckFn = (ref: IssueRef) => Promise<Finding[]>;

const CHECKS: Record<Exclude<CheckId, "hacktoberfest">, CheckFn> = {
  "repo-alive": checkRepoAlive,
  "existing-pr": checkExistingPr,
  "blocked-label": checkBlockedLabel,
  claimants: checkClaimants,
  prerequisites: checkPrerequisites,
  environment: checkEnvironment,
  "claim-protocol": checkClaimProtocol,
};

export type AnalyzeOptions = {
  /** Run every filter even after one has already ruled the issue out. */
  thorough?: boolean;
  /** Filters to skip entirely. */
  skip?: CheckId[];
  /** Also ask whether a PR here would count for Hacktoberfest. */
  hacktoberfest?: boolean;
};

export async function analyze(ref: IssueRef, opts: AnalyzeOptions = {}): Promise<IssueReport> {
  const findings: Finding[] = [];
  const skipped: { check: CheckId; why: string }[] = [];
  const skipSet = new Set(opts.skip ?? []);

  let title = refToString(ref);
  let url = `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`;

  try {
    const issue = await getIssue(ref);
    title = issue.title;
    url = issue.html_url;
    if (issue.pull_request) {
      return {
        ref,
        title,
        url,
        verdict: "discard",
        reason: "this is a pull request, not an issue",
        findings: [],
        skipped: [],
      };
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return {
        ref,
        title,
        url,
        verdict: "discard",
        reason: "issue not found (deleted, transferred, or a private repo you cannot read)",
        findings: [],
        skipped: [],
      };
    }
    throw err;
  }

  for (const id of CHECK_ORDER) {
    if (skipSet.has(id)) {
      skipped.push({ check: id, why: "skipped by request" });
      continue;
    }

    const alreadyRuledOut = findings.some((f) => f.severity === "blocker");
    if (alreadyRuledOut && !opts.thorough) {
      skipped.push({ check: id, why: "not run — already ruled out by an earlier filter" });
      continue;
    }

    try {
      findings.push(...(await CHECKS[id](ref)));
    } catch (err) {
      // A filter that cannot run must say so. Silently treating an unreachable
      // check as a pass is how a triage tool starts lying.
      skipped.push({
        check: id,
        why: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Run whatever the seven decided: whether a PR would count is worth knowing
  // even about an issue that is ruled out, if only to pick the next one from
  // the same repository.
  if (opts.hacktoberfest) {
    try {
      findings.push(...(await checkHacktoberfest(ref)));
    } catch (err) {
      skipped.push({ check: "hacktoberfest", why: err instanceof Error ? err.message : String(err) });
    }
  }

  const { verdict, reason } = decide(findings, skipped);
  return { ref, title, url, verdict, reason, findings, skipped };
}

export function decide(
  findings: Finding[],
  skipped: { check: CheckId; why: string }[],
): { verdict: Verdict; reason: string } {
  const blocker = findings.find((f) => f.severity === "blocker");
  if (blocker) return { verdict: "discard", reason: blocker.message };

  const warnings = findings.filter((f) => f.severity === "warning");
  if (warnings.length > 0) {
    const extra = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : "";
    return { verdict: "reservations", reason: warnings[0].message + extra };
  }

  const unrun = skipped.filter((s) => !s.why.startsWith("not run") && s.why !== "skipped by request");
  if (unrun.length > 0) {
    return {
      verdict: "reservations",
      reason: `${unrun.length} filter${unrun.length > 1 ? "s" : ""} could not run (${unrun.map((s) => s.check).join(", ")}) — verify those by hand`,
    };
  }

  return { verdict: "viable", reason: "no blockers found — but read the thread before you start" };
}
