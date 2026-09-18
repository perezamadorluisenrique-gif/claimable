/**
 * Filter 1 — is the repository alive?
 *
 * The cheapest and most decisive check, and the one people skip. A perfect PR
 * against a repo nobody reads is not a contribution, it is a diary entry.
 *
 * `pushed_at` alone is a weak proxy: a bot bumping dependencies keeps it fresh
 * on an otherwise abandoned project. So this also measures the thing you
 * actually care about — do pull requests from outside get merged here, and how
 * long does it take.
 */

import { daysSince, getRecentPulls, getRepo, median } from "../fetchers.ts";
import type { Finding, IssueRef } from "../types.ts";

const STALE_DAYS = 90;
const SLUGGISH_DAYS = 30;

export async function checkRepoAlive(ref: IssueRef): Promise<Finding[]> {
  const repo = await getRepo(ref);
  const findings: Finding[] = [];
  const repoUrl = `https://github.com/${ref.owner}/${ref.repo}`;

  if (repo.archived) {
    return [
      {
        check: "repo-alive",
        severity: "blocker",
        message: "the repository is archived — it accepts no pull requests at all",
        evidence: [repoUrl],
      },
    ];
  }

  if (repo.disabled) {
    return [
      {
        check: "repo-alive",
        severity: "blocker",
        message: "the repository is disabled",
        evidence: [repoUrl],
      },
    ];
  }

  const idleDays = daysSince(repo.pushed_at);
  const lastPush = repo.pushed_at ? repo.pushed_at.slice(0, 10) : "unknown";

  if (idleDays > STALE_DAYS) {
    findings.push({
      check: "repo-alive",
      severity: "blocker",
      message: `no push in ${Math.round(idleDays)} days (last: ${lastPush}) — a PR here is unlikely to ever be reviewed`,
      evidence: [`${repoUrl} — pushed_at ${repo.pushed_at}`],
    });
  } else if (idleDays > SLUGGISH_DAYS) {
    findings.push({
      check: "repo-alive",
      severity: "warning",
      message: `no push in ${Math.round(idleDays)} days (last: ${lastPush})`,
      evidence: [`${repoUrl} — pushed_at ${repo.pushed_at}`],
    });
  }

  // The harder question: does review happen, or only commits by the core team?
  const recent = await getRecentPulls(ref);
  const merged = recent.filter((p) => p.merged_at !== null);

  if (recent.length === 0) {
    findings.push({
      check: "repo-alive",
      severity: "warning",
      message: "no closed pull requests found — no evidence that PRs get reviewed here",
      evidence: [`${repoUrl}/pulls?q=is%3Apr+is%3Aclosed`],
    });
  } else if (merged.length === 0) {
    findings.push({
      check: "repo-alive",
      severity: "blocker",
      message: `the last ${recent.length} closed PRs were all closed without merging — contributions are not landing here`,
      evidence: [`${repoUrl}/pulls?q=is%3Apr+is%3Aclosed`],
    });
  } else {
    const latencies = merged
      .map((p) => (Date.parse(p.merged_at as string) - Date.parse(p.created_at)) / 86_400_000)
      .filter((d) => Number.isFinite(d) && d >= 0);
    const typical = median(latencies);
    const mergeRate = merged.length / recent.length;
    const lastMerge = daysSince(
      merged.map((p) => p.merged_at as string).sort().reverse()[0],
    );

    if (lastMerge > STALE_DAYS) {
      findings.push({
        check: "repo-alive",
        severity: "blocker",
        message: `nothing has been merged in ${Math.round(lastMerge)} days`,
        evidence: [`${repoUrl}/pulls?q=is%3Apr+is%3Amerged`],
      });
    } else if (mergeRate < 0.3) {
      findings.push({
        check: "repo-alive",
        severity: "warning",
        message: `only ${Math.round(mergeRate * 100)}% of recently closed PRs were merged — most contributions get rejected or abandoned here`,
        evidence: [`${repoUrl}/pulls?q=is%3Apr+is%3Aclosed`],
      });
    }

    if (Number.isFinite(typical)) {
      findings.push({
        check: "repo-alive",
        severity: typical > 60 ? "warning" : "info",
        message: `median time from PR opened to merged: ${typical.toFixed(0)} days (${merged.length}/${recent.length} of recent PRs merged)`,
        evidence: [`${repoUrl}/pulls?q=is%3Apr+is%3Amerged`],
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      check: "repo-alive",
      severity: "ok",
      message: `active — last push ${lastPush}`,
    });
  }

  return findings;
}
