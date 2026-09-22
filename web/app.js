/*
 * The page's own code: read an issue reference, run the shared filters, draw
 * the report. Everything that decides a verdict lives in ./lib, which is the
 * command-line tool's own code, unchanged.
 */

import { analyze, configure, parseRef, requestCount, CHECK_ORDER, refToString } from "./lib/index.js";

const LABEL = {
  "repo-alive": "repo alive",
  "existing-pr": "existing PR",
  "blocked-label": "blocked / umbrella",
  claimants: "claimants",
  prerequisites: "prerequisites",
  environment: "environment",
  "claim-protocol": "claim protocol",
};
const VERDICT = { discard: "DISCARD", reservations: "CAUTION", viable: "VIABLE" };
const MARK = { blocker: "×", warning: "!", info: "·", ok: "✓" };

const form = document.getElementById("check-form");
const input = document.getElementById("issue-input");
const thorough = document.getElementById("thorough-input");
const button = document.getElementById("check-button");
const result = document.getElementById("result");
const tokenInput = document.getElementById("token-input");
const tokenStatus = document.getElementById("token-status");

/* ── token: this tab only, and only if the reader gives one ─────────────── */

function storedToken() {
  try {
    return sessionStorage.getItem("claimable-token") || "";
  } catch {
    return "";
  }
}

function useToken(token) {
  // `null` is "resolved, and there is none", so the shared client does not go
  // looking for a `gh` binary that a browser does not have.
  configure({ token: token || null });
}

useToken(storedToken());
if (storedToken()) tokenStatus.textContent = "Using your token for this tab.";

document.getElementById("token-save").addEventListener("click", () => {
  const token = tokenInput.value.trim();
  try {
    if (token) sessionStorage.setItem("claimable-token", token);
    else sessionStorage.removeItem("claimable-token");
  } catch {
    /* storage blocked: the token still works until the tab closes */
  }
  useToken(token);
  tokenInput.value = "";
  tokenStatus.textContent = token
    ? "Using your token for this tab. Your own comments no longer count as somebody else's claim."
    : "Token cleared. Checks run anonymously again.";
});

/* ── drawing ──────────────────────────────────────────────────────────────── */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** Evidence is a URL, a URL with a note after it, or a command to run. */
function evidence(text) {
  const match = text.match(/https?:\/\/[^\s)]+/);
  if (!match) return el("span", {}, text);
  const url = match[0];
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + url.length);
  return el("span", {}, before, el("a", { href: url, target: "_blank", rel: "noopener" }, url.replace(/^https:\/\//, "")), after);
}

function render(report, note) {
  const findingsByCheck = new Map();
  for (const finding of report.findings) {
    if (finding.severity === "ok" && report.verdict !== "viable" && report.findings.some((f) => f.check === finding.check && f.severity !== "ok")) continue;
    const list = findingsByCheck.get(finding.check) ?? [];
    list.push(finding);
    findingsByCheck.set(finding.check, list);
  }
  const skipped = new Map(report.skipped.map((s) => [s.check, s.why]));

  const filters = el("ol", { class: "filters", "aria-label": "The seven filters" });
  CHECK_ORDER.forEach((check, index) => {
    const findings = findingsByCheck.get(check) ?? [];
    const why = skipped.get(check);
    const body = el("div", { class: "findings" });

    for (const finding of findings) {
      const row = el(
        "div",
        { class: "finding" },
        el("span", { class: `mark m-${finding.severity}`, "aria-label": finding.severity }, MARK[finding.severity]),
        el("p", {}, finding.message),
      );
      for (const item of finding.evidence ?? []) row.append(el("div", { class: "evidence" }, evidence(item)));
      body.append(row);
    }
    if (why !== undefined) {
      const shortCircuit = why.startsWith("not run");
      body.append(
        el(
          "div",
          { class: "finding" },
          el("span", { class: "mark m-skip", "aria-hidden": "true" }, shortCircuit ? "–" : "?"),
          el("p", { class: "not-run" }, shortCircuit ? "Not run: an earlier filter already ruled the issue out." : `Could not check: ${why}`),
        ),
      );
    }
    if (findings.length === 0 && why === undefined) {
      body.append(el("div", { class: "finding" }, el("span", { class: "mark m-ok" }, MARK.ok), el("p", {}, "nothing found")));
    }

    filters.append(el("li", { class: "filter" }, el("div", { class: "filter-name" }, el("b", {}, index + 1), LABEL[check]), body));
  });

  const verdictClass = `v-${report.verdict}`;
  result.replaceChildren(
    note ? el("p", { class: "eyebrow" }, note) : null,
    el(
      "div",
      { class: "verdict" },
      el(
        "div",
        { class: "verdict-line" },
        el("span", { class: `verdict-word ${verdictClass}` }, VERDICT[report.verdict]),
        el("a", { class: "issue-ref", href: report.url, target: "_blank", rel: "noopener" }, refToString(report.ref)),
      ),
      el("p", { class: "issue-title" }, report.title),
      el("p", { class: `reason ${verdictClass}` }, el("span", {}, report.reason)),
    ),
    filters,
  );
}

function renderMeta(report, requests) {
  const meta = el("div", { class: "meta" });
  const limit = globalThis.claimableRateLimit;
  meta.append(el("span", {}, `${requests} API request${requests === 1 ? "" : "s"}`));
  if (limit) {
    meta.append(el("span", {}, `${limit.remaining} of ${limit.limit} left this hour`));
  }
  const share = el("button", { type: "button" }, "Copy a link to this check");
  share.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      share.textContent = "Link copied";
    } catch {
      share.textContent = location.href;
    }
  });
  meta.append(share);
  result.append(meta);
}

