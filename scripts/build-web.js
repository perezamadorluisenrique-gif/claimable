#!/usr/bin/env node
/**
 * Assemble the browser version into `site/`.
 *
 * The page runs the command-line tool's own filters, not a port of them: the
 * plain-JS `dist/` that `npm run build` makes for npm is copied in as
 * `site/lib/`, and the four Node built-ins it imports are pointed at small
 * browser stand-ins by an import map in `web/index.html`. A verdict in the
 * browser is therefore the same code path as a verdict in a terminal.
 *
 * It also records the example the page shows before anyone has typed: a real
 * report, replayed from the committed fixtures on the evaluation date, and
 * labelled as such on the page.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const SITE = "site";

if (!existsSync("dist/index.js")) {
  console.error("dist/ is missing — run `npm run build` first (npm run build:web does both)");
  process.exit(1);
}

rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
cpSync("web", SITE, { recursive: true });
cpSync("dist", `${SITE}/lib`, { recursive: true });
// Pages would otherwise run the site through Jekyll, which skips nothing here
// but costs a build and has opinions about underscores.
writeFileSync(`${SITE}/.nojekyll`, "");

const RECORDED = "2026-09-15";
process.env.CLAIMABLE_NOW = `${RECORDED}T12:00:00Z`;
const { configure } = await import("../dist/github.js");
const { analyze } = await import("../dist/analyze.js");
configure({ cassetteMode: "replay", cassetteDir: "test/fixtures", token: null, viewer: "perezamadorluisenrique-gif" });
const report = await analyze({ owner: "oppia", repo: "oppia", number: 26840 });
writeFileSync(`${SITE}/example.json`, `${JSON.stringify({ recorded: RECORDED, report }, null, 2)}\n`);

console.log(`built ${SITE}/ — example: ${report.verdict} oppia/oppia#26840`);
