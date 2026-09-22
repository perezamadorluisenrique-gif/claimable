/**
 * The claim patterns, scored against every real comment in the fixtures.
 *
 * Asymmetric like the ground truth: a claim the patterns cannot read is the
 * error that clears a taken issue, so any miss fails the build. A comment
 * wrongly read as a claim costs a caution, so it is counted and printed.
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { isClaim } from "../src/checks/claimants.ts";
import type { GhComment } from "../src/types.ts";
import { CLAIM_CORPUS } from "./claim-corpus.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

const bodies = new Map<number, string>();
for (const file of readdirSync(FIXTURES).filter((f) => f.includes("-comments-per-page-"))) {
  const recorded = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as { body: GhComment[] | null };
  for (const comment of recorded.body ?? []) bodies.set(comment.id, comment.body ?? "");
}

const falsePositives: string[] = [];
let read = 0;
let claims = 0;

describe("claim corpus — every human comment in the fixtures", () => {
  it("labels every human comment the fixtures contain, so none is scored by omission", () => {
    const labelled = new Set(CLAIM_CORPUS.map((row) => row.id));
    for (const file of readdirSync(FIXTURES).filter((f) => f.includes("-comments-per-page-"))) {
      const recorded = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as { body: GhComment[] | null };
      for (const comment of recorded.body ?? []) {
        if (!comment.user || /\[bot\]$|^github-actions$/i.test(comment.user.login)) continue;
        assert.ok(labelled.has(comment.id), `comment ${comment.id} by @${comment.user.login} has no label in test/claim-corpus.ts`);
      }
    }
  });

  for (const row of CLAIM_CORPUS.filter((r) => r.label !== "ambiguous")) {
    it(`${row.label === "claim" ? "reads" : "does not read"} "${row.note}"`, () => {
      const body = bodies.get(row.id);
      assert.ok(body !== undefined, `comment ${row.id} is not in the fixtures`);
      const got = isClaim(body);
      if (row.label === "claim") {
        claims++;
        if (got) read++;
        assert.equal(got, true, `missed a real claim: "${row.note}"`);
      } else if (got) {
        falsePositives.push(row.note);
      }
    });
  }

  after(() => {
    process.stdout.write(
      `\n# claim patterns: ${read}/${claims} real claims read, ${falsePositives.length} non-claim${falsePositives.length === 1 ? "" : "s"} misread as a claim\n` +
        falsePositives.map((note) => `#   misread: ${note}\n`).join(""),
    );
  });
});
