#!/usr/bin/env node
/**
 * Renders the README's demo from a real run of the tool.
 *
 * The demo is not a mock-up: this spawns the CLI against the committed
 * fixtures with the clock pinned, captures the actual bytes it writes to a
 * terminal (ANSI and all), and draws them as an animated SVG. Regenerating it
 * after a change to the output is one command, and a demo that drifts from the
 * real output is therefore a bug rather than a fact of life.
 *
 *   node scripts/demo.js        # writes docs/demo.svg
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The issue whose fixtures are committed and whose verdict makes the point. */
const ARGS = ["openfoodfacts/openfoodfacts-explorer#1660"];
const PROMPT = "$ ";
const COMMAND = `npx claimable ${ARGS.join(" ")}`;
const OUT = "docs/demo.svg";

// Type face and grid. 0.6em per character is the advance of every monospace
// face in the stack below, so contiguous runs line up without per-glyph x.
const FONT_SIZE = 15;
const CHAR = FONT_SIZE * 0.6;
const LINE = 21;
const PAD_X = 22;
const PAD_Y = 20;
const CHROME = 34; // title bar

// Timing, in seconds.
const TYPE_PER_CHAR = 0.045;
const THINK = 0.55; // the pause after Enter, before output lands
const PER_LINE = 0.16;
const HOLD = 4.5; // time to actually read the verdict before it loops

const THEME = {
  bg: "#12151a",
  chrome: "#1b1f27",
  border: "#2b313c",
  text: "#d7dce4",
  dim: "#79818f",
  bold: "#ffffff",
  red: "#f07178",
  yellow: "#e2b862",
  green: "#8fc86f",
  prompt: "#5f8fd6",
};

function run() {
  const res = spawnSync(process.execPath, ["src/cli.ts", ...ARGS], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAIMABLE_CASSETTE: "replay",
      CLAIMABLE_NOW: "2026-09-15",
      FORCE_COLOR: "1",
      NO_COLOR: undefined,
    },
  });
  if (res.error) throw res.error;
  // Exit 1 is the tool's "nothing viable" code, which is the whole point here.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`claimable exited ${res.status}\n${res.stderr}`);
  }
  return res.stdout.replace(/\n+$/, "").split("\n");
}

/**
 * ANSI SGR -> runs of {text, class}. Only the codes report.ts emits, and
 * weight is tracked apart from colour because the verdict nests the two
 * (`red(bold("DISCARD"))`) and a demo that renders it white would be lying
 * about the most important word on screen.
 */
const COLOUR_FOR = { 2: "d", 31: "r", 33: "y", 32: "g" };

