/**
 * Unit tests for the pure parts — the text heuristics and the verdict rule.
 *
 * These cover the cases that were wrong once and must stay fixed, which is the
 * only kind of regression test worth writing by hand. Several of them are taken
 * verbatim from real issue bodies.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { decide } from "../src/analyze.ts";
import { isClaim } from "../src/checks/claimants.ts";
import { extractPaths } from "../src/checks/prerequisites.ts";
import { matchWindow, normalise } from "../src/checks/claim-protocol.ts";
import { parseRef, parseRefs, parseRepo } from "../src/refs.ts";
import type { Finding } from "../src/types.ts";

describe("parseRef", () => {
  const expected = { owner: "oppia", repo: "oppia", number: 26840 };

  it("accepts the shorthand", () => {
    assert.deepEqual(parseRef("oppia/oppia#26840"), expected);
  });

  it("accepts a browser URL", () => {
    assert.deepEqual(parseRef("https://github.com/oppia/oppia/issues/26840"), expected);
  });

  it("accepts a URL with a comment anchor, as copied from a thread", () => {
    assert.deepEqual(
      parseRef("https://github.com/oppia/oppia/issues/26840#issuecomment-5688156515"),
      expected,
    );
  });

  it("accepts repo names containing dots and dashes", () => {
    assert.deepEqual(parseRef("ohcnetwork/create-care-mfe-plug#4"), {
      owner: "ohcnetwork",
      repo: "create-care-mfe-plug",
      number: 4,
    });
  });

  it("rejects things that are not issues", () => {
    assert.equal(parseRef("oppia/oppia"), null);
    assert.equal(parseRef("just some words"), null);
    assert.equal(parseRef(""), null);
  });

  it("de-duplicates case-insensitively while keeping order", () => {
    const { refs } = parseRefs(["a/b#1", "A/B#1", "a/b#2"]);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].number, 1);
    assert.equal(refs[1].number, 2);
  });

  it("separates repos from issues", () => {
    assert.deepEqual(parseRepo("hotosm/xlsform-builder"), { owner: "hotosm", repo: "xlsform-builder" });
    assert.equal(parseRepo("hotosm/xlsform-builder#19"), null);
  });
});

describe("isClaim", () => {
  const claims = [
    "I'll work on this",
    "I would like to work on this issue",
    "Can I work on this?",
    "please assign this to me",
    "I'm working on it",
    "@maintainer may I take this one?",
    "Claiming this — will open a PR tomorrow",
  ];

  for (const text of claims) {
    it(`reads "${text}" as a claim`, () => assert.equal(isClaim(text), true));
  }

  const notClaims = [
    "This looks like a duplicate of #12",
    "Thanks for reporting, we'll take a look",
    "I can reproduce this on Firefox",
    "Does anyone know why the test fails here?",
  ];

  for (const text of notClaims) {
    it(`does not read "${text}" as a claim`, () => assert.equal(isClaim(text), false));
  }

  it("ignores a claim quoted from someone else", () => {
    assert.equal(isClaim("> I'll work on this\n\nDid you ever open a PR for it?"), false);
  });

  it("treats an empty body as no claim", () => {
    assert.equal(isClaim(null), false);
    assert.equal(isClaim(""), false);
  });
});

describe("extractPaths", () => {
  it("pulls paths out of backticks and leaves prose alone", () => {
    const body =
      "Migrate `core/tests/webdriverio_desktop/navigation.js` to Playwright. " +
      "See e.g. the docs, i.e. version 3.2 of the guide, and/or ask in Gitter.";
    assert.deepEqual(extractPaths(body), ["core/tests/webdriverio_desktop/navigation.js"]);
  });

  it("finds bare filenames with code extensions", () => {
    assert.deepEqual(extractPaths("run the `stress_test_acceptance_test.yml` workflow"), [
      "stress_test_acceptance_test.yml",
    ]);
  });

  it("does not mistake URLs for paths", () => {
    assert.deepEqual(extractPaths("see `https://github.com/oppia/oppia/wiki/Setup`"), []);
  });

  it("returns nothing for a body with no code spans", () => {
    assert.deepEqual(extractPaths("The dropdown arrow is not clickable on mobile."), []);
  });
});

describe("claim-protocol text matching", () => {
  // Verbatim from oppia/oppia#26840, the case that exposed how brittle a single
  // monolithic regex is: the requirement spans a numbered list across lines.
  const body = normalise(`
> 5. Running the stress test on your fork, on the branch you want to merge, using the
>    \`stress_test_acceptance_test.yml\` workflow, for 200 total runs (100 desktop + 100
>    mobile), to rule out flakiness before requesting assignment.
> 6. Share the stress test link and either the trace or video in the issue thread.

After reviewing the stress test run and video/trace recordings we can assign you to the
particular spec file.
`);

  it("strips blockquote markers and list numbering but keeps identifiers", () => {
    assert.ok(body.includes("stress_test_acceptance_test.yml"), "underscores must survive normalisation");
    assert.ok(!body.includes(">"), "blockquote markers must be gone");
  });

  it("finds a stress-run requirement spread across clauses", () => {
    const hit = matchWindow(body, [/\b(stress[- ]test|flakiness|flaky)\b/i, /\b\d{2,4}\b/, /\b(runs?|times)\b/i], 260);
    assert.ok(hit && /200 total runs/.test(hit), `expected the 200-run requirement, got: ${hit}`);
  });

  it("finds work-before-assignment across two sentences", () => {
    const hit = matchWindow(
      body,
      [/\b(share|post|upload|attach)\b/i, /\b(trace|video|recording)\b/i, /\bassign/i],
      400,
    );
    assert.ok(hit && /assign/.test(hit), `expected the share-then-assign requirement, got: ${hit}`);
  });

  it("does not match when the pieces are too far apart to be one requirement", () => {
    const unrelated = normalise("Share your thoughts below. " + "x".repeat(600) + " We assign issues weekly.");
    assert.equal(matchWindow(unrelated, [/\bshare\b/i, /\bassign/i], 120), null);
  });
});

describe("decide", () => {
  const finding = (severity: Finding["severity"], message: string): Finding => ({
    check: "repo-alive",
    severity,
    message,
  });

  it("one blocker rules the issue out, and names itself as the reason", () => {
    const { verdict, reason } = decide([finding("ok", "fine"), finding("blocker", "repo archived")], []);
    assert.equal(verdict, "discard");
    assert.equal(reason, "repo archived");
  });

  it("warnings downgrade to caution rather than clearing", () => {
    const { verdict, reason } = decide([finding("warning", "stale claim"), finding("warning", "slow review")], []);
    assert.equal(verdict, "reservations");
    assert.match(reason, /stale claim \(\+1 more\)/);
  });

  it("a filter that could not run is a reservation, never a pass", () => {
    const { verdict, reason } = decide(
      [finding("ok", "fine")],
      [{ check: "existing-pr", why: "GET /timeline → 403" }],
    );
    assert.equal(verdict, "reservations");
    assert.match(reason, /could not run/);
  });

  it("short-circuited filters are not held against the issue", () => {
    const { verdict } = decide(
      [finding("ok", "fine")],
      [{ check: "environment", why: "not run — already ruled out by an earlier filter" }],
    );
    assert.equal(verdict, "viable");
  });

  it("clears an issue only when everything ran and nothing objected", () => {
    const { verdict } = decide([finding("ok", "fine"), finding("info", "median merge 2 days")], []);
    assert.equal(verdict, "viable");
  });
});
