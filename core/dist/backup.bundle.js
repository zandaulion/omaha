// core/time.js
var TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3})\d*)?)?(Z|z|[+-]\d{2}:?\d{2})?$/;
function parseTimestamp(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const m = TIMESTAMP.exec(raw);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, ms, zone] = m;
  let at = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh || 0),
    Number(mm || 0),
    Number(ss || 0),
    Number((ms || "").padEnd(3, "0") || 0)
  );
  if (!Number.isFinite(at)) return null;
  if (zone && zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const offsetMin = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0);
    at -= sign * offsetMin * 6e4;
  }
  return at;
}

// core/backup.js
var SCHEMA_VERSION = 1;
var BackupError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "BackupError";
    this.kind = kind;
  }
};
function readBackup(input) {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new BackupError("malformed", `Not valid JSON: ${err.message}`);
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BackupError("not_a_backup", "Expected a JSON object.");
  }
  if (!Array.isArray(raw.theses) && !Array.isArray(raw.watchlists)) {
    throw new BackupError(
      "not_a_backup",
      'Expected "theses" or "watchlists". This does not look like a Pocket Omaha backup.'
    );
  }
  const version = raw.schemaVersion ?? SCHEMA_VERSION;
  if (!Number.isInteger(version) || version < 1) {
    throw new BackupError("malformed", `Bad schemaVersion: ${raw.schemaVersion}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new BackupError(
      "unsupported_version",
      `This backup is version ${version}; this build understands up to ${SCHEMA_VERSION}. Update before importing it, rather than importing part of it.`
    );
  }
  return {
    schemaVersion: version,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : null,
    theses: (raw.theses || []).map(normaliseThesis).filter(Boolean),
    watchlists: (raw.watchlists || []).map(normaliseWatchlist).filter(Boolean)
  };
}
function normaliseThesis(t) {
  if (!t || typeof t.ticker !== "string" || !t.ticker.trim()) return null;
  return {
    ticker: t.ticker.trim().toUpperCase(),
    conviction: t.conviction ?? "high",
    targetBuyPrice: numberOrNull(t.targetBuyPrice),
    coreRationale: t.coreRationale ?? "",
    moatTags: asArray(t.moatTags),
    sellTriggers: asArray(t.sellTriggers),
    journalEntries: asArray(t.journalEntries).map(normaliseEntry).filter(Boolean),
    updatedAt: t.updatedAt ?? null
  };
}
function normaliseEntry(e) {
  if (!e || typeof e !== "object") return null;
  const note = typeof e.note === "string" ? e.note : "";
  const date = typeof e.date === "string" ? e.date : null;
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
  if (!w || typeof w.id !== "string" || !w.id.trim()) return null;
  return {
    id: w.id.trim(),
    name: typeof w.name === "string" && w.name.trim() ? w.name : w.id,
    tickers: asArray(w.tickers).filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().toUpperCase()),
    // Accept either spelling on the way in; write only one on the way out.
    is_default: Boolean(w.is_default ?? w.isDefault),
    updatedAt: w.updatedAt ?? null
  };
}
var asArray = (v) => Array.isArray(v) ? v : [];
var numberOrNull = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function derivedId(date, note) {
  let hash = 5381;
  const material = `${date || ""}|${note || ""}`;
  for (let i = 0; i < material.length; i++) {
    hash = (hash << 5) + hash + material.charCodeAt(i) | 0;
  }
  return `derived-${(hash >>> 0).toString(36)}`;
}
function buildBackup(data, exportedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    // Sorted, and sorted here rather than left to the host. The PWA reads
    // theses with no ORDER BY while Android's DAO orders by ticker, so without
    // this the same data would export in two different orders and the files
    // would not be comparable. `mergeBackup` produces the same order, so a
    // merged export and a fresh one agree.
    theses: (data.theses || []).map(normaliseThesis).filter(Boolean).sort(byTicker),
    watchlists: (data.watchlists || []).map(normaliseWatchlist).filter(Boolean).sort(byId)
  };
}
var byTicker = (a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
var byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function mergeBackup(incoming, current) {
  const inc = readBackup(incoming);
  const cur = readBackup(current ?? { theses: [], watchlists: [] });
  const report = {
    thesesAdded: [],
    thesesUpdated: [],
    thesesKept: [],
    journalEntriesAdded: 0,
    watchlistsAdded: [],
    watchlistsUpdated: [],
    watchlistsKept: []
  };
  const byTicker_ = new Map(cur.theses.map((t) => [t.ticker, t]));
  for (const incomingThesis of inc.theses) {
    const existing = byTicker_.get(incomingThesis.ticker);
    if (!existing) {
      byTicker_.set(incomingThesis.ticker, incomingThesis);
      report.thesesAdded.push(incomingThesis.ticker);
      report.journalEntriesAdded += incomingThesis.journalEntries.length;
      continue;
    }
    const merged = mergeEntries(existing.journalEntries, incomingThesis.journalEntries);
    report.journalEntriesAdded += merged.length - existing.journalEntries.length;
    const incomingIsNewer = isAfter(incomingThesis.updatedAt, existing.updatedAt);
    const winner = incomingIsNewer ? incomingThesis : existing;
    byTicker_.set(incomingThesis.ticker, { ...winner, journalEntries: merged });
    if (incomingIsNewer) report.thesesUpdated.push(incomingThesis.ticker);
    else report.thesesKept.push(incomingThesis.ticker);
  }
  const byWatchlistId = new Map(cur.watchlists.map((w) => [w.id, w]));
  for (const incomingList of inc.watchlists) {
    const existing = byWatchlistId.get(incomingList.id);
    if (!existing) {
      byWatchlistId.set(incomingList.id, incomingList);
      report.watchlistsAdded.push(incomingList.id);
      continue;
    }
    if (isAfter(incomingList.updatedAt, existing.updatedAt)) {
      byWatchlistId.set(incomingList.id, incomingList);
      report.watchlistsUpdated.push(incomingList.id);
    } else {
      report.watchlistsKept.push(incomingList.id);
    }
  }
  const watchlists = [...byWatchlistId.values()];
  enforceSingleDefault(watchlists, cur.watchlists);
  return {
    theses: [...byTicker_.values()].sort(byTicker),
    watchlists: watchlists.sort(byId),
    report
  };
}
function mergeEntries(existing, incoming) {
  const byId2 = /* @__PURE__ */ new Map();
  const out = [];
  for (const e of existing) {
    byId2.set(e.id, e);
    out.push(e);
  }
  for (const e of incoming) {
    const clash = byId2.get(e.id);
    if (!clash) {
      byId2.set(e.id, e);
      out.push(e);
      continue;
    }
    if (clash.note === e.note && clash.date === e.date) continue;
    let suffixed = `${e.id}-b`;
    let n = 2;
    while (byId2.has(suffixed)) suffixed = `${e.id}-b${n++}`;
    const disambiguated = { ...e, id: suffixed };
    byId2.set(suffixed, disambiguated);
    out.push(disambiguated);
  }
  return out.sort((a, b) => {
    const at = parseTimestamp(a.date) ?? 0;
    const bt = parseTimestamp(b.date) ?? 0;
    if (at !== bt) return bt - at;
    return a.id < b.id ? -1 : 1;
  });
}
function enforceSingleDefault(watchlists, localWatchlists) {
  const defaults = watchlists.filter((w) => w.is_default);
  if (defaults.length <= 1) return;
  const localDefaultId = localWatchlists.find((w) => w.is_default)?.id;
  const keep = defaults.find((w) => w.id === localDefaultId) ?? defaults[0];
  for (const w of defaults) {
    if (w !== keep) w.is_default = false;
  }
}
function isAfter(a, b) {
  const at = parseTimestamp(a);
  const bt = parseTimestamp(b);
  if (at === null) return false;
  if (bt === null) return true;
  return at > bt;
}
export {
  BackupError,
  SCHEMA_VERSION,
  buildBackup,
  mergeBackup,
  readBackup
};
