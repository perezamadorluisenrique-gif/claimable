/**
 * The evaluation figures, read from `test/compare.ts`'s own output. Shared by
 * `check-docs.js` (README prose) and `build-web.js` (the landing page), so
 * neither can drift from what the code says.
 */

import { spawnSync } from "node:child_process";

export function evalFigures() {
  const env = { ...process.env, NO_COLOR: "1", GITHUB_TOKEN: "", GH_TOKEN: "" };
  const res = spawnSync(process.execPath, ["test/compare.ts"], { encoding: "utf8", env });
  if (res.error) throw res.error;
  const compare = res.stdout;
  const rows = compare.split("\n").filter((line) => /hand=/.test(line));
  const summary = compare.trim().split("\n").at(-1).replace(/\s+·\s+/g, " · ");
  const scored = rows.filter((l) => !l.startsWith(" drift"));
  const handDiscards = scored.filter((l) => /hand=discard/.test(l));
  const figures = {
    issues: rows.length,
    rejections: handDiscards.filter((l) => /tool=discard/.test(l)).length,
    rejectionsOf: handDiscards.length,
    caught: rows.filter((l) => l.startsWith(" CAUGHT")).length,
    soft: scored.filter((l) => l.startsWith(" DIFFER") && /tool=reservations/.test(l)).length,
    drift: rows.filter((l) => l.startsWith(" drift")).length,
    wronglyRuledOut: scored.filter((l) => /hand=viable/.test(l) && !l.startsWith(" CAUGHT") && /tool=discard/.test(l)).length,
  };
  const agree = Number(summary.match(/(\d+)\/\d+ agree/)?.[1]);
  const of = Number(summary.match(/\d+\/(\d+) agree/)?.[1]);
  return { figures, summary, agree, of };
}
