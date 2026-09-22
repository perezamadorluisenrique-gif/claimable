/**
 * `--hacktoberfest` against recorded repositories: one that carries the topic
 * and one that does not.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { analyze } from "../src/analyze.ts";
import { configure } from "../src/github.ts";

process.env.CLAIMABLE_NOW = "2026-10-05T12:00:00Z";

function setup() {
  configure({ cassetteMode: "replay", cassetteDir: "test/fixtures", token: null, viewer: null });
}

describe("--hacktoberfest", () => {
  it("clears a repository that carries the topic", async () => {
    setup();
    const report = await analyze({ owner: "oppia", repo: "oppia", number: 26840 }, { hacktoberfest: true });
    const finding = report.findings.find((f) => f.check === "hacktoberfest");
    assert.equal(finding?.severity, "ok", finding?.message);
  });

  it("warns about a repository without it, even when the issue is ruled out anyway", async () => {
    setup();
    const report = await analyze({ owner: "hotosm", repo: "xlsform-builder", number: 19 }, { hacktoberfest: true });
    const finding = report.findings.find((f) => f.check === "hacktoberfest");
    assert.equal(finding?.severity, "warning");
    assert.match(finding!.message, /hacktoberfest-accepted/);
    assert.ok(finding!.evidence?.includes("https://hacktoberfest.com/participation/"));
  });

  it("stays out of the way unless asked for", async () => {
    setup();
    const report = await analyze({ owner: "hotosm", repo: "xlsform-builder", number: 19 });
    assert.equal(report.findings.some((f) => f.check === "hacktoberfest"), false);
  });

  it("says so when today is outside the event", async () => {
    setup();
    process.env.CLAIMABLE_NOW = "2026-09-15T12:00:00Z";
    const report = await analyze({ owner: "oppia", repo: "oppia", number: 26840 }, { hacktoberfest: true });
    process.env.CLAIMABLE_NOW = "2026-10-05T12:00:00Z";
    assert.ok(report.findings.some((f) => f.check === "hacktoberfest" && /October 1–31/.test(f.message)));
  });
});
