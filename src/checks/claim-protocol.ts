/**
 * Filter 6 — what does this project make you do before it will take your work?
 *
 * Not a blocker, an invoice. Projects differ enormously in what stands between
 * a finished patch and a merged one, and the expensive requirements are never
 * in the issue title — they are in CONTRIBUTING.md or buried in step 5 of a
 * numbered list, which is exactly the text people skim.
 *
 * The extremes are worth knowing in advance. Some projects assign an issue the
 * moment you comment. Others require you to do the work first — migrate the
 * test, run it hundreds of times to prove it is not flaky, post the traces —
 * and only then consider assigning it to you. Both are reasonable; only one of
 * them fits in an afternoon.
 *
 * Matching is by *co-occurrence inside a window*, not by one long regex. Real
 * requirements are written across clauses, lines and list items ("...for 200
 * total runs (100 desktop + 100 mobile), to rule out flakiness before
 * requesting assignment"), and a single rigid pattern misses them while looking
 * like it works.
 */

import { getDocs, getIssue } from "../fetchers.ts";
import type { Finding, IssueRef } from "../types.ts";

type Rule = {
  id: string;
  /** All of these must appear, in order, inside `window` characters. */
  all: RegExp[];
  window: number;
  severity: "warning" | "info";
  describe: (quote: string) => string;
};

/**
 * Strip the things that break matching without carrying meaning: blockquote
 * markers, list bullets, markdown emphasis, and line breaks.
 */
export function normalise(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*>+\s?/, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""))
    .join(" ")
    // Emphasis and code fences go; underscores stay, because they are part of
    // the identifiers being quoted (`stress_test_acceptance_test.yml`).
    .replace(/[*`]+/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Find a span where every pattern matches in sequence within `window` chars.
 * Returns the matched span, trimmed for quoting, or null.
 */
export function matchWindow(text: string, patterns: RegExp[], window: number): string | null {
  const [first, ...rest] = patterns;
  const anchored = new RegExp(first.source, first.flags.includes("g") ? first.flags : `${first.flags}g`);

  for (const hit of text.matchAll(anchored)) {
    const start = hit.index ?? 0;
    const span = text.slice(start, start + window);

    let cursor = hit[0].length;
    let ok = true;
    for (const pattern of rest) {
      const tail = span.slice(cursor);
      const found = tail.match(pattern);
      if (!found || found.index === undefined) {
        ok = false;
        break;
      }
      cursor += found.index + found[0].length;
    }
    if (ok) return span.slice(0, cursor).trim();
  }
  return null;
}

const RULES: Rule[] = [
  {
    id: "work-first",
    all: [
      /\b(share|post|upload|attach|provide|submit)\b/i,
      /\b(trace|video|recording|screenshot|screencast|stress test link)\b/i,
      /\bassign/i,
    ],
    window: 400,
    severity: "warning",
    describe: (quote) =>
      `the work comes before the assignment here — you build it, show evidence, and only then get the issue: "${quote}"`,
  },
  {
    id: "assign-after-review",
    all: [/\b(we|maintainers?|reviewers?)\b/i, /\b(can|will|shall)\s+assign\b/i],
    window: 200,
    severity: "warning",
    describe: (quote) => `assignment is granted after review, not on request: "${quote}"`,
  },
  {
    id: "stress-runs",
    all: [/\b(stress[- ]test|flakiness|flaky)\b/i, /\b\d{2,4}\b/, /\b(runs?|executions?|iterations?|times)\b/i],
    window: 260,
    severity: "warning",
    describe: (quote) => `a stress-run requirement stands between your work and assignment: "${quote}"`,
  },
  {
    id: "stress-runs-reversed",
    all: [/\b\d{2,4}\s+(?:\w+\s+){0,2}(?:runs?|executions?|iterations?|times)\b/i, /\b(flak|stress|stability)/i],
    window: 200,
    severity: "warning",
    describe: (quote) => `a stress-run requirement is documented before your work is accepted: "${quote}"`,
  },
  {
    id: "cla",
    all: [/\b(contributor licen[cs]e agreement|CLA|DCO|developer certificate of origin|signed-off-by)\b/],
    window: 160,
    severity: "info",
    describe: (quote) =>
      `contributions require a signed agreement: "${quote}" — a one-time step, but it must be done before review`,
  },
  {
    id: "ai-disclosure",
    all: [/\b(disclose|declare|state|mention|label)\w*\b/i, /\b(ai|llm|copilot|chatgpt|claude|generative|assistant)\b/i],
    window: 140,
    severity: "warning",
    describe: (quote) =>
      `the project requires disclosing AI assistance: "${quote}" — not optional; skipping it can sink the PR and your standing in the project`,
  },
  {
    id: "checklist",
    all: [/\b(npm|pnpm|yarn|make|bundle|poetry|python)\s+(run\s+)?\w+/i, /\b(lint|format|test|build|check)\b/i],
    window: 120,
    severity: "info",
    describe: (quote) => `a pre-submission command checklist is documented: "${quote}"`,
  },
  {
    id: "comment-to-claim",
    all: [/\bcomment\b/i, /\bassign(ed)?\b/i],
    window: 120,
    severity: "info",
    describe: (quote) => `claiming looks lightweight — comment and a maintainer assigns it: "${quote}"`,
  },
];

function quote(span: string, max = 180): string {
  return span.length > max ? `${span.slice(0, max).trimEnd()}…` : span;
}

export async function checkClaimProtocol(ref: IssueRef): Promise<Finding[]> {
  const issue = await getIssue(ref);
  const docs = await getDocs(ref);
  const findings: Finding[] = [];

  // The issue body outranks the project docs when they disagree: a requirement
  // written into this specific issue is the one that will be enforced on it.
  const sources: [string, string][] = [
    [issue.html_url, normalise(issue.body ?? "")],
    ...[...docs].map(([path, content]): [string, string] => [
      `https://github.com/${ref.owner}/${ref.repo}/blob/HEAD/${path}`,
      normalise(content),
    ]),
  ];

  const seen = new Set<string>();
  for (const [url, text] of sources) {
    for (const rule of RULES) {
      // The two stress-run rules describe one requirement from two angles, and
      // "assign-after-review" is a weaker restatement of "work-first" — when
      // the stronger one fires, the weaker adds noise, not information.
      const family = rule.id.startsWith("stress-runs") ? "stress-runs" : rule.id;
      if (seen.has(family)) continue;
      if (rule.id === "assign-after-review" && seen.has("work-first")) continue;

      const span = matchWindow(text, rule.all, rule.window);
      if (!span) continue;

      seen.add(family);
      findings.push({
        check: "claim-protocol",
        severity: rule.severity,
        message: rule.describe(quote(span)),
        evidence: [url],
      });
    }
  }

  // "comment and you're assigned" and "we assign after review" are contradictory;
  // when both fire, the stricter one is the one that will be enforced.
  if (seen.has("assign-after-review") || seen.has("work-first")) {
    const index = findings.findIndex((f) => f.message.startsWith("claiming looks lightweight"));
    if (index >= 0) findings.splice(index, 1);
  }

  if (findings.length === 0) {
    findings.push({
      check: "claim-protocol",
      severity: docs.size === 0 ? "info" : "ok",
      message:
        docs.size === 0
          ? "no contributing docs found — ask in the thread how they want the issue claimed"
          : `no unusual claiming requirements found in ${[...docs.keys()].join(", ")}`,
    });
  }

  return findings;
}
