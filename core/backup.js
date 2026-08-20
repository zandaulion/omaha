/**
 * Pocket Omaha — the personal-data interchange format.
 *
 * Theses, journals and watchlists are the only things in this app a person
 * could not reconstruct by re-fetching. They are also the only things that
 * exist in two places once there is an Android client, so the rules for
 * reconciling them live here, in `core/`, and both clients apply exactly the
 * same ones. A merge implemented twice is a merge that eventually loses
 * somebody's note.
 *
 * This is import/export, not continuous sync: it runs when a person asks it
 * to, against a file they chose. That shapes the rules below more than any
 * distributed-systems consideration does.
 *
 * ## What is and is not carried
 *
 * Theses and watchlists. Not settings, not the notification history, not the
 * stock cache — those are either device preferences or data that will be
 * re-fetched, and carrying them would turn a backup into a clone of a
 * particular phone.
 */

import { parseTimestamp } from './time.js';

/**
 * Bumped only for a change that older readers cannot survive.
 *
 * Version 1 is deliberately the shape the PWA has always exported, down to the
 * `is_default` spelling that sits oddly among camelCase neighbours. Files that
 * people already have on disk were written before there was any importer to
 * read them, and the first thing this format does should not be to reject
 * them.
 */
export const SCHEMA_VERSION = 1;

/** Thrown for a file this build cannot safely read. */
export class BackupError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'BackupError';
    this.kind = kind; // 'malformed' | 'unsupported_version' | 'not_a_backup'
  }
}

// ------------------------------------------------------------------ reading

/**
 * Parse and validate a backup file.
 *
 * Tolerant about shape, strict about version. A file from a newer major
 * version is refused rather than partially understood: silently dropping
 * fields it does not recognise would lose data while reporting success.
 *
 * @param {string|object} input
 * @returns {{schemaVersion: number, exportedAt: string|null, theses: object[], watchlists: object[]}}
 */
