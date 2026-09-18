/**
 * The evaluation set.
 *
 * These are not invented test cases. Every row is a decision that was made by
 * hand, one issue at a time, on 2026-09-15, while triaging candidate issues for
 * real contribution work — together with the reason recorded at the time.
 * Roughly one in six of the candidates that looked good on paper survived.
 *
 * That makes this the only honest way to judge the tool: not "does it run", but
 * "does it reach the same conclusions a careful person reached, for the same
 * reasons". A triage tool that agrees with nobody is a random number generator
 * with good typography.
 *
 * Two warnings about reading the results.
 *
 *   1. **Truth decays.** These verdicts were true on 2026-09-15. Issues get
 *      claimed, PRs get merged, repos go quiet. When the tool disagrees with a
 *      row, the tool is not automatically wrong — the row may simply be stale,
 *      which is itself the thing this tool exists to catch.
 *
 *   2. **Agreeing for the wrong reason is not agreeing.** Each row records the
 *      *reason*, not just the verdict, so that a coincidental match can be told
 *      apart from a real one.
 */

import type { IssueRef, Verdict } from "../src/types.ts";

export type GroundTruthRow = {
  ref: IssueRef;
  /** The verdict reached by hand on 2026-09-15. Never edited to match the tool. */
  verdict: Verdict;
  /** Which filter should have caught it. Null for issues that survived. */
  expectedCheck: string | null;
  /** The reason as recorded at the time, verbatim in substance. */
  reason: string;
  /**
   * Set when later verification proved the hand verdict wrong — the tool found
   * a signal that was already present on 2026-09-15 and was simply missed.
   * The original verdict above stays as written; rewriting it to match the tool
   * would turn this file into a mirror and the agreement rate into a tautology.
   */
  correction?: { verdict: Verdict; evidence: string };
  /**
   * Set when the world changed *after* the hand triage. Both verdicts were
   * right on their own date, so these rows are excluded from the score instead
   * of counted against either side.
   */
  drift?: string;
};

const ref = (slug: string): IssueRef => {
  const [owner, rest] = slug.split("/");
  const [repo, number] = rest.split("#");
  return { owner, repo, number: Number(number) };
};

