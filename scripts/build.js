#!/usr/bin/env node
/**
 * Node refuses to strip TypeScript types for files under node_modules
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — so a published package
 * whose bin/exports point at raw .ts files cannot run once installed.
 * This produces a plain-JS dist/ at publish time using the same stripper
 * Node uses internally, so behavior matches running the .ts sources directly.
 */
import { stripTypeScriptTypes } from "node:module";
import { readdirSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const SRC = "src";
const DIST = "dist";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

rmSync(DIST, { recursive: true, force: true });

for (const srcPath of walk(SRC)) {
  const code = readFileSync(srcPath, "utf8");
  const stripped = stripTypeScriptTypes(code, { mode: "strip" });
  const rewritten = stripped.replace(
    /(from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\.ts\2/g,
    (_match, lead, quote, spec) => `${lead}${quote}${spec}.js${quote}`,
  );
  const distPath = join(DIST, srcPath.slice(SRC.length + 1)).replace(/\.ts$/, ".js");
  mkdirSync(dirname(distPath), { recursive: true });
  writeFileSync(distPath, rewritten);
}

console.log(`built ${walk(SRC).length} files -> ${DIST}/`);
