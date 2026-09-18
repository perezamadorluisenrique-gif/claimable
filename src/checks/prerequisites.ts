/**
 * Filter 4 — does the infrastructure the fix needs already exist?
 *
 * This is the filter that catches the expensive mistake: an issue labelled
 * "medium" whose real scope is "first build the five utility classes this
 * depends on". Maintainers label by the shape of the change, not by what is
 * missing underneath it, so the label is systematically optimistic.
 *
 * The approach is deliberately literal. An issue body that tells you what to do
 * almost always names paths — the file to change, the helper to reuse, the
 * directory to copy a pattern from. Each named path either exists in the
 * default branch or it does not, and every one that does not is work the issue
 * did not mention. Paths that do exist get their blob size reported, because
 * "port this file" reads very differently at 2 KB and at 65 KB.
 */

import { getIssue, getTree } from "../fetchers.ts";
import type { Finding, IssueRef, TreeEntry } from "../types.ts";
import type { RepoTree } from "../fetchers.ts";

/** Total bytes of referenced existing code above which this stops being small. */
const BIG_PORT_BYTES = 40_000;

/** Extensions common enough that a token ending in one is almost surely a path. */
const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|php|c|h|cc|cpp|cs|swift|scala|sh|sql|css|scss|html|vue|svelte|json|ya?ml|toml|md)$/i;

const NOISE = /^(https?:|www\.|@|#|\d+\.\d+)/;

/**
 * Pull path-shaped tokens out of an issue body.
 *
 * Only backticked spans and fenced-code lines are considered. Prose sentences
 * contain too many things that look like paths and are not ("i.e.", version
 * numbers, "and/or"), and a false path produces a false "this does not exist",
 * which is the worst possible output for a tool people are meant to trust.
 */
export function extractPaths(body: string): string[] {
  const out = new Set<string>();

  for (const match of body.matchAll(/`([^`\n]{2,200})`/g)) {
    // URLs go first. Splitting on ":" would otherwise tear a link into "https"
    // and "//github.com/owner/repo/wiki/Setup", and the second half is
    // indistinguishable from a repository path — which would then be reported
    // as a file that does not exist.
    const span = match[1].replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");

    for (const token of span.split(/[\s,;:()[\]{}'"<>]+/)) {
      const cleaned = token.replace(/^[./]+/, "").replace(/[.,;:]+$/, "");
      if (!cleaned || NOISE.test(cleaned)) continue;
      const looksLikePath = CODE_EXT.test(cleaned) || (cleaned.includes("/") && !cleaned.includes("//"));
      if (looksLikePath && cleaned.length > 3) out.add(cleaned);
    }
  }

  return [...out];
}

/** Resolve a mentioned path against the tree, tolerating repo-root prefixes. */
function resolve(path: string, byPath: Map<string, TreeEntry>, suffixIndex: Map<string, TreeEntry[]>): TreeEntry | "ambiguous" | null {
  const direct = byPath.get(path);
  if (direct) return direct;

  // Issues often quote a path relative to a subproject, or with the repo name
  // in front. Fall back to matching on the tail of the path.
  const candidates = suffixIndex.get(path.split("/").pop() ?? "") ?? [];
  const matching = candidates.filter((e) => e.path === path || e.path.endsWith(`/${path}`));
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) return "ambiguous";
  return null;
}

export async function checkPrerequisites(ref: IssueRef): Promise<Finding[]> {
  const issue = await getIssue(ref);
  const body = issue.body ?? "";
  const findings: Finding[] = [];

  const mentioned = extractPaths(body);
  if (mentioned.length === 0) {
    return [
      {
        check: "prerequisites",
        severity: "info",
        message: "the issue body names no file paths — scope cannot be checked automatically; read it before estimating",
        evidence: [issue.html_url],
      },
    ];
  }

  let tree: RepoTree;
  try {
    tree = await getTree(ref);
  } catch (err) {
    return [
      {
        check: "prerequisites",
        severity: "warning",
        message: `could not read the repository tree (${err instanceof Error ? err.message : String(err)}) — check the referenced paths by hand`,
      },
    ];
  }

  if (tree.entries.length === 0) {
    return [
      {
        check: "prerequisites",
        severity: "warning",
        message: "repository tree unavailable — cannot tell whether the referenced paths exist",
      },
    ];
  }

  const byPath = new Map<string, TreeEntry>(tree.entries.map((e) => [e.path, e]));
  const suffixIndex = new Map<string, TreeEntry[]>();
  for (const entry of tree.entries) {
    const base = entry.path.split("/").pop() ?? "";
    const list = suffixIndex.get(base);
    if (list) list.push(entry);
    else suffixIndex.set(base, [entry]);
  }

  const missing: string[] = [];
  const existing: TreeEntry[] = [];

  for (const path of mentioned) {
    const hit = resolve(path, byPath, suffixIndex);
    if (hit === null) missing.push(path);
    else if (hit !== "ambiguous" && hit.type === "blob") existing.push(hit);
  }

  if (tree.truncated) {
    findings.push({
      check: "prerequisites",
      severity: "warning",
      message: "the repository is too large to list in full — 'missing path' results below may be wrong",
    });
  } else if (missing.length > 0) {
    findings.push({
      check: "prerequisites",
      severity: missing.length >= 3 ? "warning" : "info",
      message: `${missing.length} path${missing.length > 1 ? "s" : ""} named in the issue do${missing.length > 1 ? "" : "es"} not exist on \`${ref.repo}\`'s default branch — that is unlisted work: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}`,
      evidence: [issue.html_url],
    });
  }

  const totalBytes = existing.reduce((sum, e) => sum + (e.size ?? 0), 0);
  if (totalBytes > BIG_PORT_BYTES) {
    const biggest = [...existing].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)).slice(0, 3);
    findings.push({
      check: "prerequisites",
      severity: "warning",
      message: `the files this issue points at total ${Math.round(totalBytes / 1024)} KB (largest: ${biggest.map((e) => `${e.path.split("/").pop()} ${Math.round((e.size ?? 0) / 1024)} KB`).join(", ")}) — whatever the difficulty label says, this is not a small change`,
      evidence: biggest.map((e) => `https://github.com/${ref.owner}/${ref.repo}/blob/HEAD/${e.path}`),
    });
  }

  if (findings.length === 0) {
    findings.push({
      check: "prerequisites",
      severity: "ok",
      message: `all ${mentioned.length} referenced path${mentioned.length > 1 ? "s" : ""} exist${mentioned.length > 1 ? "" : "s"}, ${Math.round(totalBytes / 1024)} KB total`,
    });
  }

  return findings;
}