export function readBackup(input) {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new BackupError('malformed', `Not valid JSON: ${err.message}`);
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupError('not_a_backup', 'Expected a JSON object.');
  }
  if (!Array.isArray(raw.theses) && !Array.isArray(raw.watchlists)) {
    throw new BackupError(
      'not_a_backup',
      'Expected "theses" or "watchlists". This does not look like a Pocket Omaha backup.'
    );
  }

  // Files exported before versioning are version 1 by definition.
  const version = raw.schemaVersion ?? SCHEMA_VERSION;
  if (!Number.isInteger(version) || version < 1) {
    throw new BackupError('malformed', `Bad schemaVersion: ${raw.schemaVersion}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new BackupError(
      'unsupported_version',
      `This backup is version ${version}; this build understands up to ` +
      `${SCHEMA_VERSION}. Update before importing it, rather than importing ` +
      'part of it.'
    );
  }

  return {
    schemaVersion: version,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    theses: (raw.theses || []).map(normaliseThesis).filter(Boolean),
    watchlists: (raw.watchlists || []).map(normaliseWatchlist).filter(Boolean)
  };
}

function normaliseThesis(t) {
  if (!t || typeof t.ticker !== 'string' || !t.ticker.trim()) return null;
  return {
    ticker: t.ticker.trim().toUpperCase(),
    conviction: t.conviction ?? 'high',
    targetBuyPrice: numberOrNull(t.targetBuyPrice),
    coreRationale: t.coreRationale ?? '',
    moatTags: asArray(t.moatTags),
    sellTriggers: asArray(t.sellTriggers),
    journalEntries: asArray(t.journalEntries).map(normaliseEntry).filter(Boolean),
    updatedAt: t.updatedAt ?? null
  };
}

function normaliseEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const note = typeof e.note === 'string' ? e.note : '';
  const date = typeof e.date === 'string' ? e.date : null;
  if (!note && !date) return null;
  return {
    // An entry with no id is still an entry. Derived rather than invented, so
    // importing the same file twice does not produce two copies of it.
    id: e.id != null ? String(e.id) : derivedId(date, note),
    date,
    note
  };
}

function normaliseWatchlist(w) {
  if (!w || typeof w.id !== 'string' || !w.id.trim()) return null;
  return {
    id: w.id.trim(),
    name: typeof w.name === 'string' && w.name.trim() ? w.name : w.id,
    tickers: asArray(w.tickers)
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim().toUpperCase()),
    // Accept either spelling on the way in; write only one on the way out.
    is_default: Boolean(w.is_default ?? w.isDefault),
    updatedAt: w.updatedAt ?? null
  };
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Stable id for an entry that never had one, from its own content. */
function derivedId(date, note) {
  let hash = 5381;
  const material = `${date || ''}|${note || ''}`;
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0;
  }
  return `derived-${(hash >>> 0).toString(36)}`;
}

// ------------------------------------------------------------------ writing

/**
 * Build a backup from a host's current data.
 *
 * @param {{theses: object[], watchlists: object[]}} data
 * @param {string} exportedAt ISO-8601
 */
export function buildBackup(data, exportedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    theses: (data.theses || []).map(normaliseThesis).filter(Boolean),
    watchlists: (data.watchlists || []).map(normaliseWatchlist).filter(Boolean)
  };
}

// ------------------------------------------------------------------ merging

/**
 * Reconcile an imported backup against what is already here.
 *
 * Two different rules, because the two kinds of data behave differently:
 *
 * **Theses take the newer version whole, but journals are unioned.** A thesis
 * is a document that gets rewritten, so the later `updatedAt` wins. Journal
 * entries are append-only — nothing in either client deletes one — so entries
 * from the losing side are kept rather than discarded. Editing a thesis on one
 * device and adding a note on another must not cost you the note.
 *
 * **Watchlists take the newer version whole, tickers included.** Unioning them
 * would be friendlier right up until it resurrected a holding someone
 * deliberately removed, and a list that will not let go of a sold position is
 * worse than one that occasionally needs re-adding.
 *
 * Ties go to what is already here, so importing the same file twice changes
 * nothing the second time.
 *
 * @returns {{theses: object[], watchlists: object[], report: object}}
 */
export function mergeBackup(incoming, current) {
  const inc = readBackup(incoming);
  const cur = readBackup(current ?? { theses: [], watchlists: [] });

  const report = {
    thesesAdded: [], thesesUpdated: [], thesesKept: [],
    journalEntriesAdded: 0,
    watchlistsAdded: [], watchlistsUpdated: [], watchlistsKept: []
  };

  // ---- theses
  const byTicker = new Map(cur.theses.map((t) => [t.ticker, t]));
  for (const incomingThesis of inc.theses) {
    const existing = byTicker.get(incomingThesis.ticker);
    if (!existing) {
      byTicker.set(incomingThesis.ticker, incomingThesis);
      report.thesesAdded.push(incomingThesis.ticker);
      report.journalEntriesAdded += incomingThesis.journalEntries.length;
      continue;
    }

    const merged = mergeEntries(existing.journalEntries, incomingThesis.journalEntries);
    report.journalEntriesAdded += merged.length - existing.journalEntries.length;

    const incomingIsNewer = isAfter(incomingThesis.updatedAt, existing.updatedAt);
    const winner = incomingIsNewer ? incomingThesis : existing;
    byTicker.set(incomingThesis.ticker, { ...winner, journalEntries: merged });

    if (incomingIsNewer) report.thesesUpdated.push(incomingThesis.ticker);
    else report.thesesKept.push(incomingThesis.ticker);
  }

  // ---- watchlists
  const byId = new Map(cur.watchlists.map((w) => [w.id, w]));
  for (const incomingList of inc.watchlists) {
    const existing = byId.get(incomingList.id);
    if (!existing) {
      byId.set(incomingList.id, incomingList);
      report.watchlistsAdded.push(incomingList.id);
      continue;
    }
    if (isAfter(incomingList.updatedAt, existing.updatedAt)) {
      byId.set(incomingList.id, incomingList);
      report.watchlistsUpdated.push(incomingList.id);
    } else {
      report.watchlistsKept.push(incomingList.id);
    }
  }

  const watchlists = [...byId.values()];
  enforceSingleDefault(watchlists, cur.watchlists);

  return {
    theses: [...byTicker.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : 1)),
    watchlists,
    report
  };
}

/**
 * Union two journal lists, newest first.
 *
 * Identity is the entry id, which the client derives from `Date.now()`. That
 * is unique on one device and not across two, so an id collision between
 * genuinely different entries is possible — rare, but it would silently drop
 * somebody's note, which is the one outcome this whole module exists to
 * prevent. Colliding entries with different content are therefore both kept,
 * with the newcomer's id disambiguated.
 */
function mergeEntries(existing, incoming) {
  const byId = new Map();
  const out = [];

  for (const e of existing) {
    byId.set(e.id, e);
    out.push(e);
  }

  for (const e of incoming) {
    const clash = byId.get(e.id);
    if (!clash) {
      byId.set(e.id, e);
      out.push(e);
      continue;
    }
    if (clash.note === e.note && clash.date === e.date) continue; // same entry
    let suffixed = `${e.id}-b`;
    let n = 2;
    while (byId.has(suffixed)) suffixed = `${e.id}-b${n++}`;
    const disambiguated = { ...e, id: suffixed };
    byId.set(suffixed, disambiguated);
    out.push(disambiguated);
  }

  return out.sort((a, b) => {
    const at = parseTimestamp(a.date) ?? 0;
    const bt = parseTimestamp(b.date) ?? 0;
    if (at !== bt) return bt - at; // newest first, as the journal renders
    return a.id < b.id ? -1 : 1; // stable
  });
}

/**
 * Exactly one watchlist may be the default.
 *
 * A merge can easily produce two — each side had its own — and the client
 * picks whichever it finds first, which makes the app open on a different
 * screen depending on map iteration order. The local default is preferred,
 * since the person is importing into *this* device.
 */
function enforceSingleDefault(watchlists, localWatchlists) {
  const defaults = watchlists.filter((w) => w.is_default);
  if (defaults.length <= 1) return;

  const localDefaultId = localWatchlists.find((w) => w.is_default)?.id;
  const keep = defaults.find((w) => w.id === localDefaultId) ?? defaults[0];
  for (const w of defaults) {
    if (w !== keep) w.is_default = false;
  }
}

/**
 * Is `a` strictly later than `b`?
 *
 * An unreadable or missing timestamp is treated as older, so a record that
 * carries a date beats one that does not. Equal timestamps are not "after",
 * which is what makes a repeated import a no-op.
 */
function isAfter(a, b) {
  // parseTimestamp, not Date.parse: `updatedAt` arrives from SQLite as
  // "YYYY-MM-DD HH:MM:SS", which V8 reads as local time and QuickJS may not
  // read at all. Getting that wrong here would resolve conflicts by the
  // importing machine's timezone offset.
  const at = parseTimestamp(a);
  const bt = parseTimestamp(b);
  if (at === null) return false;
  if (bt === null) return true;
  return at > bt;
}
