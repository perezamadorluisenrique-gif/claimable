/**
 * `claimable -`: references piped in, one per line, the way `gh` and `jq`
 * print them.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { parseArgs, refsFromText } from "../src/cli.ts";

const CLI = resolve(import.meta.dirname, "../src/cli.ts");

describe("refsFromText", () => {
  it("takes the first reference on each line and reports the lines with none", () => {
    const { found, unreadable } = refsFromText(
      "https://github.com/frappe/lms/issues/2711\n\n" +
        "oppia/oppia#26840\tMigrate acceptance tests\n" +
        "#12 no repository here\r\n",
    );
    assert.deepEqual(found, ["https://github.com/frappe/lms/issues/2711", "oppia/oppia#26840"]);
    assert.deepEqual(unreadable, ["#12 no repository here"]);
  });
});

describe("claimable -", () => {
  it("is an argument of its own, not an unknown option", () => {
    assert.equal(parseArgs(["-"]).stdin, true);
  });

  it("checks what is piped in", () => {
    const run = spawnSync(process.execPath, [CLI, "-", "--quiet"], {
      input: "https://github.com/frappe/lms/issues/2711\nohcnetwork/create-care-mfe-plug#4\n",
      encoding: "utf8",
      env: { ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_NOW: "2026-09-15T12:00:00Z", NO_COLOR: "1", GITHUB_TOKEN: "", GH_TOKEN: "" },
      cwd: resolve(import.meta.dirname, ".."),
    });
    assert.match(run.stdout, /DISCARD\s+frappe\/lms#2711/);
    assert.match(run.stdout, /DISCARD\s+ohcnetwork\/create-care-mfe-plug#4/);
    assert.equal(run.status, 1, run.stderr);
  });

  it("fails as a usage error when nothing usable comes in", () => {
    const run = spawnSync(process.execPath, [CLI, "-"], { input: "nothing to see\n", encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /No issue references came in/);
  });
});
