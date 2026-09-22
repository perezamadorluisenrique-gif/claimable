/**
 * `--find`, end to end, offline.
 *
 * The search response here is the one synthetic payload in the suite, and it
 * lives only in a temporary directory for the length of the test: the
 * committed fixtures stay recordings of the real API. Everything the filters
 * read after the search is those recordings.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { buildFindQuery, parseArgs, refFromSearchHit } from "../src/cli.ts";
import { cassettePath, configure } from "../src/github.ts";

const ROOT = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "claimable-find-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("buildFindQuery", () => {
  it("adds the exclusions that would otherwise waste a scan", () => {
    assert.equal(
      buildFindQuery("label:hacktoberfest language:rust"),
      "label:hacktoberfest language:rust is:issue is:open no:assignee archived:false",
    );
  });

  it("leaves alone anything the caller already decided", () => {
    assert.equal(
      buildFindQuery("is:issue state:open assignee:octocat archived:true repo:a/b"),
      "is:issue state:open assignee:octocat archived:true repo:a/b",
    );
  });
});

describe("refFromSearchHit", () => {
  it("recovers owner and repo from the API URL a search hit carries", () => {
    assert.deepEqual(refFromSearchHit({ number: 7, repository_url: "https://api.github.com/repos/frappe/lms" }), {
      owner: "frappe",
      repo: "lms",
      number: 7,
    });
  });
});

describe("parseArgs --find", () => {
  it("takes the query as one argument", () => {
    const opts = parseArgs(["--find", 'label:"good first issue" language:go', "--limit", "5"]);
    assert.equal(opts.find, 'label:"good first issue" language:go');
    assert.equal(opts.limit, 5);
  });
});

describe("claimable --find", () => {
  const query = 'label:"good first issue"';
  const hits = [
    { number: 2711, repository_url: "https://api.github.com/repos/frappe/lms" },
    { number: 4, repository_url: "https://api.github.com/repos/ohcnetwork/create-care-mfe-plug" },
  ];

  cpSync(join(ROOT, "test/fixtures"), dir, { recursive: true });
  configure({ cassetteDir: dir });
  const path = `/search/issues?q=${encodeURIComponent(buildFindQuery(query))}&per_page=2&page=1`;
  writeFileSync(cassettePath(path), JSON.stringify({ path, status: 200, body: { total_count: 2, items: hits } }));
  configure({ cassetteDir: "test/fixtures" });

  const run = spawnSync(process.execPath, [join(ROOT, "src/cli.ts"), "--find", query, "--limit", "2"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAIMABLE_CASSETTE: "replay",
      CLAIMABLE_CASSETTE_DIR: dir,
      CLAIMABLE_NOW: "2026-09-15T12:00:00Z",
      NO_COLOR: "1",
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
    },
  });

  it("says what it searched for, on stderr", () => {
    assert.match(run.stderr, /Searching: label:"good first issue" is:issue is:open no:assignee archived:false/);
  });

  it("prints one scan line per result, with the reason", () => {
    assert.match(run.stdout, /DISCARD\s+frappe\/lms#2711\s+PR #2727 by @ajzal-byte is already open/);
    assert.match(run.stdout, /DISCARD\s+ohcnetwork\/create-care-mfe-plug#4\s+no push in/);
    assert.match(run.stdout, /2 checked — 0 viable, 0 caution, 2 discard/);
  });

  it("exits 1 when nothing it found is viable", () => {
    assert.equal(run.status, 1, run.stderr);
  });
});
