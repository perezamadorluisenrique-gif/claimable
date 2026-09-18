# claimable

**"Unassigned" is not the same as "free".**

GitHub's `no:assignee` filter is how most people look for something to work on, and it is
wrong often enough to waste real weekends. An issue can read *open, unassigned, good first
issue* while a finished pull request has been sitting on it for three weeks — because
GitHub does not assign an issue to whoever opens a PR against it.

`claimable` runs the checks a careful contributor runs by hand before starting, and tells
you what it found and where to verify it.

```
$ claimable ohcnetwork/create-care-mfe-plug#4

DISCARD  ohcnetwork/create-care-mfe-plug#4  .gitignore is not created when a new plug is created

  Why: no push in 301 days (last: 2025-11-21) — a PR here is unlikely to ever be reviewed

  repo alive
    × no push in 301 days (last: 2025-11-21)
      https://github.com/ohcnetwork/create-care-mfe-plug — pushed_at 2025-11-21T07:58:23Z
    ! no closed pull requests found — no evidence that PRs get reviewed here
```

No dependencies. No install. No build step.

```bash
npx claimable oppia/oppia#26840
```

---

## The seven filters

Ordered cheapest and most decisive first, so scanning forty issues spends its request
budget on the ones still in the running.

| # | Filter | The question | The mistake it prevents |
|---|---|---|---|
| 1 | **repo alive** | Does anything get merged here? | A perfect PR to a repo nobody reads is a diary entry |
| 2 | **existing PR** | Is someone already fixing it? | `no:assignee` says "free" when a finished PR is open |
| 3 | **blocked / umbrella** | Did the project say not to start? | `on hold` with zero comments reads as unclaimed |
| 4 | **claimants** | Has a human called it in the thread? | Assignment is not how most projects track this |
| 5 | **prerequisites** | Does the fix need code that does not exist? | "Work: Medium" hiding 65 KB of unlisted porting |
| 6 | **environment** | Can you even build it on this machine? | Discovering the WSL2 requirement after cloning |
| 7 | **claim protocol** | What does the project demand first? | 200 stress runs standing between you and assignment |

Three of these encode corrections to heuristics that seemed obviously right and were
backwards:

- **Comment count is not a signal.** Many comments can mean contested — or an active
  umbrella issue where six people are each working a different file. The tool reads the
  comments instead of counting them.
- **Silence is a red flag, not an opportunity.** An easy issue in a busy repo is claimed
  within days. One that has sat untouched for months is usually sitting there for a
  reason. Maintainer difficulty labels are unreliable; the market of other contributors is
  not.
- **`pushed_at` measures the maintainers, not you.** A repo can be pushed to this week and
  still not have merged an outside contribution in five months. Filter 1 checks both.

---

## Does it actually work?

The evaluation set is not invented. It is 21 issues triaged by hand, one at a time, on
2026-09-15, while looking for real contribution work — with the verdict and the reason
recorded at the time. Roughly one in six candidates that looked good on paper survived.

Against that set, replayed from recorded API fixtures so the result is deterministic:

```
$ npm run compare

16/20 agree with the verified verdict · 4 signals the hand pass missed · 1 excluded as drift
```

Broken down:

| | |
|---|---|
| **12 / 12** | hand rejections reproduced, most of them for the same reason |
| **4** | issues the hand pass *cleared* that the tool rules out — all four verified as genuine misses |
| **4** | soft disagreements: flagged as risky where the hand pass said fine |
| **1** | excluded as drift — the issue was closed three days after the triage |
| **0** | issues wrongly ruled out |

The four misses are the interesting part, because two of them are the exact failure the
tool exists to prevent:

- `frappe/lms#2711` — PR #2727 had been open for five days. The issue still read
  *unassigned*.
- `openfoodfacts-explorer#1660` — claimed in the thread ten days earlier. Nobody had
  scrolled down.

And two more were cleared by hand on the strength of `pushed_at`:
`hotosm/xlsform-builder#19` and `#22` sit in a repo pushed to two days before the triage,
which has not merged a pull request since 2026-04-07.

**The ground-truth file is never edited to match the tool.** Where later verification
proved a hand verdict wrong, the original stays and a `correction` is recorded next to it
with its evidence. Rewriting the answers to match would make the agreement rate a
tautology.

### The asymmetry the test suite enforces

The two possible errors are not equally bad, so they are not treated equally:

- Clearing an issue that is actually taken costs somebody a weekend and a rejected PR.
  **The suite forbids this outright** — and `CAUTION` is not good enough, because a
  caution is something people click past.
- Flagging a fine issue as risky costs thirty seconds of reading. **Tolerated, counted,
  and printed** at the end of the run.

---

## Usage

```bash
claimable <issue> [<issue> ...]
claimable --repo <owner/repo> [--label <label>] [--limit <n>]
```

Issues can be written as `owner/repo#123` or as any GitHub issue URL, including one copied
from a comment permalink.

| Option | Effect |
|---|---|
| `--repo owner/repo` | Scan a repository's open issues instead of named ones |
| `--label <label>` | With `--repo`: only issues with this label (repeatable) |
| `--limit <n>` | With `--repo`: how many to scan (default 20) |
| `--thorough` | Run every filter even after one rules an issue out |
| `--skip <check>` | Skip a filter (repeatable) |
| `--json` | Machine-readable output |
| `--quiet` | One line per issue |
| `--viable-only` | Print only issues that survive every filter |

Exit code is `0` when at least one issue is viable, `1` when nothing is, `2` on a usage or
network error — so it composes into a script.

### Authentication

Optional. `claimable` reads `GITHUB_TOKEN`/`GH_TOKEN`, then falls back to `gh auth token`,
then runs anonymously at GitHub's 60 requests/hour. Scanning more than a handful of issues
wants a token; checking one does not.

Authenticating has a second benefit: the tool then knows who you are, and stops reporting
your own comments as somebody else having claimed the issue.

---

## What it does not do

Stated plainly, because a triage tool that hides its blind spots is worse than none:

- **It does not read wikis.** Projects that keep setup instructions outside the repo —
  Oppia is one — get an explicit *"setup cost unverified"*, never a false all-clear.
- **It does not judge whether you can do the work.** Filter 5 finds unlisted scope; it
  cannot tell you whether the listed scope is within reach.
- **It does not read your mind about umbrella issues.** It tells you an issue is an
  umbrella and that you should claim a unit of work rather than the issue. Which unit is
  still yours to pick.
- **A filter that cannot run says so.** Silently treating an unreachable check as a pass
  is how a tool like this starts lying, so every skipped filter is listed in the output
  and downgrades the verdict to `CAUTION`.

---

## Development

Requires Node 22.18+ (TypeScript runs natively; there is no build step and no dependency
tree).

```bash
npm test          # 54 tests, offline, deterministic
npm run compare   # tool verdicts next to the hand verdicts, side by side
npm run record    # re-record API fixtures (talks to the live API)
```

Fixtures are recorded snapshots of the GitHub API. The suite pins both the clock
(`CLAIMABLE_NOW`) and the authenticated user, so it does not change its mind when somebody
on the other side of the world opens a pull request.

## Licence

MIT
