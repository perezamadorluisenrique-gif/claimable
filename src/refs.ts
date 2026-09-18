/**
 * Parsing the handful of ways people actually write down an issue.
 *
 * Accepting only one canonical form would mean every user hand-edits URLs
 * copied from a browser, which is exactly the friction that stops a triage tool
 * from being used before starting work rather than after.
 */

import type { IssueRef } from "./types.ts";

const NAME = "[A-Za-z0-9._-]+";

const FORMS: RegExp[] = [
  // https://github.com/owner/repo/issues/123  (also /pull/123 — rejected later,
  // with an explanation, rather than silently parsed as an issue)
  new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${NAME})/(${NAME})/(?:issues|pull)/(\\d+)`, "i"),
  // owner/repo#123
  new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`),
  // owner/repo/123
  new RegExp(`^(${NAME})/(${NAME})/(\\d+)$`),
];

export function parseRef(input: string): IssueRef | null {
  const trimmed = input.trim().replace(/[?#].*$/, (m) => (m.startsWith("#") ? m : ""));
  for (const form of FORMS) {
    const match = trimmed.match(form);
    if (match) {
      return { owner: match[1], repo: match[2], number: Number(match[3]) };
    }
  }
  return null;
}

export type ParsedRefs = { refs: IssueRef[]; invalid: string[] };

export function parseRefs(inputs: string[]): ParsedRefs {
  const refs: IssueRef[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const ref = parseRef(input);
    if (!ref) {
      invalid.push(input);
      continue;
    }
    const key = `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }

  return { refs, invalid };
}

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
  const match = trimmed.match(new RegExp(`^(${NAME})/(${NAME})/?$`));
  return match ? { owner: match[1], repo: match[2] } : null;
}
