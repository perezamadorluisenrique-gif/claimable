/**
 * The entry guard, exercised the way npm actually invokes the command.
 *
 * `npx claimable` does not run `dist/cli.js`. It runs a symlink npm wrote into
 * `node_modules/.bin`, and Node resolves that link before it sets
 * `import.meta.url` but not before it sets `process.argv[1]`. A guard that
 * compares the two unresolved therefore decides the module was imported, skips
 * `main`, and exits 0 having printed nothing — the published command doing
 * nothing at all, successfully.
 *
 * Every other check in this repository ran the binary by its real path, which
 * is exactly the case that cannot catch this. So this one goes through a link.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const CLI = resolve(import.meta.dirname, "../src/cli.ts");
const dir = mkdtempSync(join(tmpdir(), "claimable-entry-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Extensionless, like the real `node_modules/.bin/claimable`. */
function throughSymlink(name: string, args: string[]): string {
  const link = join(dir, name);
  symlinkSync(CLI, link);
  return execFileSync(process.execPath, [link, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("invoked through a bin symlink", () => {
  it("prints the usage text rather than exiting silently", () => {
    const out = throughSymlink("claimable", ["--help"]);
    assert.match(out, /USAGE/);
    assert.match(out, /claimable <issue>/);
  });

  it("prints the version", () => {
    const out = throughSymlink("claimable-version", ["--version"]);
    assert.match(out.trim(), /^\d+\.\d+\.\d+$/);
  });
});
