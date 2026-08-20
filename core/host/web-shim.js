/**
 * Pocket Omaha — the web APIs an embedded runtime does not have.
 *
 * QuickJS is a bare JavaScript engine: no `fetch`, no `Response`, no
 * `AbortSignal`. `core/providers/yahoo.js` needs all three, and the one thing
 * that must not happen is `yahoo.js` growing a branch for Android. So the shim
 * lives here, on the JavaScript side of the bridge, and the host supplies
 * exactly one primitive: `__httpFetch`, which takes a request and returns a
 * response.
 *
 * That division is deliberate. Everything shaped like a browser API is
 * reconstructed in JavaScript, once, where both the shape and its quirks are
 * visible; the host only has to do the part a host can do, which is open a
 * socket. A Kotlin `Response` implementation would be a second definition of a
 * web standard, and it would drift.
 *
 * The surface is only what `yahoo.js` actually touches — `ok`, `status`,
 * `headers.get`, `text`, `json`, and `AbortSignal.timeout`. Deliberately not a
 * general `fetch` polyfill: a partial implementation that admits its limits is
 * safer than one that looks complete and is not.
 */

/** Case-insensitive header lookup, which is the part callers depend on. */
class ShimHeaders {
  constructor(raw) {
    this._byLowerName = {};
    for (const [name, value] of Object.entries(raw || {})) {
      this._byLowerName[String(name).toLowerCase()] = value;
    }
  }

  get(name) {
    const value = this._byLowerName[String(name).toLowerCase()];
    return value === undefined ? null : value;
  }
}

class ShimResponse {
  constructor(raw) {
    this.status = raw.status ?? 0;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new ShimHeaders(raw.headers);
    this.url = raw.url ?? '';
    this._body = typeof raw.body === 'string' ? raw.body : '';
  }

  // Async to match the real thing, even though the body is already in hand:
  // callers `await` these, and a synchronous version would work until someone
  // relied on the ordering.
  async text() {
    return this._body;
  }

  async json() {
    return JSON.parse(this._body);
  }
}

/**
 * Carries a deadline and nothing else.
 *
 * The host cannot see a real `AbortSignal`, so the timeout travels as a plain
 * number on the request. Nothing here can actually abort an in-flight request
 * from the JavaScript side — the host owns the socket and enforces the
 * deadline. That is a real limitation, and it is fine for this app, where every
 * signal is a timeout rather than user-initiated cancellation.
 */
class ShimAbortSignal {
  constructor(timeoutMs) {
    this.__timeoutMs = timeoutMs;
    this.aborted = false;
  }

  static timeout(ms) {
    return new ShimAbortSignal(ms);
  }
}

/**
 * `URLSearchParams`, to the extent `yahoo.js` uses it.
 *
 * It builds every request's query string this way, so without it ingestion
 * fails on the first call with a bare ReferenceError. Encoding matters here
 * more than it looks: the statement request asks for a comma-separated list of
 * thirty field names, and a comma encoded differently would ask Yahoo for a
 * field that does not exist and get back an empty series — which this codebase
 * would faithfully report as "not reported" rather than as a bug.
 */
class ShimURLSearchParams {
  constructor(init) {
    this._pairs = [];
    if (typeof init === 'string') {
      for (const part of init.replace(/^[?]/, '').split('&')) {
        if (!part) continue;
        const at = part.indexOf('=');
        const name = at === -1 ? part : part.slice(0, at);
        const value = at === -1 ? '' : part.slice(at + 1);
        this._pairs.push([decodeForm(name), decodeForm(value)]);
      }
    } else if (Array.isArray(init)) {
      for (const [name, value] of init) this._pairs.push([String(name), String(value)]);
    } else if (init && typeof init === 'object') {
      for (const [name, value] of Object.entries(init)) {
        this._pairs.push([String(name), String(value)]);
      }
    }
  }

  append(name, value) {
    this._pairs.push([String(name), String(value)]);
  }

  set(name, value) {
    const key = String(name);
    const first = this._pairs.findIndex(([n]) => n === key);
    if (first === -1) {
      this._pairs.push([key, String(value)]);
      return;
    }
    this._pairs[first] = [key, String(value)];
    this._pairs = this._pairs.filter(([n], i) => n !== key || i === first);
  }

  get(name) {
    const hit = this._pairs.find(([n]) => n === String(name));
    return hit ? hit[1] : null;
  }

  has(name) {
    return this._pairs.some(([n]) => n === String(name));
  }

  delete(name) {
    this._pairs = this._pairs.filter(([n]) => n !== String(name));
  }

  toString() {
    return this._pairs.map(([n, v]) => encodeForm(n) + '=' + encodeForm(v)).join('&');
  }
}

/** Form encoding: like encodeURIComponent, but a space is `+`. */
const encodeForm = (value) => encodeURIComponent(String(value)).replace(/%20/g, '+');
const decodeForm = (value) => decodeURIComponent(String(value).replace(/[+]/g, ' '));

/**
 * Install the shim onto the global object.
 *
 * A no-op where a real `fetch` already exists, so a bundle carrying this can
 * still be loaded under Node without shadowing the genuine implementation —
 * which matters, because the same bundle is what the parity tests run.
 *
 * @param {object} [target]
 */
export function installHostFetch(target = globalThis) {
  if (typeof target.fetch === 'function') return false;

  if (typeof target.__httpFetch !== 'function') {
    throw new Error(
      'No host HTTP function. The embedding runtime must define __httpFetch ' +
      'before the engine can reach the network.'
    );
  }

  target.Response = ShimResponse;
  target.Headers = ShimHeaders;
  target.AbortSignal = ShimAbortSignal;
  if (typeof target.URLSearchParams !== 'function') {
    target.URLSearchParams = ShimURLSearchParams;
  }

  target.fetch = async (url, init = {}) => {
    const request = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ?? null,
      timeoutMs: init.signal?.__timeoutMs ?? null
    };

    const raw = await target.__httpFetch(JSON.stringify(request));

    // A transport failure is reported as a thrown Error, because that is what
    // `fetch` does and what core/providers/yahoo.js catches to produce an
    // IngestError of kind 'network'.
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && parsed.error) throw new Error(parsed.error);

    return new ShimResponse(parsed);
  };

  return true;
}
