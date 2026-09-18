/**
 * Filter 2 — is someone already fixing it?
 *
 * This is the trap that makes `no:assignee` useless as a search filter. GitHub
 * does not assign an issue to whoever opens a PR against it, so an issue can
 * read "unassigned" while a finished, open PR has been sitting on it for weeks.
 *
 * The reliable signal is the issue *timeline*, which records every cross
 * reference from a pull request. Text search is only a fallback, because the
 * search index lags and has its own much tighter rate limit.
 */

import { getIssue, getTimeline } from "../fetchers.ts";
import { HttpError, search } from "../github.ts";
import type { Finding, IssueRef } from "../types.ts";

type LinkedPull = {
  number: number;
  url: string;
  state: string;
  merged: boolean;
  author: string;
};

export async function checkExistingPr(ref: IssueRef): Promise<Finding[]> {
  const findings: Finding[] = [];
  const issue = await getIssue(ref);

  if (issue.state === "closed") {
    return [
      {
        check: "existing-pr",
        severity: "blocker",
        message: "the issue is closed",
        evidence: [issue.html_url],
      },
    ];
  }

  const linked = new Map<number, LinkedPull>();

  let timelineFailed = false;
  try {
    const timeline = await getTimeline(ref);
    for (const event of timeline) {
      if (event.event !== "cross-referenced" && event.event !== "connected") continue;
      const source = event.source?.issue;
      if (!source || !source.pull_request) continue;
      linked.set(source.number, {
        number: source.number,
        url: source.pull_request.html_url || source.html_url,
        state: source.state,
        merged: source.pull_request.merged_at !== null,
        author: source.user?.login ?? "unknown",
      });
    }
  } catch (err) {
    // The timeline endpoint 404s on some very old issues and can 403 on repos
    // with restricted metadata. Fall through to search rather than pretending
    // the check passed.
    timelineFailed = err instanceof HttpError;
    if (!timelineFailed) throw err;
  }

  if (linked.size === 0) {
    try {
      const found = await search<{ number: number; html_url: string; state: string; title: string; user?: { login: string }; pull_request?: { merged_at: string | null } }>(
        "issues",
        `repo:${ref.owner}/${ref.repo} is:pr is:open ${ref.number}`,
        10,
      );
      for (const item of found.items) {
        if (item.number === ref.number) continue;
        linked.set(item.number, {
          number: item.number,
          url: item.html_url,
          state: item.state,
          merged: item.pull_request?.merged_at != null,
          author: item.user?.login ?? "unknown",
        });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        findings.push({
          check: "existing-pr",
          severity: "warning",
          message: `could not confirm whether an open PR already fixes this (${err.message}) — check by hand`,
          evidence: [`gh pr list --repo ${ref.owner}/${ref.repo} --state open --search "${ref.number}"`],
        });
      } else {
        throw err;
      }
    }
  }

  const openPulls = [...linked.values()].filter((p) => p.state === "open");
  const mergedPulls = [...linked.values()].filter((p) => p.merged);

  for (const pull of openPulls) {
    findings.push({
      check: "existing-pr",
      severity: "blocker",
      message: `PR #${pull.number} by @${pull.author} is already open against this issue`,
      evidence: [pull.url],
    });
  }

  for (const pull of mergedPulls) {
    findings.push({
      check: "existing-pr",
      severity: "warning",
      message: `PR #${pull.number} was already merged but the issue is still open — it may be partly fixed, or reopened for a remainder`,
      evidence: [pull.url],
    });
  }

  if (findings.length === 0) {
    findings.push({
      check: "existing-pr",
      severity: "ok",
      message: timelineFailed
        ? "no linked pull request found via search (timeline unavailable)"
        : "no pull request references this issue",
    });
  }

  return findings;
}
