// The browser has no `gh` to ask for a token. Throwing is what "not installed"
// looks like to the caller, which then carries on anonymously.
export function execFileSync() {
  throw new Error("no child processes in a browser");
}
