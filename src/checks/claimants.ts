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

/**
 * What a claim sounds like, grouped by what the commenter is doing.
 *
 * Written against the real comments in the evaluation fixtures rather than
 * against what claims ought to sound like. The first version of this list was
 * the obvious one, and it missed eight of the thirty claims in those threads:
 * "kindly assign this issue to me", "I would like to request assignment", "I'd
 * be interested in working on this", "can i contribute for this issue". Every
 * one of those is somebody who will be surprised to find a stranger's PR on
 * their issue, and a miss here is the direction that costs a weekend.
 * `test/claim-corpus.ts` holds the labelled set and fails the build if a claim
 * in it goes unread again.
 *
 * `I` has to be the subject. "Is anyone working on this?" is the most common
 * newcomer comment there is, and it is a question about a claim, not one.
 */

/** Whatever may sit between "I" and the verb, as long as it does not change who acts. */
const GAP = String.raw`(?:(?!\b(?:anyone|someone|somebody|you|whoever|they|if|not|never)\b)[^.?!\n]){0,40}?`;
const FIRST_PERSON = String.raw`\b(?:i|i['’]d|i['’]m|im|i['’]ll)\b`;
const WORK = String.raw`(?:work(?:ing)?|tak(?:e|ing)(?!\s+a\s+look)|pick(?:ing)?|handl(?:e|ing)|fix(?:ing)?|solv(?:e|ing)|tackl(?:e|ing)|contribut(?:e|ing)|implement(?:ing)?)`;
const THIS = String.raw`(?:this|it|that|the\s+issue|this\s+(?:issue|one|task|bug))`;

