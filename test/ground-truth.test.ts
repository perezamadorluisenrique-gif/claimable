/**
 * Does the tool reach the same conclusions a careful person reached?
 *
 * Runs entirely off recorded fixtures, so it is deterministic and offline.
 * Re-record with `node test/record.ts` when the evaluation set changes.
 *
 * The assertions are asymmetric on purpose, because the two possible errors are
 * not equally bad:
 *
 *   - Saying "go ahead" about an issue that is actually taken costs somebody a
 *     weekend and a rejected PR. That is the error this suite forbids outright.
 *   - Saying "be careful" about a fine issue costs thirty seconds of reading.
 *     That is tolerated, counted, and reported.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { analyze } from "../src/analyze.ts";
import { configure } from "../src/github.ts";
import { refToString } from "../src/types.ts";
import { expectedVerdict, GROUND_TRUTH, TRIAGE_DATE, TRIAGE_VIEWER } from "./ground-truth.ts";

process.env.CLAIMABLE_NOW = TRIAGE_DATE;
process.env.NO_COLOR = "1";

function setup() {
  configure({
    cassetteMode: "replay",
    cassetteDir: "test/fixtures",
    token: null,
    viewer: TRIAGE_VIEWER,
  });
}

const scored = GROUND_TRUTH.filter((row) => !row.drift);
const softDisagreements: string[] = [];

describe("ground truth — hand-triaged issues, 2026-09-15", () => {
  for (const row of scored) {
    it(`${refToString(row.ref)} — hand said ${row.verdict}${row.correction ? ` (corrected to ${row.correction.verdict})` : ""}`, async () => {
      setup();
      const report = await analyze(row.ref, { thorough: true });
      const expected = expectedVerdict(row);

      if (expected === "discard") {
        // The unforgivable error: clearing an issue that is genuinely taken,
        // blocked, or dead. `reservations` is not good enough here — a caution
        // is something people click past.
        assert.equal(
          report.verdict,
          "discard",
          `expected a discard (${row.correction ? row.correction.evidence : row.reason}) but got "${report.verdict}": ${report.reason}`,
        );
        return;
      }

      // The issue was genuinely workable. Flagging it as risky is allowed;
      // ruling it out is not.
      assert.notEqual(
        report.verdict,
        "discard",
        `wrongly ruled out a workable issue: ${report.reason}`,
      );

      if (report.verdict !== "viable") {
        softDisagreements.push(`${refToString(row.ref)} — ${report.reason}`);
      }
    });
  }

  it("catches every signal the hand pass missed", async () => {
    const corrected = scored.filter((row) => row.correction);
    for (const row of corrected) {
      setup();
      const report = await analyze(row.ref, { thorough: true });
      assert.equal(
        report.verdict,
        row.correction!.verdict,
        `${refToString(row.ref)} was missed by hand (${row.correction!.evidence}) and is still missed by the tool`,
      );
    }
    assert.ok(corrected.length >= 4, "the evaluation set should retain its documented corrections");
  });

  after(() => {
    if (softDisagreements.length > 0) {
      process.stdout.write(
        `\n# ${softDisagreements.length} soft disagreement${softDisagreements.length === 1 ? "" : "s"} — flagged as risky where the hand pass said fine:\n` +
          softDisagreements.map((line) => `#   ${line}\n`).join(""),
      );
    }
  });
});
