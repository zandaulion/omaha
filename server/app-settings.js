import { db } from './db.js';

/**
 * Application preferences.
 *
 * These live in `app_settings`, the key/value table that already exists for the
 * VAPID keypair, rather than in a typed table of their own: they are individual
 * flags with no shared structure, and a column per preference would mean a
 * migration per preference.
 *
 * Notification preferences deliberately stay where they are. They have a fixed
 * set of related fields that the sweep reads together, which is what earns them
 * `notification_settings`.
 *
 * Values are stored as '0' / '1' strings, because the column is TEXT NOT NULL,
 * and read back as numbers so callers see the same shape the notification
 * settings use.
 */

const DEFAULTS = {
  /**
   * Whether the user's own writing about a company is sent to Gemini along
   * with the financial data.
   *
   * Off by default, and that is the whole point. `buildComprehensivePayload`
   * transmits conviction, target buy price, core rationale and — most
   * personally — the pre-committed sell guardrails, which are a record of what
   * would make someone abandon a position. Doc 13 §1 asked for an explicit,
   * default-off toggle rather than a line in a privacy policy. A default that
   * leaks is not a default.
   */
  ai_include_notes: 0
};

export const APP_SETTING_KEYS = Object.keys(DEFAULTS);

/** All preferences, with defaults filled in for anything never written. */
export function getAppSettings() {
  const settings = { ...DEFAULTS };
  try {
    const rows = db
      .prepare(
        `SELECT key, value FROM app_settings WHERE key IN (${APP_SETTING_KEYS.map(() => '?').join(', ')})`
      )
      .all(...APP_SETTING_KEYS);

    for (const row of rows) {
      settings[row.key] = Number(row.value) ? 1 : 0;
    }
  } catch (err) {
    // A preference read must never take down the page that asked for it.
    // Falling back to the defaults is safe precisely because the default for
    // anything privacy-bearing is the closed one.
    console.warn('[Settings] read warning:', err.message);
  }
  return settings;
}

/** Apply a partial update. Unknown keys are ignored rather than stored. */
export function updateAppSettings(patch = {}) {
  const stmt = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  for (const key of APP_SETTING_KEYS) {
    if (!(key in patch)) continue;
    stmt.run(key, patch[key] ? '1' : '0');
  }

  return getAppSettings();
}

/**
 * Whether to attach the user's thesis to an AI analysis.
 *
 * A named helper rather than a property read at the call site, so that the
 * question "does this request carry personal data?" has exactly one answer in
 * the codebase and both hosts can mirror it.
 */
export function shouldIncludeNotesInAI() {
  return Boolean(getAppSettings().ai_include_notes);
}
