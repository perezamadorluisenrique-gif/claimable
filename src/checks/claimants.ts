/**
 * Filter 3b — has a human already called it?
 *
 * Two corrections to the obvious version of this check are baked in:
 *
 *   - **Comment count is not a signal.** Many comments can mean contested, or
 *     it can mean an active umbrella issue where six people are each working a
 *     different file. Counting comments gets that backwards, so this check
 *     reads them instead.
 *
 *   - **Silence is a red flag, not an opportunity.** An easy issue in a busy
 *     repo gets claimed in days. One that has sat untouched for months in an
 *     active repo is usually sitting there for a reason: it is harder than its
 *     label says, or blocked on something unwritten. Maintainer difficulty
 *     labels are not reliable; the market of other contributors is.
 */

import { daysSince, getComments, getIssue, getRepo } from "../fetchers.ts";
import { viewerLogin } from "../github.ts";
import type { Finding, GhComment, IssueRef } from "../types.ts";

const CLAIM_PATTERNS = [
  /\bi(?:'|’)?(?:ll| will| am going to| would like to| want to| wanna)\s+(?:work on|take|pick|handle|do|try)\b/i,
  /\bi(?:'|’)?m\s+working\s+on\s+(?:this|it)\b/i,
  /\bcan\s+i\s+(?:work\s+on|take|be\s+assigned)\b/i,
  /\b(?:please\s+)?assign\s+(?:this\s+)?(?:to\s+)?me\b/i,
  /\bmay\s+i\s+(?:work\s+on|take)\b/i,
  /\bclaim(?:ing)?\s+this\b/i,
  /\bi(?:'|’)?d\s+like\s+to\s+(?:work\s+on|take|contribute)\b/i,
  /\bon\s+it\b/i,
  /\btaking\s+this\s+(?:one|up)\b/i,
];

/** A claim nobody followed through on stops being a blocker after this long. */
const CLAIM_GOES_STALE_DAYS = 21;

/** How long an issue must sit untouched in a live repo before silence is suspicious. */
const SUSPICIOUS_SILENCE_DAYS = 180;

const BOT = /\[bot\]$|^(github-actions|dependabot|renovate|codecov|oppiabot|welcome)/i;

export function isClaim(body: string | null): boolean {
  if (!body) return false;
  // Quoted text is someone else's words, not a claim by this commenter.
  const withoutQuotes = body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  return CLAIM_PATTERNS.some((p) => p.test(withoutQuotes));
}

function humanComments(comments: GhComment[]): GhComment[] {
  return comments.filter((c) => c.user && !BOT.test(c.user.login));
}

export async function checkClaimants(ref: IssueRef): Promise<Finding[]> {
  const issue = await getIssue(ref);
  const findings: Finding[] = [];
  const me = await viewerLogin();
  const isMe = (login: string) => me !== null && login.toLowerCase() === me.toLowerCase();

  const assignees = (issue.assignees ?? []).filter((a) => a !== null);
  if (assignees.length > 0) {
    const mine = assignees.every((a) => isMe(a!.login));
    findings.push({
      check: "claimants",
      severity: mine ? "ok" : "blocker",
      message: mine
        ? "assigned to you"
        : `already assigned to ${assignees.map((a) => `@${a!.login}`).join(", ")}`,
      evidence: [issue.html_url],
    });
  }

  const comments = await getComments(ref);
  const people = humanComments(comments);
  const claims = people.filter((c) => isClaim(c.body));

  const fresh = claims.filter((c) => daysSince(c.created_at) <= CLAIM_GOES_STALE_DAYS);
  const stale = claims.filter((c) => daysSince(c.created_at) > CLAIM_GOES_STALE_DAYS);

  for (const claim of fresh) {
    const login = claim.user!.login;
    findings.push({
      check: "claimants",
      severity: isMe(login) ? "ok" : "blocker",
      message: isMe(login)
        ? `you claimed this yourself ${Math.round(daysSince(claim.created_at))} days ago`
        : `@${login} claimed it ${Math.round(daysSince(claim.created_at))} days ago`,
      evidence: [claim.html_url],
    });
  }

  const staleByOthers = stale.filter((c) => !isMe(c.user!.login));
  if (staleByOthers.length > 0) {
    const latest = staleByOthers.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    findings.push({
      check: "claimants",
      severity: "warning",
      message: `${staleByOthers.length} stale claim${staleByOthers.length > 1 ? "s" : ""}, the most recent by @${latest.user!.login} ${Math.round(daysSince(latest.created_at))} days ago with no PR — probably abandoned, but say so in the thread before starting`,
      evidence: [latest.html_url],
    });
  }

  // Silence in a busy repo is evidence about difficulty, not availability.
  if (claims.length === 0 && people.length === 0) {
    const age = daysSince(issue.created_at);
    if (age > SUSPICIOUS_SILENCE_DAYS) {
      const repo = await getRepo(ref);
      const repoIdle = daysSince(repo.pushed_at);
      if (repoIdle < 30) {
        findings.push({
          check: "claimants",
          severity: "warning",
          message: `open ${Math.round(age / 30)} months with no human comment, in a repo pushed to ${Math.round(repoIdle)} days ago — easy issues do not survive that long here; assume it is harder than its labels say`,
          evidence: [issue.html_url],
        });
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      check: "claimants",
      severity: "ok",
      message:
        people.length === 0
          ? "nobody has commented"
          : `${people.length} human comment${people.length > 1 ? "s" : ""}, none of them a claim`,
    });
  }

  return findings;
}
