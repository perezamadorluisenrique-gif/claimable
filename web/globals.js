/*
 * The two Node globals the shared code reads, defined before any module runs.
 *
 * `process.env` is empty, so the clock is real, colour is off and no token is
 * found in the environment; `process.platform` is "browser", so the
 * environment filter reports platform-specific costs (WSL2 on Windows) as
 * information rather than guessing at the reader's machine.
 */
globalThis.process = { env: {}, platform: "browser", stdout: { isTTY: false } };

globalThis.Buffer = {
  from(text, encoding) {
    if (encoding !== "base64") throw new Error(`Buffer shim only decodes base64, not ${encoding}`);
    const bytes = Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    return { toString: () => new TextDecoder("utf-8").decode(bytes) };
  },
};

/*
 * Anonymous requests stay "simple" in the CORS sense, so the browser sends them
 * without a preflight. The CLI's two custom headers would each force one, and
 * neither changes the response: GitHub defaults to the same API version, and
 * browsers set their own User-Agent.
 *
 * The rate-limit headers of the last response are kept, so the page can say how
 * many checks are left this hour instead of failing on the next one.
 */
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.claimableRateLimit = null;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.github.com/") && init.headers) {
    const headers = { ...init.headers };
    delete headers["x-github-api-version"];
    delete headers["user-agent"];
    init = { ...init, headers };
  }
  const res = await nativeFetch(input, init);
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (limit && remaining) {
    globalThis.claimableRateLimit = {
      limit: Number(limit),
      remaining: Number(remaining),
      reset: Number(res.headers.get("x-ratelimit-reset") || 0),
    };
  }
  return res;
};
