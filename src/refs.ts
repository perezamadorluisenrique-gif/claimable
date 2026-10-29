/**
 * Parsing the handful of ways people actually write down an issue.
 *
 * Accepting only one canonical form would mean every user hand-edits URLs
 * copied from a browser, which is exactly the friction that stops a triage tool
 * from being used before starting work rather than after.
 */

import { webBase } from "./github.ts";
import type { IssueRef } from "./types.ts";

const NAME = "[A-Za-z0-9._-]+";

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `github\.com`, or the Enterprise host when GITHUB_API_URL / --api-url points elsewhere. */
function hostPattern(): string {
  const web = webBase().replace(/^https?:\/\//, "");
  return web === "github.com" ? "github\\.com" : `(?:github\\.com|${escapeRe(web)})`;
}

const urlForm = () =>
  // https://github.com/owner/repo/issues/123  (also /pull/123 — rejected later,
  // with an explanation, rather than silently parsed as an issue)
  new RegExp(`^(?:https?://)?(?:www\\.)?${hostPattern()}/(${NAME})/(${NAME})/(?:issues|pull)/(\\d+)`, "i");

const SHORT_FORMS: RegExp[] = [
  // owner/repo#123
  new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`),
  // owner/repo/123
  new RegExp(`^(${NAME})/(${NAME})/(\\d+)$`),
];

export function parseRef(input: string): IssueRef | null {
  const trimmed = input.trim().replace(/[?#].*$/, (m) => (m.startsWith("#") ? m : ""));
  for (const form of [urlForm(), ...SHORT_FORMS]) {
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
  const trimmed = input.trim().replace(new RegExp(`^(?:https?://)?(?:www\\.)?${hostPattern()}/`, "i"), "");
  const match = trimmed.match(new RegExp(`^(${NAME})/(${NAME})/?$`));
  return match ? { owner: match[1], repo: match[2] } : null;
}