function renderError(message) {
  result.removeAttribute("aria-busy");
  result.replaceChildren(el("p", { class: "error" }, message));
}

/* ── running a check ──────────────────────────────────────────────────────── */

async function check(raw) {
  const ref = parseRef(raw);
  if (!ref) {
    renderError(`"${raw}" is not an issue reference. Use owner/repo#123, or paste the issue's URL.`);
    return;
  }

  const url = new URL(location.href);
  url.searchParams.set("issue", refToString(ref));
  if (thorough.checked) url.searchParams.set("thorough", "1");
  else url.searchParams.delete("thorough");
  history.replaceState(null, "", url);

  button.disabled = true;
  button.textContent = "Checking…";
  result.setAttribute("aria-busy", "true");
  if (!result.firstChild) result.append(el("p", { class: "eyebrow" }, `Checking ${refToString(ref)}…`));
  const before = requestCount();

  try {
    const report = await analyze(ref, { thorough: thorough.checked });
    result.removeAttribute("aria-busy");
    render(report, `Checked just now`);
    renderMeta(report, requestCount() - before);
    document.title = `${VERDICT[report.verdict]} ${refToString(ref)} · claimable`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const limited = /rate limit|403|429/i.test(message);
    renderError(
      limited
        ? "GitHub's hourly limit for anonymous requests from your address is used up. Add a token below to keep going, or try again later."
        : `The check could not finish: ${message}`,
    );
    if (limited) document.getElementById("token-details").open = true;
  } finally {
    button.disabled = false;
    button.textContent = "Check";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (value) check(value);
  else input.focus();
});

/* ── first paint: a shared link runs its check; otherwise a recorded example ─ */

const params = new URLSearchParams(location.search);
const shared = params.get("issue");
if (shared) {
  input.value = shared;
  thorough.checked = params.get("thorough") === "1";
  check(shared);
} else {
  fetch("example.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((example) => {
      if (!example || result.firstChild) return;
      input.placeholder = refToString(example.report.ref);
      render(example.report, `Example · recorded ${example.recorded} · paste your own issue above`);
    })
    .catch(() => {});
}