const CLAIM_PATTERNS = [
  // Intent: "I would like to work on", "I am a new contributor and would like to
  // work on", "I'd be interested in working on", "i wanna take".
  new RegExp(
    `${FIRST_PERSON}${GAP}\\b(?:like|love|want|wish|happy|glad|keen|interested|eager|planning|willing)\\s+(?:to|in)\\s+${WORK}\\b`,
    "i",
  ),
  /\bi\s+wanna\s+(?:work|take|pick|fix|do)\b/i,

  // Asking for it: "can i take over", "could I please be assigned?", "may I work".
  new RegExp(
    `\\b(?:can|could|may|shall)\\s+i\\s+(?:please\\s+)?(?:${WORK}|help|get\\s+assigned|be\\s+assigned|have\\s+${THIS})\\b`,
    "i",
  ),
  /\bassign\s+(?:this\s+issue|this\s+one|the\s+issue|this|it)?\s*(?:to\s+)?me\b/i,
  /\bassigned\s+to\s+me\b/i,
  /\brequest(?:ing)?\s+(?:to\s+be\s+)?assign(?:ment|ed)\b/i,

  // Declaring it: "I'll pick it up", "im currently working on it", "let me take this".
  new RegExp(
    `\\b(?:i['’]ll|i\\s+will|i\\s+am\\s+going\\s+to|i['’]m\\s+going\\s+to|i\\s+can|let\\s+me)\\s+(?:work\\s+on|take|pick|pick\\s+up|handle|fix|solve|tackle|do|improve)\\s+${THIS}\\b`,
    "i",
  ),
  /\b(?:i['’]?m|im|i\s+am)\s+(?:(?!not\b|no\b)\w+\s+){0,2}?working\s+on\s+(?:this|it|that|the\s+issue)\b/i,
  /\bi(?:['’]ve|\s+have)?\s+(?:already\s+)?(?:started|begun|began)\s+(?:working\s+on|on)\b/i,
  /\b(?:claim(?:ing)?|taking)\s+this\b/i,
  // "on it" only as the whole reply ("sure, on it", "I'm on it!") — inside a
  // sentence it is "comment on it", "depends on it", "based on it".
  /(?:^|[\n.!])\s*(?:@[\w-]+[\s,]*)*(?:(?:i['’]?m|im|i\s+am|sure|ok(?:ay)?|yes|yep)[,!.]?\s+)?on\s+it\b\s*(?:[.!,:;)]|$)/im,

  // Already done: "i have made a pull request".
  /\bi(?:['’]ve|\s+have)\s+(?:already\s+|just\s+)?(?:made|opened|raised|created|submitted|sent)\s+(?:a|the|my)\s+(?:pull\s*request|pr)\b/i,
];

/**
 * Taking it back. Only ever read from a *later* comment by the same person who
 * claimed: a claim that hedges in the same breath ("if you are still on this I
 * will step aside, otherwise I will pick it up") is still a claim.
 */
const RETRACTION_PATTERNS = [
  /\b(?:i['’]?m|im|i\s+am)\s+(?:no\s+longer|not)\s+(?:\w+\s+)?working\s+on\s+(?:this|it)\b/i,
  /\b(?:please\s+)?un-?assign\s+me\b/i,
  /\bfeel\s+free\s+to\s+(?:take|pick|work\s+on|re-?assign)\b/i,
  /\b(?:won['’]?t|will\s+not|can['’]?t|cannot|unable\s+to)\s+(?:be\s+able\s+to\s+)?(?:work\s+on|continue|finish|complete|take)\b/i,
  /\b(?:dropping|releasing|abandoning|unclaiming|leaving)\s+(?:this|it)\b/i,
  /\bsomeone\s+else\s+(?:can|could|may|should)\s+(?:take|pick|work)\b/i,
  /\bstep(?:ping)?\s+(?:aside|back|down)\b/i,
];

/** Quoted text is someone else's words, and code is nobody's. */
function ownWords(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

export function isClaim(body: string | null): boolean {
  if (!body) return false;
  const text = ownWords(body);
  return CLAIM_PATTERNS.some((p) => p.test(text));
}

export function isRetraction(body: string | null): boolean {
  if (!body) return false;
  const text = ownWords(body);
  return RETRACTION_PATTERNS.some((p) => p.test(text)) && !isClaim(body);
}

/** A claim nobody followed through on stops being a blocker after this long. */
const CLAIM_GOES_STALE_DAYS = 21;

/** How long an issue must sit untouched in a live repo before silence is suspicious. */
const SUSPICIOUS_SILENCE_DAYS = 180;

const BOT = /\[bot\]$|^(github-actions|dependabot|renovate|codecov|oppiabot|welcome)/i;

function humanComments(comments: GhComment[]): GhComment[] {
  return comments.filter((c) => c.user && !BOT.test(c.user.login));
}

/**
 * Each person's latest claim, unless they later took it back.
 *
 * One entry per person: someone who claims and then posts three progress
 * updates is one claimant, not four, and the latest claim is the one whose age
 * says whether they are still at it.
 */
export function standingClaims(comments: GhComment[]): {
  claims: GhComment[];
  withdrawn: { claim: GhComment; retraction: GhComment }[];
} {
  const ordered = [...comments].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const latest = new Map<string, GhComment>();
  const retracted = new Map<string, GhComment>();

  for (const comment of ordered) {
    const login = comment.user?.login.toLowerCase();
    if (!login) continue;
    if (isClaim(comment.body)) {
      latest.set(login, comment);
      retracted.delete(login);
    } else if (latest.has(login) && isRetraction(comment.body)) {
      retracted.set(login, comment);
    }
  }

  const claims: GhComment[] = [];
  const withdrawn: { claim: GhComment; retraction: GhComment }[] = [];
  for (const [login, claim] of latest) {
    const retraction = retracted.get(login);
    if (retraction) withdrawn.push({ claim, retraction });
    else claims.push(claim);
  }
  return { claims, withdrawn };
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
  const { claims, withdrawn } = standingClaims(people);

  for (const { claim, retraction } of withdrawn) {
    if (isMe(claim.user!.login)) continue;
    findings.push({
      check: "claimants",
      severity: "info",
      message: `@${claim.user!.login} claimed it and then withdrew ${Math.round(daysSince(retraction.created_at))} days ago`,
      evidence: [retraction.html_url],
    });
  }

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
      message: `${staleByOthers.length} stale claim${staleByOthers.length > 1 ? "s" : ""}, the most recent by @${latest.user!.login} ${Math.round(daysSince(latest.created_at))} days ago and no open PR linked to the issue — probably abandoned, but say so in the thread before starting`,
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