export const GROUND_TRUTH: GroundTruthRow[] = [
  // ── Rejected: a pull request was already open, despite "unassigned" ──────────
  {
    ref: ref("ohcnetwork/create-care-mfe-plug#4"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR #6 already open; repo has had no push since November 2025",
  },
  {
    ref: ref("ohcnetwork/create-care-mfe-plug#3"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR #7 already open; repo has had no push since November 2025",
  },
  {
    ref: ref("ohcnetwork/care_fe#16609"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR #16610 already open",
  },
  {
    ref: ref("openfoodfacts/openfoodfacts-explorer#1659"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR already open",
  },
  {
    ref: ref("openfoodfacts/openfoodfacts-explorer#1658"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR already open",
  },
  {
    ref: ref("openfoodfacts/openfoodfacts-explorer#1654"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR already open",
  },

  // ── Rejected: the project said not to start ─────────────────────────────────
  {
    ref: ref("sugarlabs/musicblocks-v4#685"),
    verdict: "discard",
    expectedCheck: "blocked-label",
    reason: "labelled `on hold` — 'Do not work on this until marked ready'. Zero comments meant undefined, not unclaimed",
  },
  {
    ref: ref("sugarlabs/musicblocks-v4#628"),
    verdict: "discard",
    expectedCheck: "blocked-label",
    reason: "labelled `on hold`",
  },
  {
    ref: ref("sugarlabs/musicblocks-v4#681"),
    verdict: "discard",
    expectedCheck: "blocked-label",
    reason: "labelled `on hold`",
  },
  {
    ref: ref("sugarlabs/musicblocks-v4#678"),
    verdict: "discard",
    expectedCheck: "blocked-label",
    reason: "umbrella issue that explicitly asks for no PRs against it",
  },
  {
    ref: ref("sugarlabs/musicblocks-v4#679"),
    verdict: "discard",
    expectedCheck: "existing-pr",
    reason: "PR already open or already assigned",
  },

  // ── Rejected: the real scope was far larger than the label ──────────────────
  {
    ref: ref("oppia/oppia#26840"),
    verdict: "discard",
    expectedCheck: "prerequisites",
    reason:
      "labelled `Work: Medium`, but needs five user-role classes that do not exist on the Playwright side (~65 KB of Puppeteer code to port) plus seven missing methods; and the whole project requires WSL2, which this machine does not have. It was unclaimed because it was the hardest of the ten, not because it was available",
  },

  // ── Survived every filter on 2026-09-15 ─────────────────────────────────────
  {
    ref: ref("openfoodfacts/openfoodfacts-explorer#1416"),
    verdict: "viable",
    expectedCheck: null,
    reason: "language-code bug, no PR, repo pushed to the same day",
  },
  {
    ref: ref("openfoodfacts/openfoodfacts-explorer#1660"),
    verdict: "viable",
    expectedCheck: null,
    reason: "no competition found",
    correction: {
      verdict: "discard",
      evidence:
        "@pinankshah8-Aa claimed it in the thread on 2026-09-05 — ten days before the hand triage. The claim was there to be read and was not read.",
    },
  },
  {
    ref: ref("ohcnetwork/care_fe#16769"),
    verdict: "viable",
    expectedCheck: null,
    reason: "umbrella coverage tracker — contribute a test without competing for a specific issue",
  },
  {
    ref: ref("ohcnetwork/care_fe#16263"),
    verdict: "viable",
    expectedCheck: null,
    reason: "bounded CSS bug, no competition",
  },
  // Both of these looked alive by the usual proxy and were not. The repo was
  // pushed to on 2026-09-16 — the maintainers commit directly — while the last
  // outside contribution to land merged on 2026-04-07. `pushed_at` measures the
  // maintainers' activity, not whether your PR has anywhere to go.
  {
    ref: ref("hotosm/xlsform-builder#19"),
    verdict: "viable",
    expectedCheck: null,
    reason: "zero comments, tiny repo",
    correction: {
      verdict: "discard",
      evidence: "no pull request has been merged in this repo since 2026-04-07, despite recent direct pushes",
    },
  },
  {
    ref: ref("hotosm/xlsform-builder#22"),
    verdict: "viable",
    expectedCheck: null,
    reason: "zero comments, tiny repo",
    correction: {
      verdict: "discard",
      evidence: "no pull request has been merged in this repo since 2026-04-07, despite recent direct pushes",
    },
  },
  {
    ref: ref("frappe/lms#2711"),
    verdict: "viable",
    expectedCheck: null,
    reason: "zero comments, trivial change",
    correction: {
      verdict: "discard",
      evidence:
        "PR #2727 by @ajzal-byte was opened on 2026-09-10, five days before the hand triage. The issue still read 'unassigned' — which is exactly the trap this tool exists for.",
    },
  },
  {
    ref: ref("sugarlabs/musicblocks-v4#352"),
    verdict: "viable",
    expectedCheck: null,
    reason: "neither on hold nor already claimed",
  },
  {
    ref: ref("sugarlabs/musicblocks-v4#796"),
    verdict: "viable",
    expectedCheck: null,
    reason: "neither on hold nor already claimed",
    drift: "closed on 2026-09-18, three days after the hand triage — both verdicts were correct on their own date",
  },
];

/** The day the hand triage happened. Pins the clock when replaying fixtures. */
export const TRIAGE_DATE = "2026-09-15T12:00:00Z";

/**
 * Who was doing the triage. Pinned so that replayed fixtures do not depend on
 * whoever happens to be authenticated when the suite runs — and so the triager's
 * own comments are not counted as somebody else having claimed the issue.
 */
export const TRIAGE_VIEWER = "perezamadorluisenrique-gif";

/** The verdict a row should be scored against: the correction if one was proven. */
export function expectedVerdict(row: GroundTruthRow): Verdict {
  return row.correction ? row.correction.verdict : row.verdict;
}
