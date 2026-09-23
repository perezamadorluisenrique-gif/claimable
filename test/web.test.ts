/**
 * The browser version runs the command-line tool's own modules, with Node's
 * built-ins swapped for stand-ins by an import map. That only works while the
 * map and the stand-ins cover every built-in the shared code imports — and a
 * gap would not fail anything else in this suite, it would only blank the page.
 * So this walks the import graph from `src/index.ts` and holds the map to it.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

/** node:* specifier -> the names imported from it, across everything index.ts reaches. */
function nodeImports(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const queue = [join(ROOT, "src/index.ts")];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^(?:import|export)\s+(type\s+)?(?:\{([^}]*)\}|\*)?[^;]*?from\s+"([^"]+)"/gm)) {
      if (m[1]) continue; // type-only imports vanish when types are stripped
      const spec = m[3];
      if (spec.startsWith(".")) {
        queue.push(resolve(dirname(file), spec));
      } else if (spec.startsWith("node:")) {
        const names = found.get(spec) ?? new Set<string>();
        for (const name of (m[2] ?? "").split(",")) {
          const clean = name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (clean && !name.trim().startsWith("type ")) names.add(clean);
        }
        found.set(spec, names);
      }
    }
  }
  return found;
}

const html = readFileSync(join(ROOT, "web/index.html"), "utf8");
const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]) as {
  imports: Record<string, string>;
};

describe("browser version", () => {
  const imports = nodeImports();

  it("reaches at least the built-ins it is known to need", () => {
    assert.ok(imports.has("node:fs") && imports.has("node:child_process"), [...imports.keys()].join(", "));
  });

  for (const [spec, names] of imports) {
    it(`maps ${spec} to a stand-in that exports ${[...names].join(", ")}`, async () => {
      const target = importMap.imports[spec];
      assert.ok(target, `web/index.html's import map has no entry for ${spec}`);
      const shim = await import(join(ROOT, "web", target));
      for (const name of names) assert.ok(name in shim, `${target} does not export ${name}`);
    });
  }
});