function parse(line) {
  const runs = [];
  let colour = "";
  let bold = false;
  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  const push = (text) => {
    // Bold without a colour of its own is the brightest thing on screen;
    // bold with one keeps the colour and only gains weight.
    const cls = [colour || (bold ? "w" : ""), bold ? "b" : ""].filter(Boolean).join(" ");
    if (text.length > 0) runs.push({ text, cls });
  };
  while ((m = re.exec(line)) !== null) {
    push(line.slice(last, m.index));
    const codes = m[1].split(";").filter((c) => c !== "");
    for (const code of codes.length > 0 ? codes : ["0"]) {
      const n = Number(code);
      if (n === 0) {
        colour = "";
        bold = false;
      } else if (n === 1) {
        bold = true;
      } else if (COLOUR_FOR[n] !== undefined) {
        colour = COLOUR_FOR[n];
      }
    }
    last = re.lastIndex;
  }
  push(line.slice(last));
  return runs;
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function main() {
  const output = run();
  const plain = output.map((l) => l.replace(/\u001b\[[0-9;]*m/g, ""));

  const cols = Math.max(PROMPT.length + COMMAND.length + 1, ...plain.map((l) => l.length)) + 2;
  const rows = output.length + 1;
  const width = Math.round(cols * CHAR + PAD_X * 2);
  const height = Math.round(rows * LINE + PAD_Y * 2 + CHROME);

  const typing = COMMAND.length * TYPE_PER_CHAR;
  const total = typing + THINK + output.length * PER_LINE + HOLD;
  const pct = (t) => `${((t / total) * 100).toFixed(3)}%`;

  const baseline = (row) => PAD_Y + CHROME + row * LINE + FONT_SIZE;

  const body = [];

  // The prompt and the command, revealed a character at a time.
  body.push(
    `<text class="l" x="${PAD_X}" y="${baseline(0)}" xml:space="preserve">` +
      `<tspan class="p">${esc(PROMPT)}</tspan>` +
      `<tspan class="w b">${esc(COMMAND)}</tspan></text>`,
  );
  body.push(
    `<rect class="mask" x="${(PAD_X + PROMPT.length * CHAR).toFixed(2)}" ` +
      `y="${(baseline(0) - FONT_SIZE).toFixed(2)}" width="${(COMMAND.length * CHAR + 2).toFixed(2)}" ` +
      `height="${LINE}" fill="${THEME.bg}"/>`,
  );
  body.push(
    `<rect class="cursor" x="${(PAD_X + PROMPT.length * CHAR).toFixed(2)}" ` +
      `y="${(baseline(0) - FONT_SIZE + 2).toFixed(2)}" width="${CHAR.toFixed(2)}" ` +
      `height="${(FONT_SIZE + 2).toFixed(2)}" fill="${THEME.text}"/>`,
  );

  // Then the output, one line at a time.
  output.forEach((line, i) => {
    const runs = parse(line);
    const appears = typing + THINK + i * PER_LINE;
    if (runs.length === 0) return;
    const spans = runs
      .map((r) => (r.cls ? `<tspan class="${r.cls}">${esc(r.text)}</tspan>` : esc(r.text)))
      .join("");
    body.push(
      `<text class="l o" x="${PAD_X}" y="${baseline(i + 1)}" xml:space="preserve" ` +
        `style="animation-delay:-${(total - appears).toFixed(3)}s">${spans}</text>`,
    );
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="claimable rules out a GitHub issue that two people already claimed in the comment thread">
<title>claimable: ${esc(COMMAND)}</title>
<style>
  .l { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace;
       font-size: ${FONT_SIZE}px; fill: ${THEME.text}; white-space: pre; }
  .b { font-weight: 600; }
  .w { fill: ${THEME.bold}; }
  .d { fill: ${THEME.dim}; }
  .r { fill: ${THEME.red}; }
  .y { fill: ${THEME.yellow}; }
  .g { fill: ${THEME.green}; }
  .p { fill: ${THEME.prompt}; }
  .o { opacity: 0; animation: appear ${total.toFixed(3)}s steps(1, end) infinite; }
  .mask { animation: type ${total.toFixed(3)}s steps(${COMMAND.length}, end) infinite; }
  .cursor { animation: caret ${total.toFixed(3)}s linear infinite; }
  @keyframes appear { 0% { opacity: 0 } 0.001% { opacity: 1 } 100% { opacity: 1 } }
  @keyframes type {
    0% { width: ${(COMMAND.length * CHAR + 2).toFixed(2)}px }
    ${pct(typing)} { width: 0 }
    100% { width: 0 }
  }
  @keyframes caret {
    0% { x: ${(PAD_X + PROMPT.length * CHAR).toFixed(2)}px; opacity: 1 }
    ${pct(typing)} { x: ${(PAD_X + (PROMPT.length + COMMAND.length) * CHAR).toFixed(2)}px; opacity: 1 }
    ${pct(typing + 0.001)} { opacity: 0 }
    100% { opacity: 0 }
  }
  @media (prefers-reduced-motion: reduce) {
    .o { opacity: 1; animation: none }
    .mask { display: none }
    .cursor { display: none }
  }
</style>
<rect width="${width}" height="${height}" rx="10" fill="${THEME.bg}" stroke="${THEME.border}"/>
<path d="M0 10a10 10 0 0 1 10-10h${width - 20}a10 10 0 0 1 10 10v${CHROME - 10}H0z" fill="${THEME.chrome}"/>
<line x1="0" y1="${CHROME}" x2="${width}" y2="${CHROME}" stroke="${THEME.border}"/>
<circle cx="20" cy="${CHROME / 2}" r="5.5" fill="#e0685f"/>
<circle cx="39" cy="${CHROME / 2}" r="5.5" fill="#dfbd63"/>
<circle cx="58" cy="${CHROME / 2}" r="5.5" fill="#79c36a"/>
${body.join("\n")}
</svg>
`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg);
  console.log(`${OUT} — ${output.length} lines, ${cols}x${rows} cells, ${total.toFixed(1)}s loop`);
}

main();
