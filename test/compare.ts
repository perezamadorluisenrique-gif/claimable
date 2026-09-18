#!/usr/bin/env node
/**
 * Replay the fixtures and lay the tool's verdicts next to the hand ones.
 *
 * Deliberately not an assertion — this is the view you read when a
 * disagreement appears, to work out which side is wrong. The suite in
 * `ground-truth.test.ts` is the one that fails builds.
 */

import { analyze } from "../src/analyze.ts";
import { configure } from "../src/github.ts";
import { refToString } from "../src/types.ts";
import { expectedVerdict, GROUND_TRUTH, TRIAGE_DATE, TRIAGE_VIEWER } from "./ground-truth.ts";

process.env.CLAIMABLE_NOW = TRIAGE_DATE;
// The viewer is pinned rather than looked up: replayed fixtures must not depend
// on who is authenticated when the suite runs, and the person who did the hand
// triage is the one whose own comments should not count against them.
configure({
  cassetteMode: "replay",
  cassetteDir: "test/fixtures",
  token: null,
  viewer: TRIAGE_VIEWER,
});

let agree = 0;
let scored = 0;
let caughtMisses = 0;

for (const row of GROUND_TRUTH) {
  const report = await analyze(row.ref, { thorough: true });
  const expected = expectedVerdict(row);
  const blocker = report.findings.find((f) => f.severity === "blocker");

  if (row.drift) {
    process.stdout.write(
      ` drift  ${refToString(row.ref).padEnd(40)} hand=${row.verdict.padEnd(12)} tool=${report.verdict.padEnd(12)} ${row.drift}\n`,
    );
    continue;
  }

  scored++;
  const match = report.verdict === expected;
  if (match) agree++;
  if (match && row.correction) caughtMisses++;

  const tag = match ? (row.correction ? " CAUGHT" : "  ok  ") : " DIFFER";
  process.stdout.write(
    `${tag}  ${refToString(row.ref).padEnd(40)} hand=${row.verdict.padEnd(12)} tool=${report.verdict.padEnd(12)} ${blocker ? `[${blocker.check}] ` : ""}${report.reason}\n`,
  );
}

process.stdout.write(
  `\n${agree}/${scored} agree with the verified verdict` +
    `  ·  ${caughtMisses} signal${caughtMisses === 1 ? "" : "s"} the hand pass missed` +
    `  ·  ${GROUND_TRUTH.length - scored} excluded as drift\n`,
);
