/**
 * `--repo` paging, the progress line and GitHub Enterprise URLs, offline.
 *
 * The issue-list pages are synthetic and live only in a temporary directory;
 * the committed fixtures stay recordings of the real API.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { listRepoIssues, parseArgs, shouldShowProgress } from "../src/cli.ts";
import { apiBase, cassettePath, configure, webBase } from "../src/github.ts";
import { parseRef, parseRepo } from "../src/refs.ts";

const dir = mkdtempSync(join(tmpdir(), "claimable-scan-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A page of `size` results; every `prEvery`-th one is a pull request. */
function page(from: number, size: number, prEvery = 0) {
  return Array.from({ length: size }, (_, i) => {
    const number = from + i;
    return prEvery && number % prEvery === 0 ? { number, pull_request: {} } : { number };
  });
}

function record(pageNo: number, perPage: number, body: unknown): void {
  const path = `/repos/o/r/issues?state=open&per_page=${perPage}&page=${pageNo}`;
  writeFileSync(cassettePath(path), JSON.stringify({ path, status: 200, body }));
}

describe("listRepoIssues paging", () => {
  beforeEach(() => configure({ cassetteMode: "replay", cassetteDir: dir }));
  afterEach(() => configure({ cassetteMode: "off", cassetteDir: "test/fixtures" }));

  it("pages past 100 until it has the issues asked for", async () => {
    record(1, 100, page(1, 100));
    record(2, 100, page(101, 100));
    const refs = await listRepoIssues("o/r", [], 150);
    assert.equal(refs.length, 150);
    assert.equal(refs[149].number, 150);
  });

  it("counts issues, not results, when pull requests are mixed in", async () => {
    record(1, 30, page(1, 30, 2)); // 15 issues, 15 PRs
    record(2, 30, page(31, 30, 2));
    const refs = await listRepoIssues("o/r", [], 20);
    assert.equal(refs.length, 20);
    assert.ok(refs.every((r) => r.number % 2 === 1));
  });

  it("stops after the first page when it already has enough", async () => {
    record(1, 30, page(1, 30));
    // No page 2 is recorded, so asking for one would throw.
    assert.equal((await listRepoIssues("o/r", [], 10)).length, 10);
  });

  it("terminates when the repository has fewer issues than the limit", async () => {
    record(1, 100, page(1, 7));
    const refs = await listRepoIssues("o/r", [], 100);
    assert.equal(refs.length, 7);
  });
});

describe("shouldShowProgress", () => {
  it("shows for a terminal only", () => {
    assert.equal(shouldShowProgress({}, true, false), true);
    assert.equal(shouldShowProgress({}, false, false), false);
  });
  it("is off for --json and dumb terminals, but not for NO_COLOR", () => {
    assert.equal(shouldShowProgress({}, true, true), false);
    assert.equal(shouldShowProgress({ TERM: "dumb" }, true, false), false);
    assert.equal(shouldShowProgress({ NO_COLOR: "1" }, true, false), true);
  });
});

describe("API host", () => {
  const saved = process.env.GITHUB_API_URL;
  afterEach(() => {
    configure({ apiUrl: "" });
    if (saved === undefined) delete process.env.GITHUB_API_URL;
    else process.env.GITHUB_API_URL = saved;
  });

  it("defaults to github.com", () => {
    delete process.env.GITHUB_API_URL;
    assert.equal(apiBase(), "https://api.github.com");
    assert.equal(webBase(), "https://github.com");
  });

  it("reads GITHUB_API_URL and derives the web host from it", () => {
    process.env.GITHUB_API_URL = "https://ghe.example.com/api/v3/";
    assert.equal(apiBase(), "https://ghe.example.com/api/v3");
    assert.equal(webBase(), "https://ghe.example.com");
  });

  it("lets --api-url win over the environment", () => {
    process.env.GITHUB_API_URL = "https://ghe.example.com/api/v3";
    configure({ apiUrl: "https://api.acme.ghe.com" });
    assert.equal(apiBase(), "https://api.acme.ghe.com");
    assert.equal(webBase(), "https://acme.ghe.com");
    assert.equal(parseArgs(["--api-url", "https://x/api/v3", "o/r#1"]).apiUrl, "https://x/api/v3");
  });

  it("accepts issue URLs and repos from the Enterprise host as well as github.com", () => {
    configure({ apiUrl: "https://ghe.example.com/api/v3" });
    assert.deepEqual(parseRef("https://ghe.example.com/o/r/issues/4"), { owner: "o", repo: "r", number: 4 });
    assert.deepEqual(parseRef("https://github.com/o/r/issues/4"), { owner: "o", repo: "r", number: 4 });
    assert.deepEqual(parseRepo("https://ghe.example.com/o/r"), { owner: "o", repo: "r" });
  });
});
