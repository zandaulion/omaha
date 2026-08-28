/**
 * Pocket Omaha — where an AI analysis is allowed to be read from.
 *
 * One function, because the rule it encodes is the one thing in the whole
 * relay that must never be gotten wrong: an analysis generated with someone's
 * notes included is derived from their own thesis text, and serving it to a
 * second account is not a cache bug, it is a privacy leak. See
 * docs/13_ANDROID_ARCHITECTURE.md §7.
 */

/**
 * @param {{ticker: string, includedNotes: boolean}} args
 * @param {string|null} uid the caller's uid, or null for the unauthenticated
 *   read path (`getAiSummary`), which by construction can never resolve a
 *   private location
 * @returns {{scope: 'shared', path: string} |
 *   {scope: 'private', path: string} |
 *   {scope: 'unreachable', reason: string}}
 */
export function cacheLocationFor({ ticker, includedNotes }, uid = null) {
  const symbol = String(ticker || '').toUpperCase();
  if (!symbol) return { scope: 'unreachable', reason: 'no ticker' };

  if (!includedNotes) {
    // Public by construction. No uid is needed to read it and none is
    // consulted to write it — the whole point is that it does not vary by
    // who is asking.
    return { scope: 'shared', path: `aiCache/${symbol}` };
  }

  if (!uid) {
    // A notes-included analysis has nowhere anonymous to live. Reached only
    // if a caller asks for a private-scoped read without authenticating,
    // which should already have been refused upstream — this is the second
    // guard, not the first.
    return { scope: 'unreachable', reason: 'includedNotes is true but no uid was given' };
  }

  return { scope: 'private', path: `users/${uid}/aiCache/${symbol}` };
}
