#!/usr/bin/env node
/**
 * Re-record the API fixtures the test suite replays.
 *
 * Run deliberately, never automatically:
 *
 *   node test/record.ts
 *
 * Recording talks to the live API, so the fixtures capture the state of those
 * issues *on the day you run it*. That is the point: the suite then runs
 * offline and deterministically, instead of quietly changing its mind whenever
 * somebody on the other side of the world opens a pull request.
 */

import { mkdirSync, rmSync } from "node:fs";
import { analyze } from "../src/analyze.ts";
import { configure, requestCount } from "../src/github.ts";
import { refToString } from "../src/types.ts";
import { GROUND_TRUTH } from "./ground-truth.ts";

const DIR = "test/fixtures";

async function record(): Promise<void> {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  configure({ cassetteMode: "record", cassetteDir: DIR });

  for (const row of GROUND_TRUTH) {
    process.stdout.write(`recording ${refToString(row.ref)} … `);
    try {
      // Thorough on purpose: short-circuiting would leave later filters without
      // fixtures, and the suite could then never exercise them.
      const report = await analyze(row.ref, { thorough: true });
      process.stdout.write(`${report.verdict}\n`);
    } catch (err) {
      process.stdout.write(`FAILED — ${err instanceof Error ? err.message : String(err)}\n`);
    }
    // The client resets its in-process memo per configure() call only, so clear
    // it between issues to force every request to be written to disk.
    configure({ cassetteMode: "record", cassetteDir: DIR });
  }

  process.stdout.write(`\nDone. ${requestCount()} API requests recorded into ${DIR}/\n`);
}

record().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
