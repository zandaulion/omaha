/**
 * Pocket Omaha — typed ingestion failures.
 *
 * Every upstream fetch used to fail as a bare `Error` carrying only an HTTP
 * status in its message, which made a rate limit indistinguishable from a dead
 * ticker at the point where the decision matters. A caller that cannot tell
 * those apart cannot back off, and a client that cannot back off retries into
 * the block that caused it — on a phone, where WorkManager retries on its own
 * schedule, that amplifies the condition rather than waiting it out.
 *
 * `kind` is the field callers should branch on. The HTTP status is kept for
 * logging, not for decisions.
 */

/** @typedef {'rate_limited'|'unauthorized'|'not_found'|'upstream'|'network'|'malformed'} IngestErrorKind */

export class IngestError extends Error {
  /**
   * @param {IngestErrorKind} kind
   * @param {string} message
   * @param {{status?: number|null, retryAfterMs?: number|null, cause?: unknown}} [detail]
   */
  constructor(kind, message, detail = {}) {
    super(message);
    this.name = 'IngestError';
    this.kind = kind;
    this.status = detail.status ?? null;
    this.retryAfterMs = detail.retryAfterMs ?? null;
    if (detail.cause !== undefined) this.cause = detail.cause;
  }

  /** True when waiting and trying again is the correct response. */
  get retryable() {
    return this.kind === 'rate_limited' || this.kind === 'network';
  }
}

/**
 * Map an HTTP status onto a kind.
 *
 * 401 and 403 are `unauthorized` rather than fatal: Yahoo returns them for an
 * invalidated crumb, which is recoverable by re-establishing the session. 404
 * is `not_found` and must never be retried — an unknown ticker is a real
 * answer, and the app is required to report it as one rather than invent a
 * company.
 *
 * @param {number} status
 * @returns {IngestErrorKind}
 */
export function kindForStatus(status) {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  return 'upstream';
}

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * The header is either delta-seconds or an HTTP date; both forms appear in the
 * wild. Returns `null` when absent or unparseable, which callers must treat as
 * "no guidance" and fall back to their own backoff rather than retrying at once.
 *
 * @param {string|null|undefined} value
 * @param {number} [nowMs]
 * @returns {number|null}
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // delta-seconds
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }

  // HTTP-date. Explicitly ISO-normalised before parsing: a bare
  // `new Date(str)` on a non-ISO string is implementation-defined, and this
  // code has to give the same answer under Node and QuickJS.
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const delta = at - nowMs;
  return delta > 0 ? delta : 0;
}
