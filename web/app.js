/**
 * Pocket Omaha — Core PWA Client Application Logic
 * Mobile-First, Offline-Ready Fundamental Analysis PWA
 */

// ----------------- VALUE FORMATTING -----------------
//
// Every metric can legitimately be null: a bank files no gross profit, a
// company with no filed prior year has no Piotroski score. These helpers
// render that as an em dash. Nothing here substitutes a default value —
// the whole point of the rewrite is that a shown number is a real number.

const EM_DASH = '—';

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', GBp: 'p', JPY: '¥', CHF: 'CHF ',
  CAD: 'C$', AUD: 'A$', RON: 'RON ', SEK: 'SEK ', DKK: 'DKK ',
  NOK: 'NOK ', HKD: 'HK$', CNY: '¥', INR: '₹', BRL: 'R$'
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const curSym = (code) => CURRENCY_SYMBOLS[code] ?? `${code || ''} `;

/** A plain number, or an em dash when there is nothing to show. */
function fmtNum(v, dp = 2, suffix = '') {
  return isNum(v) ? `${v.toFixed(dp)}${suffix}` : EM_DASH;
}

/** A fraction rendered as a percentage. Pass alreadyPercent for 0-100 inputs. */
function fmtPct(v, dp = 1, { alreadyPercent = false, sign = false } = {}) {
  if (!isNum(v)) return EM_DASH;
  const value = alreadyPercent ? v : v * 100;
  const plus = sign && value > 0 ? '+' : '';
  return `${plus}${value.toFixed(dp)}%`;
}

/** A share price in the stock's own reporting currency. */
function fmtPrice(v, currency = 'USD') {
  if (!isNum(v)) return EM_DASH;
  const sym = curSym(currency);
  return v < 0 ? `-${sym}${Math.abs(v).toFixed(2)}` : `${sym}${v.toFixed(2)}`;
}

/** A large money figure, abbreviated, in the stock's own currency. */
function fmtMoney(v, currency = 'USD') {
  if (!isNum(v)) return EM_DASH;
  const sym = curSym(currency);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${sym}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${sym}${abs.toFixed(2)}`;
}

/** Billions, for the figures the API already reports pre-divided. */
function fmtBillions(v, currency = 'USD') {
  if (!isNum(v)) return EM_DASH;
  const sym = curSym(currency);
  return v < 0 ? `-${sym}${Math.abs(v).toFixed(2)}B` : `${sym}${v.toFixed(2)}B`;
}

/** A composite score, or "N/A" when there was too little filed data. */
const fmtScore = (v) => (isNum(v) ? String(v) : 'N/A');

/**
 * The currency the company's statements are in, which is not always the one
 * its shares trade in: NOK trades in USD and reports in EUR. Every figure
 * drawn from the filings must be labelled with this, not with the ticker's
 * trading currency, or a EUR balance sheet gets rendered with dollar signs.
 */
const reportingCcy = (stock) =>
  stock?.financials?.reportingCurrency || stock?.currency || 'USD';

/** The currency the shares trade in — what a broker screen shows. */
const tradedCcy = (stock) => stock?.currency || 'USD';

/** Short haptic acknowledgement on devices that support it. */
function haptic(pattern = 8) {
  if (navigator.vibrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try { navigator.vibrate(pattern); } catch { /* not supported */ }
  }
}

// Global Application State
const state = {
  activeView: localStorage.getItem('omaha_active_view') || 'viewWatchlist',
  activeSubtab: localStorage.getItem('omaha_active_subtab') || 'overview',
  activeWatchlistId: localStorage.getItem('omaha_active_watchlist') || null,
  currentTicker: localStorage.getItem('omaha_current_ticker') || 'NVDA',
  currentStock: null,
  watchlists: [],
  currentWatchlistData: null,
  allScreenerStocks: [],
  theme: localStorage.getItem('omaha_theme') || 'system',
  dcf: {
    growth: 18,
    multiple: 24,
    discount: 9.5
  },
  thesis: {
    conviction: 'high',
    targetBuyPrice: null,
    coreRationale: '',
    moatTags: [],
    sellTriggers: [],
    journalEntries: []
  },
  aiSummaries: {},
  // Mirrors the server's app_settings. The server is the authority — it is the
  // side that actually decides what gets sent — and this copy exists so the
  // interface can describe the current behaviour before a request is made.
  appSettings: { ai_include_notes: 0 },
  offlineDataAt: null,
  servingFromCache: false
};

// Application Initialization Entry Point
async function initApp() {
  initTheme();
  registerServiceWorker();

  try {
    initEventListeners();
    initNetworkListeners();
    initPullToRefresh();
  } catch (e) {
    console.warn('Non-fatal event listener warning:', e);
  }

  // Check device registration / invite session
  const isAuthed = await checkAuthSession();
  if (isAuthed) {
    try {
      // Loaded up front rather than with the settings modal: the deep dive
      // describes what an analysis will send before the modal is ever opened.
      loadAppSettings();
      await loadWatchlists();
      if (state.activeWatchlistId) {
        await loadWatchlistData(state.activeWatchlistId);
      }

      if (!localStorage.getItem('omaha_onboarded')) {
        openModal('onboardingModal');
      }

      // Check URL parameters first; if none, restore last viewed screen
      const hasUrlNav = handleUrlParams();
      if (!hasUrlNav) {
        const savedView = localStorage.getItem('omaha_active_view') || 'viewWatchlist';
        const savedTicker = localStorage.getItem('omaha_current_ticker');
        const savedSubtab = localStorage.getItem('omaha_active_subtab') || 'overview';

        if (savedView === 'viewDeepDive' && savedTicker) {
          await openStockDeepDive(savedTicker, savedSubtab);
        } else if (savedView === 'viewScreener') {
          loadScreenerData();
          switchView('viewScreener');
        } else if (savedView === 'viewCompare') {
          runComparison();
          switchView('viewCompare');
        } else {
          switchView('viewWatchlist');
        }
      }
    } catch (e) {
      console.warn('Non-fatal initial data load warning:', e);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ----------------- AUTHENTICATION & GATE CONTROLLER -----------------
async function checkAuthSession() {
  const token = localStorage.getItem('omaha_token');

  try {
    const res = await fetch('/api/auth/session', {
      headers: getAuthHeaders()
    });
    const session = await res.json();

    if (session.authenticated && !session.revoked) {
      document.getElementById('gateScreen')?.classList.add('hidden');
      document.getElementById('appShell')?.classList.remove('hidden');
      return true;
    }

    // If server says token was revoked or invalid, clear it
    if (token && session.revoked) {
      localStorage.removeItem('omaha_token');
    }

    // Activation belongs entirely to the inline runner in index.html: it owns
    // the invite-link path, the in-app-browser warning and the form, and it
    // reloads on success so this function simply finds a token next time.
    // Two owners is how the earlier build sent two redemptions per activation.
    showGateScreen();
    return false;
  } catch (err) {
    console.warn('Session check error:', err);
    if (token) {
      document.getElementById('gateScreen')?.classList.add('hidden');
      document.getElementById('appShell')?.classList.remove('hidden');
      return true;
    }
    showGateScreen();
    return false;
  }
}

function showGateScreen() {
  document.getElementById('appShell')?.classList.add('hidden');
  const gate = document.getElementById('gateScreen');
  if (gate) {
    gate.classList.remove('hidden');
    gate.classList.add('fade-in');
  }
  // The in-app-browser warning and the platform hints are decided by the
  // inline runner, which knows whether a code came in on the URL. Nothing to
  // do here but reveal the card.
}

function getAuthHeaders() {
  const token = localStorage.getItem('omaha_token');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ----------------- OFFLINE DATA CACHE -----------------
//
// The service worker deliberately never caches /api responses — they are
// per-device and authenticated. Offline support instead keeps the last good
// JSON body for each GET in IndexedDB, so opening the app on a train shows
// the last known scorecard with an honest "as of" stamp rather than a blank
// panel. Writes are never served from here.

const CACHE_DB = 'omaha-data';
const CACHE_STORE = 'responses';
let cacheDbPromise = null;

function openCacheDb() {
  if (cacheDbPromise) return cacheDbPromise;
  cacheDbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(CACHE_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return cacheDbPromise;
}

async function cachePut(url, body) {
  const db = await openCacheDb();
  if (!db) return;
  try {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ url, body, storedAt: Date.now() });
  } catch {
    // A full or blocked store must not break the live request.
  }
}

async function cacheGet(url) {
  const db = await openCacheDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Newest "as of" stamp across everything rendered this session. */
function noteDataAge(storedAt) {
  if (!storedAt) return;
  state.offlineDataAt = Math.max(state.offlineDataAt || 0, storedAt);
  updateFreshnessBanner();
}

function updateFreshnessBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;

  if (navigator.onLine && !state.servingFromCache) {
    banner.hidden = true;
    return;
  }

  const age = state.offlineDataAt ? Date.now() - state.offlineDataAt : null;
  let when = 'from your last visit';
  if (age !== null) {
    const mins = Math.round(age / 60000);
    if (mins < 2) when = 'from moments ago';
    else if (mins < 60) when = `from ${mins} minutes ago`;
    else if (mins < 48 * 60) when = `from ${Math.round(mins / 60)} hours ago`;
    else when = `from ${Math.round(mins / 1440)} days ago`;
  }

  banner.textContent = navigator.onLine
    ? `Showing saved data ${when} — could not reach the server.`
    : `Offline. Showing saved data ${when}.`;
  banner.hidden = false;
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {})
  };
  const method = (options.method || 'GET').toUpperCase();
  const cacheable = method === 'GET' && url.startsWith('/api/');

  try {
    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      showGateScreen();
      throw new Error('This device is not registered. Enter an invite code to activate it.');
    }

    if (cacheable && res.ok) {
      // Clone before the caller reads it — a Response body is single-use.
      res.clone().json().then((body) => cachePut(url, body)).catch(() => {});
      state.servingFromCache = false;
      state.offlineDataAt = Date.now();
      updateFreshnessBanner();
    }
    return res;
  } catch (err) {
    if (!cacheable) throw err;

    const hit = await cacheGet(url);
    if (!hit) throw err;

    state.servingFromCache = true;
    noteDataAge(hit.storedAt);

    // Handed back as a real Response so every caller keeps working unchanged.
    return new Response(JSON.stringify(hit.body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Omaha-From-Cache': '1' }
    });
  }
}

// ----------------- THEME CONTROLLER -----------------
function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: light)');

  const apply = () => {
    // 'system' follows the OS; an explicit choice overrides it. The previous
    // build only ever had two states and always started dark.
    const resolved = state.theme === 'system' ? (media.matches ? 'light' : 'dark') : state.theme;
    document.documentElement.setAttribute('data-theme', resolved);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
      btn.title =
        state.theme === 'system' ? 'Following your system theme' :
        state.theme === 'dark' ? 'Dark theme' : 'Light theme';
      btn.setAttribute('aria-label', btn.title);
      btn.dataset.mode = state.theme;
    }
  };

  apply();
  media.addEventListener('change', () => {
    if (state.theme === 'system') apply();
  });

  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    haptic();
    const order = ['system', 'dark', 'light'];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
    localStorage.setItem('omaha_theme', state.theme);
    apply();
  });
}

// ----------------- SERVICE WORKER & PUSH -----------------
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('Pocket Omaha ServiceWorker registered:', reg.scope);
    }).catch((err) => {
      console.warn('ServiceWorker registration error:', err);
    });
  }
}

function initNetworkListeners() {
  window.addEventListener('online', () => {
    state.servingFromCache = false;
    updateFreshnessBanner();
    // Coming back online, quietly re-fetch what is on screen.
    refreshActiveView().catch(() => {});
  });
  window.addEventListener('offline', updateFreshnessBanner);
  updateFreshnessBanner();
}

// ----------------- PULL TO REFRESH -----------------
//
// Only arms at the very top of the page, and only for a downward drag, so it
// never fights normal scrolling or a horizontal swipe on a wide table.
function initPullToRefresh() {
  const indicator = document.getElementById('pullIndicator');
  if (!indicator) return;

  const TRIGGER_PX = 72;
  const MAX_PULL = 110;
  let startY = null;
  let pull = 0;
  let refreshing = false;

  const reset = () => {
    indicator.style.transform = '';
    indicator.classList.remove('is-armed', 'is-visible');
    pull = 0;
    startY = null;
  };

  document.addEventListener('touchstart', (e) => {
    if (refreshing || window.scrollY > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY === null || refreshing) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0 || window.scrollY > 0) {
      reset();
      return;
    }
    // Resistance, so the indicator eases rather than tracking the finger 1:1.
    pull = Math.min(MAX_PULL, delta * 0.5);
    indicator.classList.add('is-visible');
    indicator.style.transform = `translate(-50%, ${pull}px)`;
    indicator.classList.toggle('is-armed', pull >= TRIGGER_PX);
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (startY === null || refreshing) return;
    const armed = pull >= TRIGGER_PX;
    if (!armed) {
      reset();
      return;
    }

    refreshing = true;
    haptic([12, 40, 12]);
    indicator.classList.add('is-refreshing');
    indicator.style.transform = 'translate(-50%, 56px)';

    try {
      await refreshActiveView();
    } finally {
      refreshing = false;
      indicator.classList.remove('is-refreshing');
      reset();
    }
  }, { passive: true });
}

/** Re-fetches whatever is on screen, bypassing the server-side quote cache. */
async function refreshActiveView() {
  try {
    if (state.activeView === 'viewDeepDive' && state.currentTicker) {
      await openStockDeepDive(state.currentTicker, null, { forceRefresh: true });
    } else if (state.activeView === 'viewScreener') {
      await loadScreenerData();
    } else if (state.activeView === 'viewCompare') {
      await runComparison();
    } else {
      await loadWatchlistData(state.activeWatchlistId);
    }
    showToast('Updated', '✓');
  } catch (err) {
    showToast('Could not refresh — check your connection', '⚠️');
  }
}

// ----------------- NAVIGATION & ROUTING -----------------
function switchView(viewId) {
  if (viewId !== state.activeView) haptic();
  state.activeView = viewId;
  localStorage.setItem('omaha_active_view', viewId);

  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.add('hidden');
    panel.classList.remove('fade-in');
  });

  const targetPanel = document.getElementById(viewId);
  if (targetPanel) {
    targetPanel.classList.remove('hidden');
    targetPanel.classList.add('fade-in');
  }

  if (viewId === 'viewCompare' && state.currentTicker) {
    loadPeerSuggestions(state.currentTicker);
  }

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    if (tab.getAttribute('data-view') === viewId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchSubtab(subtabName) {
  state.activeSubtab = subtabName;
  localStorage.setItem('omaha_active_subtab', subtabName);

  document.querySelectorAll('#deepDiveSubtabs .tab-pill').forEach((btn) => {
    if (btn.getAttribute('data-subtab') === subtabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.subtab-panel').forEach((panel) => {
    panel.classList.add('hidden');
  });

  const subtabMap = {
    overview: 'subtabOverview',
    gemini: 'subtabGemini',
    checklist: 'subtabChecklist',
    trends: 'subtabTrends',
    dcf: 'subtabDcf',
    thesis: 'subtabThesis'
  };

  const target = document.getElementById(subtabMap[subtabName]);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('fade-in');
  }

  if (subtabName === 'gemini') {
    ensureGeminiSubtabRendered(state.currentTicker);
  }
}

// ----------------- EVENT LISTENERS INITIALIZATION -----------------
function initEventListeners() {
  // Bottom Navigation
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.getAttribute('data-view');
      if (view === 'viewScreener') {
        loadScreenerData();
      } else if (view === 'viewCompare') {
        runComparison();
      }
      switchView(view);
    });
  });

  // Header Brand click -> return to watchlist
  document.getElementById('headerBrand')?.addEventListener('click', () => {
    switchView('viewWatchlist');
  });

  // Deep Dive Back Button
  document.getElementById('deepDiveBackBtn')?.addEventListener('click', () => {
    switchView('viewWatchlist');
  });

  // Deep Dive Subtabs
  document.querySelectorAll('#deepDiveSubtabs .tab-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subtab = btn.getAttribute('data-subtab');
      switchSubtab(subtab);
    });
  });

  // Gemini AI Triggers
  document.getElementById('deepDiveGeminiHeaderBtn')?.addEventListener('click', () => {
    switchSubtab('gemini');
    if (!state.aiSummaries[state.currentTicker]) {
      generateGeminiSummary(state.currentTicker, false);
    }
  });

  document.getElementById('overviewGeminiActionBtn')?.addEventListener('click', () => {
    switchSubtab('gemini');
    if (!state.aiSummaries[state.currentTicker]) {
      generateGeminiSummary(state.currentTicker, false);
    }
  });

  // Watchlist Selector change
  document.getElementById('watchlistSelect')?.addEventListener('change', (e) => {
    state.activeWatchlistId = e.target.value;
    localStorage.setItem('omaha_active_watchlist', state.activeWatchlistId);
    loadWatchlistData(state.activeWatchlistId);
  });

  // Watchlist Sorting change
  document.getElementById('sortSelect')?.addEventListener('change', () => {
    renderWatchlistCards();
  });

  // New Watchlist Modal triggers
  document.getElementById('newListBtn')?.addEventListener('click', () => {
    openModal('newWatchlistModal');
  });
  document.getElementById('closeNewListModalBtn')?.addEventListener('click', () => {
    closeModal('newWatchlistModal');
  });
  document.getElementById('saveNewWatchlistBtn')?.addEventListener('click', handleCreateWatchlist);

  // Search Modal triggers
  const openSearch = () => {
    openModal('searchModal');
    const targetSelect = document.getElementById('searchTargetWatchlistSelect');
    if (targetSelect) targetSelect.value = state.activeWatchlistId;
    const input = document.getElementById('searchInput');
    if (input) {
      input.focus();
      handleSearchInput();
    }
  };

  document.getElementById('searchTriggerBtn')?.addEventListener('click', openSearch);
  document.getElementById('addStockTriggerBtn')?.addEventListener('click', openSearch);
  document.getElementById('emptyAddStockBtn')?.addEventListener('click', openSearch);
  document.getElementById('closeSearchModalBtn')?.addEventListener('click', () => {
    closeModal('searchModal');
  });

  // Search Clear button
  document.getElementById('searchClearBtn')?.addEventListener('click', () => {
    const input = document.getElementById('searchInput');
    if (input) {
      input.value = '';
      input.focus();
      document.getElementById('searchClearBtn')?.classList.add('hidden');
      handleSearchInput();
    }
  });

  // Search Target Watchlist change -> update result buttons
  document.getElementById('searchTargetWatchlistSelect')?.addEventListener('change', () => {
    handleSearchInput();
  });

  // Search Input live typing
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    const val = e.target.value;
    const clearBtn = document.getElementById('searchClearBtn');
    if (clearBtn) {
      if (val.length > 0) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }
    debounceSearch();
  });

  const debounceSearch = debounce(handleSearchInput, 200);

  // Search Input keydown: Enter to add / view
  document.getElementById('searchInput')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim().toUpperCase();
      if (!val) return;

      const targetWlId = document.getElementById('searchTargetWatchlistSelect')?.value || state.activeWatchlistId;
      await handleAddStockToWatchlist(val, targetWlId);
    }
  });

  // Quick Suggestion Chips
  document.querySelectorAll('#searchPopularChips [data-chip-ticker]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const ticker = chip.getAttribute('data-chip-ticker');
      const input = document.getElementById('searchInput');
      if (input) {
        input.value = ticker;
        document.getElementById('searchClearBtn')?.classList.remove('hidden');
        handleSearchInput();
      }
    });
  });

  // Settings Modal triggers
  document.getElementById('settingsTriggerBtn')?.addEventListener('click', () => {
    haptic();
    loadNotificationCentre();
    loadAppSettings();
    openModal('settingsModal');
    checkPushStatus();
  });
  document.getElementById('closeSettingsModalBtn')?.addEventListener('click', () => {
    closeModal('settingsModal');
  });

  // Redeem Invite Button

  // Push Notifications Button
  document.getElementById('enablePushBtn')?.addEventListener('click', handleEnablePush);
  document.getElementById('testPushBtn')?.addEventListener('click', handleTestPush);

  // Export Backup JSON Button
  document.getElementById('exportBackupBtn')?.addEventListener('click', () => {
    window.location.href = '/api/theses';
  });

  // Restore from file. The picker is hidden and driven by the visible button
  // so it can be styled like the rest of the settings panel.
  const importInput = document.getElementById('importBackupFile');
  document.getElementById('importBackupBtn')?.addEventListener('click', () => {
    importInput?.click();
  });

  importInput?.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const result = document.getElementById('importBackupResult');
    const say = (text, colour) => {
      if (result) {
        result.textContent = text;
        result.style.color = `var(${colour})`;
      }
    };

    say('Restoring…', '--text-secondary');
    try {
      const text = await file.text();
      const res = await apiFetch('/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text
      });
      const report = await res.json();
      if (!res.ok) throw new Error(report.error || 'Restore failed.');

      // Say what actually happened rather than "Done". A merge that silently
      // kept the local copy looks identical to one that did nothing.
      const parts = [];
      const added = report.thesesAdded?.length || 0;
      const updated = report.thesesUpdated?.length || 0;
      const kept = report.thesesKept?.length || 0;
      const notes = report.journalEntriesAdded || 0;
      if (added) parts.push(`${added} thesis${added === 1 ? '' : 'es'} added`);
      if (updated) parts.push(`${updated} updated`);
      if (kept) parts.push(`${kept} already newer here`);
      if (notes) parts.push(`${notes} journal note${notes === 1 ? '' : 's'} added`);
      const lists = (report.watchlistsAdded?.length || 0) + (report.watchlistsUpdated?.length || 0);
      if (lists) parts.push(`${lists} watchlist${lists === 1 ? '' : 's'} changed`);

      say(parts.length ? `Restored: ${parts.join(', ')}.` : 'Nothing to restore — already up to date.', '--health-good');
      await loadWatchlists();
    } catch (err) {
      say(err.message || 'Restore failed.', '--health-risk');
    } finally {
      // Cleared so choosing the same file twice fires the event again.
      importInput.value = '';
    }
  });

  // Onboarding starter selection
  document.querySelectorAll('#onboardingModal [data-starter]').forEach((card) => {
    card.addEventListener('click', async () => {
      const starterId = card.getAttribute('data-starter');
      state.activeWatchlistId = starterId;
      localStorage.setItem('omaha_active_watchlist', starterId);
      localStorage.setItem('omaha_onboarded', 'true');
      closeModal('onboardingModal');
      await loadWatchlists();
      await loadWatchlistData(starterId);
    });
  });
  document.getElementById('skipOnboardingBtn')?.addEventListener('click', () => {
    localStorage.setItem('omaha_onboarded', 'true');
    closeModal('onboardingModal');
  });

  // DCF Sliders & Presets
  document.getElementById('dcfGrowthSlider')?.addEventListener('input', (e) => {
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    state.dcf.growth = parseFloat(e.target.value);
    document.getElementById('dcfGrowthVal').textContent = `${state.dcf.growth}%`;
    calculateClientDCF();
  });
  document.getElementById('dcfMultipleSlider')?.addEventListener('input', (e) => {
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    state.dcf.multiple = parseFloat(e.target.value);
    document.getElementById('dcfMultipleVal').textContent = `${state.dcf.multiple.toFixed(1)}x`;
    calculateClientDCF();
  });
  document.getElementById('dcfDiscountSlider')?.addEventListener('input', (e) => {
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    state.dcf.discount = parseFloat(e.target.value);
    document.getElementById('dcfDiscountVal').textContent = `${state.dcf.discount.toFixed(1)}%`;
    calculateClientDCF();
  });

  // DCF Presets
  document.getElementById('dcfBearPreset')?.addEventListener('click', () => setDCFPreset('bear'));
  document.getElementById('dcfBasePreset')?.addEventListener('click', () => setDCFPreset('base'));
  document.getElementById('dcfBullPreset')?.addEventListener('click', () => setDCFPreset('bull'));

  // Thesis & Journal Actions
  document.getElementById('saveThesisBtn')?.addEventListener('click', handleSaveThesis);
  document.getElementById('addGuardrailBtn')?.addEventListener('click', handleAddGuardrail);
  document.getElementById('addJournalNoteBtn')?.addEventListener('click', () => openModal('journalModal'));
  document.getElementById('closeJournalModalBtn')?.addEventListener('click', () => closeModal('journalModal'));
  document.getElementById('saveJournalNoteBtn')?.addEventListener('click', handleSaveJournalNote);

  // Bookmark / Add to Watchlist Button
  document.getElementById('bookmarkBtn')?.addEventListener('click', handleToggleBookmark);

  // Screener Controls
  document.getElementById('filterHealthSlider')?.addEventListener('input', (e) => {
    document.getElementById('filterHealthVal').textContent = e.target.value;
    filterScreenerStocks();
  });
  document.getElementById('filterPiotroskiSlider')?.addEventListener('input', (e) => {
    document.getElementById('filterPiotroskiVal').textContent = e.target.value;
    filterScreenerStocks();
  });
  document.getElementById('filterRoicSlider')?.addEventListener('input', (e) => {
    document.getElementById('filterRoicVal').textContent = `${e.target.value}%`;
    filterScreenerStocks();
  });
  document.getElementById('filterSectorSelect')?.addEventListener('change', filterScreenerStocks);
  document.getElementById('filterDebtEquitySlider')?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('filterDebtEquityVal').textContent = v >= 5 ? 'any' : `${v.toFixed(2)}x`;
    filterScreenerStocks();
  });
  document.getElementById('filterNetCash')?.addEventListener('change', () => { haptic(); filterScreenerStocks(); });
  document.getElementById('filterFcfPositive')?.addEventListener('change', () => { haptic(); filterScreenerStocks(); });

  // Screener Presets
  document.getElementById('presetAllBtn')?.addEventListener('click', () => setScreenerPreset({}));
  document.getElementById('presetFortressBtn')?.addEventListener('click', () =>
    setScreenerPreset({ health: 85, piotroski: 7, roic: 15, fcfPositive: true }));
  document.getElementById('presetRoicBtn')?.addEventListener('click', () =>
    setScreenerPreset({ health: 70, piotroski: 6, roic: 20 }));
  document.getElementById('presetCashBtn')?.addEventListener('click', () =>
    setScreenerPreset({ health: 0, netCash: true }));

  // Compare Runner
  document.getElementById('compareRunBtn')?.addEventListener('click', () => { haptic(); runComparison(); });

  // Notification preferences
  document.querySelectorAll('[data-notify-pref]').forEach((box) => {
    box.addEventListener('change', () => {
      haptic();
      saveNotificationPrefs();
    });
  });

  // Application preferences
  document.querySelectorAll('[data-app-setting]').forEach((box) => {
    box.addEventListener('change', () => {
      haptic();
      saveAppSettings();
    });
  });
}

// ----------------- WATCHLIST LOGIC & RENDERING -----------------
async function loadWatchlists() {
  try {
    const res = await apiFetch('/api/watchlists');
    const data = await res.json();
    state.watchlists = data.watchlists || [];

    const savedWlId = localStorage.getItem('omaha_active_watchlist');
    if (savedWlId && state.watchlists.some(w => w.id === savedWlId)) {
      state.activeWatchlistId = savedWlId;
    } else if (!state.activeWatchlistId || !state.watchlists.some(w => w.id === state.activeWatchlistId)) {
      const defaultWl = state.watchlists.find(w => w.is_default) || state.watchlists[0];
      if (defaultWl) {
        state.activeWatchlistId = defaultWl.id;
        localStorage.setItem('omaha_active_watchlist', defaultWl.id);
      }
    }

    const select = document.getElementById('watchlistSelect');
    if (select) {
      select.innerHTML = state.watchlists.map(w =>
        `<option value="${w.id}" ${w.id === state.activeWatchlistId ? 'selected' : ''}>${w.name}</option>`
      ).join('');
    }

    const searchSelect = document.getElementById('searchTargetWatchlistSelect');
    if (searchSelect) {
      searchSelect.innerHTML = state.watchlists.map(w =>
        `<option value="${w.id}" ${w.id === state.activeWatchlistId ? 'selected' : ''}>${w.name}</option>`
      ).join('');
    }
  } catch (err) {
    console.error('Error loading watchlists:', err);
  }
}

async function loadWatchlistData(watchlistId) {
  try {
    const res = await apiFetch(`/api/watchlists/${watchlistId}/health`);
    const data = await res.json();
    state.currentWatchlistData = data;
    renderWatchlistHero(data);
    renderWatchlistCards();
  } catch (err) {
    console.error('Error loading watchlist health:', err);
  }
}

function renderWatchlistHero(data) {
  if (!data) return;

  document.getElementById('heroWatchlistName').textContent = data.name || 'My Watchlist';
  document.getElementById('heroStockCount').textContent =
    `${data.stockCount || 0} companies` +
    (data.unscoredCount ? ` · ${data.unscoredCount} without enough filed data to score` : '');

  const gradeBadge = document.getElementById('heroGradeBadge');
  const score = isNum(data.compositeScore) ? data.compositeScore : null;
  gradeBadge.textContent = score === null ? 'Not scored' : `${data.grade} (${score}/100)`;
  gradeBadge.title =
    data.weighting === 'market-cap'
      ? 'Weighted by market capitalisation'
      : 'Equally weighted — market caps unavailable';

  gradeBadge.className = 'hero-grade-badge';
  if (score === null) gradeBadge.classList.add('unscored');
  else if (score >= 85) gradeBadge.classList.add('pristine');
  else if (score >= 70) gradeBadge.classList.add('good');
  else if (score >= 50) gradeBadge.classList.add('moderate');
  else gradeBadge.classList.add('risk');

  // Render 5-Pillar Mini Meters
  const pillarsContainer = document.getElementById('heroPillars');
  if (pillarsContainer && data.pillars) {
    pillarsContainer.innerHTML = data.pillars.map(p => `
      <div class="pillar-meter-item">
        <div class="pillar-meter-label">
          <span>${p.name}${p.measured < p.of ? ` <span class="pillar-partial">${p.measured}/${p.of}</span>` : ''}</span>
          <span class="mono">${p.score === null ? EM_DASH : `${p.score}/20`}</span>
        </div>
        <div class="pillar-meter-bar-bg">
          <div class="pillar-meter-bar-fill" style="width: ${p.pct ?? 0}%; background: ${getPillarColor(p.pct)};"></div>
        </div>
      </div>
    `).join('');
  }

  // Checklist Aggregates
  const checkText = document.getElementById('heroChecklistText');
  if (checkText && data.checklistAggregates) {
    const { totalPass = 0, totalWatch = 0, totalFail = 0, totalNa = 0 } = data.checklistAggregates;
    checkText.innerHTML =
      `🟢 ${totalPass} pass · 🟡 ${totalWatch} watch · 🔴 ${totalFail} fail` +
      (totalNa ? ` · ${totalNa} not reported` : '');
  }

  // Composite Moat Dynamic Update
  const moatEl = document.getElementById('heroMoatText');
  if (moatEl) {
    let moatLabel = 'Not assessed';
    if (score === null) moatLabel = 'Not assessed';
    else if (score >= 85) moatLabel = 'Wide / Fortress';
    else if (score >= 70) moatLabel = 'Strong';
    else if (score >= 50) moatLabel = 'Moderate';
    else moatLabel = 'Narrow / Speculative';
    moatEl.textContent = `Composite Moat: ${moatLabel}`;
  }
}

function renderWatchlistCards() {
  const container = document.getElementById('stockCardsList');
  const emptyState = document.getElementById('watchlistEmptyState');
  const stocks = state.currentWatchlistData?.stocks || [];

  if (stocks.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // Sort logic
  const sortBy = document.getElementById('sortSelect')?.value || 'health';
  const sorted = [...stocks].sort((a, b) => {
    if (sortBy === 'health') return b.health_score - a.health_score;
    if (sortBy === 'change') return b.change_pct - a.change_pct;
    if (sortBy === 'roic') return b.roic_pct - a.roic_pct;
    if (sortBy === 'pe') return (a.summary?.ratios?.pe || 99) - (b.summary?.ratios?.pe || 99);
    return 0;
  });

  container.innerHTML = sorted.map(stock => {
    const isPos = stock.change_pct >= 0;
    const tier = stock.summary?.healthTier || 'good';
    const topCatalyst = stock.catalysts?.[0];
    const topRisk = stock.risks?.[0];

    return `
      <div class="stock-card" data-ticker="${stock.ticker}">
        <div class="stock-left">
          <div class="ticker-row">
            <span class="ticker-symbol mono">${stock.ticker}</span>
            <span class="company-name">${stock.name}</span>
          </div>
          <div class="stock-metrics-row mono">
            <span>P/E: ${fmtNum(stock.summary?.ratios?.pe, 1, 'x')}</span>
            <span>•</span>
            <span>ROIC: ${fmtPct(stock.roic_pct, 1, { alreadyPercent: true })}</span>
            <span>•</span>
            <span>${stock.summary?.metrics?.isFinancial ? 'ROE' : 'Altman Z'}: ${
              stock.summary?.metrics?.isFinancial
                ? fmtPct(stock.summary?.metrics?.roe)
                : fmtNum(stock.altman_z, 2)}</span>
          </div>
        </div>

        <div class="stock-right">
          <div style="display: flex; align-items: flex-start; gap: 8px;">
            <div class="stock-price-col">
              <div class="stock-price mono">${fmtPrice(stock.price, stock.currency)}</div>
              <div class="stock-change mono ${isPos ? 'positive' : 'negative'}">
                ${fmtPct(stock.change_pct, 2, { alreadyPercent: true, sign: true })}
              </div>
            </div>
            <button class="stock-remove-btn" data-remove-ticker="${stock.ticker}" title="Remove ${stock.ticker} from watchlist">✕</button>
          </div>
          <div class="score-badge ${tier}" style="margin-top: 6px;" ${
            stock.health_score === null
              ? 'title="Too few line items were filed to score this company."'
              : ''}>
            ${stock.health_score === null ? 'Not scored' : `${stock.health_score}/100`}
          </div>
        </div>

        <div class="moat-pills-row">
          ${topCatalyst ? `<span class="moat-pill catalyst">⚡ ${topCatalyst.title}</span>` : ''}
          ${topRisk ? `<span class="moat-pill risk">⚠️ ${topRisk.title}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Add click listeners to cards
  container.querySelectorAll('.stock-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.stock-remove-btn')) return;
      const ticker = card.getAttribute('data-ticker');
      openStockDeepDive(ticker);
    });
  });

  // Add click listeners to remove buttons
  container.querySelectorAll('.stock-remove-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticker = btn.getAttribute('data-remove-ticker');
      handleRemoveStockFromWatchlist(ticker);
    });
  });
}

// ----------------- STOCK DEEP DIVE SCORECARD -----------------
async function openStockDeepDive(tickerSymbol, initialSubtab = null, opts = {}) {
  const ticker = tickerSymbol.toUpperCase();
  state.currentTicker = ticker;
  localStorage.setItem('omaha_current_ticker', ticker);

  const subtabToOpen = initialSubtab || (state.activeView === 'viewDeepDive' ? state.activeSubtab : (localStorage.getItem('omaha_active_subtab') || 'overview'));

  // Show loading state or navigate immediately
  switchView('viewDeepDive');
  switchSubtab(subtabToOpen);

  try {
    const res = await apiFetch(`/api/stock/${ticker}${opts.forceRefresh ? '?refresh=1' : ''}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Could not load ${ticker}`);
    }
    const data = await res.json();
    state.currentStock = data;

    renderDeepDiveHero(data);
    updateBookmarkButtonState();
    renderOverviewSubtab(data);
    renderChecklistSubtab(data);
    renderTrendsSubtab(data);
    initDCFSandbox(data);
    loadInvestmentThesis(ticker);
    fetchCachedAISummary(ticker);
  } catch (err) {
    console.error('Deep dive error:', err);
    showToast(err.message || `Could not load ${ticker}`, '⚠️');
  }
}

function renderDeepDiveHero(stock) {
  document.getElementById('deepDiveTicker').textContent = stock.ticker;
  document.getElementById('deepDiveName').textContent = stock.name;
  document.getElementById('deepDivePrice').textContent = fmtPrice(stock.price, stock.currency);
  document.getElementById('deepDiveCurrency').textContent = stock.currency || 'USD';

  const isPos = stock.change_pct >= 0;
  const changeEl = document.getElementById('deepDiveChange');
  changeEl.textContent = fmtPct(stock.change_pct, 2, { alreadyPercent: true, sign: true });
  changeEl.className = `mono stock-change ${isPos ? 'positive' : 'negative'}`;

  document.getElementById('deepDiveScoreVal').textContent = fmtScore(stock.health_score);
  document.getElementById('deepDiveScoreLabel').textContent =
    stock.summary?.healthLabel || 'Not enough filed data to score';
  document.getElementById('deepDiveSectorInfo').textContent = `${stock.sector || 'Equities'} · ${stock.industry || 'Core Business'}`;

  // SVG Radial Circle Progress Animation
  const ring = document.getElementById('scoreRingProgress');
  const circumference = 2 * Math.PI * 50; // r=50 -> 314.15
  const scorePct = isNum(stock.health_score) ? stock.health_score : 0;
  ring.style.strokeDashoffset = circumference - (scorePct / 100) * circumference;

  const color = getScoreColor(stock.health_score);
  ring.style.stroke = color;
  document.getElementById('deepDiveScoreLabel').style.color = color;

  // Say plainly how much of the scorecard could actually be measured.
  const coverage = stock.summary?.coverage;
  const coverageEl = document.getElementById('deepDiveCoverage');
  if (coverageEl) {
    if (coverage && coverage.pct < 100) {
      coverageEl.textContent =
        `${coverage.measured} of ${coverage.total} measures available in the filings` +
        (coverage.sufficient ? '' : ' — too few to produce a score');
      coverageEl.hidden = false;
    } else {
      coverageEl.hidden = true;
    }
  }

  const asOfEl = document.getElementById('deepDiveFiscalPeriod');
  if (asOfEl) {
    const fy = stock.summary?.metrics?.fiscalPeriodEnd;
    const fx = stock.financials?.fx;
    // Depositary receipts trade in one currency and file in another. Say so,
    // rather than letting a EUR balance sheet sit under a dollar price.
    const fxNote = fx?.needed
      ? fx.available
        ? ` · trades in ${tradedCcy(stock)}, reports in ${reportingCcy(stock)} ` +
          `(1 ${tradedCcy(stock)} = ${fx.rate.toFixed(4)} ${reportingCcy(stock)})`
        : ` · trades in ${tradedCcy(stock)}, reports in ${reportingCcy(stock)} — no exchange rate available`
      : '';
    asOfEl.textContent = fy ? `Fundamentals as filed to ${fy}${fxNote}` : '';
    asOfEl.hidden = !fy;
  }

  // Render 5-Pillars Breakdown
  const pillarsContainer = document.getElementById('deepDivePillars');
  if (pillarsContainer && stock.pillars) {
    pillarsContainer.innerHTML = stock.pillars.map(p => `
      <div class="pillar-meter-item">
        <div class="pillar-meter-label">
          <span>${p.name}</span>
          <span class="mono">${p.score}/20</span>
        </div>
        <div class="pillar-meter-bar-bg">
          <div class="pillar-meter-bar-fill" style="width: ${p.pct}%; background: ${getPillarColor(p.pct)};"></div>
        </div>
      </div>
    `).join('');
  }
}

function renderOverviewSubtab(stock) {
  // Update AI Overview Card if already cached
  if (state.aiSummaries[stock.ticker]) {
    updateOverviewAICard(stock.ticker, state.aiSummaries[stock.ticker]);
  } else {
    resetOverviewAICard(stock.ticker);
  }

  // Catalysts
  const catList = document.getElementById('catalystsList');
  if (catList && stock.catalysts) {
    catList.innerHTML = stock.catalysts.map(c => `
      <div style="display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; background: var(--bg-surface-subtle); border-radius: var(--radius-sm);">
        <span style="font-size: 18px;">${c.icon || '⚡'}</span>
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--health-pristine);">${c.title}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${c.text}</div>
        </div>
      </div>
    `).join('');
  }

  // Risks
  const riskList = document.getElementById('risksList');
  if (riskList && stock.risks) {
    riskList.innerHTML = stock.risks.map(r => `
      <div style="display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; background: var(--bg-surface-subtle); border-radius: var(--radius-sm);">
        <span style="font-size: 18px;">${r.icon || '⚠️'}</span>
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--health-moderate);">${r.title}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${r.text}</div>
        </div>
      </div>
    `).join('');
  }

  // Key Ratios Grid
  const grid = document.getElementById('multiplesGrid');
  if (grid) {
    const m = stock.summary?.metrics || {};
    const r = stock.summary?.ratios || {};
    const pe = stock.summary?.peHistory;
    const cur = reportingCcy(stock);

    // `good` is null where the metric itself is unavailable, so an em dash is
    // never painted in the "healthy" colour.
    const ok = (value, test) => (isNum(value) ? test(value) : null);

    const items = m.isFinancial
      ? [
          { label: 'Return on equity', val: fmtPct(m.roe), good: ok(m.roe, (v) => v >= 0.12) },
          { label: 'Equity / assets', val: fmtPct(m.equityToAssets), good: ok(m.equityToAssets, (v) => v >= 0.08) },
          { label: 'Piotroski F-Score', val: isNum(stock.piotroski_score) ? `${stock.piotroski_score}/9` : EM_DASH, good: ok(stock.piotroski_score, (v) => v >= 7) },
          { label: 'Revenue CAGR', val: fmtPct(m.revenueCAGR, 1, { sign: true }), good: ok(m.revenueCAGR, (v) => v >= 0.08) },
          { label: 'Trailing P/E', val: fmtNum(r.pe, 1, 'x'), good: ok(r.pe, (v) => v < 15) },
          { label: 'Price / book', val: fmtNum(r.priceToBook, 2, 'x'), good: ok(r.priceToBook, (v) => v < 1.5) },
          { label: 'Share count YoY', val: fmtPct(m.shareChangeYoY, 1, { sign: true }), good: ok(m.shareChangeYoY, (v) => v <= 0.005) },
          { label: 'Dividend yield', val: fmtPct(m.dividendYield), good: ok(m.dividendYield, (v) => v > 0) }
        ]
      : [
          { label: 'ROIC', val: fmtPct(stock.roic_pct, 1, { alreadyPercent: true }), good: ok(stock.roic_pct, (v) => v >= 15) },
          { label: 'ROIC − WACC', val: isNum(m.roicSpread) ? fmtPct(m.roicSpread, 1, { alreadyPercent: true, sign: true }) : EM_DASH, good: ok(m.roicSpread, (v) => v >= 5) },
          { label: 'Altman Z-Score', val: fmtNum(stock.altman_z, 2), good: ok(stock.altman_z, (v) => v >= 3) },
          { label: 'Piotroski F-Score', val: isNum(stock.piotroski_score) ? `${stock.piotroski_score}/9` : EM_DASH, good: ok(stock.piotroski_score, (v) => v >= 7) },
          { label: 'FCF conversion', val: fmtPct(stock.fcf_conversion_pct, 0, { alreadyPercent: true }), good: ok(stock.fcf_conversion_pct, (v) => v >= 90) },
          { label: 'Gross margin', val: fmtPct(m.grossMargin), good: ok(m.grossMargin, (v) => v >= 0.4) },
          { label: 'Trailing P/E', val: fmtNum(r.pe, 1, 'x'), good: ok(r.pe, (v) => v < 30) },
          { label: 'Net cash', val: fmtBillions(stock.net_cash_b, cur), good: ok(stock.net_cash_b, (v) => v > 0) }
        ];

    // 5-year percentile scrubber for the multiples that have a history.
    const scrubber = pe?.available
      ? `
      <div class="ratio-range-card">
        <div class="ratio-range-head">
          <span>P/E vs. its own 5-year range</span>
          <span class="mono">${fmtNum(pe.current, 1, 'x')} · ${pe.percentile}th pct</span>
        </div>
        <div class="ratio-range-track">
          <div class="ratio-range-band" style="left: ${
            Math.max(0, Math.min(100, ((pe.p20 - pe.min) / Math.max(pe.max - pe.min, 0.01)) * 100))
          }%; width: ${
            Math.max(2, Math.min(100, ((pe.p80 - pe.p20) / Math.max(pe.max - pe.min, 0.01)) * 100))
          }%;"></div>
          <div class="ratio-range-median" style="left: ${
            Math.max(0, Math.min(100, ((pe.median - pe.min) / Math.max(pe.max - pe.min, 0.01)) * 100))
          }%;" title="5-year median ${pe.median}x"></div>
          <div class="ratio-range-pin" style="left: ${
            Math.max(0, Math.min(100, ((pe.current - pe.min) / Math.max(pe.max - pe.min, 0.01)) * 100))
          }%;" title="Now ${pe.current}x"></div>
        </div>
        <div class="ratio-range-scale mono">
          <span>${fmtNum(pe.min, 1, 'x')}</span>
          <span>median ${fmtNum(pe.median, 1, 'x')}</span>
          <span>${fmtNum(pe.max, 1, 'x')}</span>
        </div>
      </div>`
      : '';

    grid.innerHTML = items.map(it => `
      <div class="ratio-card">
        <div class="ratio-card-label">${it.label}</div>
        <div class="mono ratio-card-value ${
          it.good === null ? 'is-unavailable' : it.good ? 'is-good' : ''
        }">${it.val}</div>
      </div>
    `).join('') + scrubber;
  }
}

// ----------------- GEMINI AI ANALYSIS & SUMMARY -----------------
async function fetchCachedAISummary(ticker) {
  try {
    const res = await apiFetch(`/api/stock/${ticker}/ai-summary`);
    if (res.ok) {
      const data = await res.json();
      if (data.summary) {
        state.aiSummaries[ticker] = data.summary;
        updateOverviewAICard(ticker, data.summary);
        if (state.activeSubtab === 'gemini' && state.currentTicker === ticker) {
          renderGeminiDashboard(data.summary);
        }
        return data.summary;
      }
    }
  } catch (e) {
    console.warn('[AI] Cached summary fetch warning:', e);
  }
  return null;
}

function ensureGeminiSubtabRendered(ticker) {
  const container = document.getElementById('geminiAnalysisContainer');
  if (!container) return;

  if (state.aiSummaries[ticker]) {
    renderGeminiDashboard(state.aiSummaries[ticker]);
  } else {
    renderGeminiCTA(ticker);
    fetchCachedAISummary(ticker);
  }
}

/**
 * One sentence describing whether the next analysis will carry the user's own
 * writing. Rendered wherever an analysis can be started, so the disclosure sits
 * at the point of the decision rather than only in Settings.
 */
function aiNotesDisclosure() {
  return state.appSettings.ai_include_notes
    ? `<span class="ai-notes-note is-on">Your notes for this company — conviction, target price,
       rationale and sell guardrails — are included. Change this in Settings.</span>`
    : `<span class="ai-notes-note">Your own notes are not included. You can turn that on in Settings.</span>`;
}

function resetOverviewAICard(ticker) {
  const body = document.getElementById('overviewAiBody');
  if (!body) return;
  body.innerHTML = `
    <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
      Sends all financial statements, computed ratios (Altman Z, Piotroski, ROIC, DCF), and 12-point checklist to Gemini for an executive summary, moat breakdown, and conclusion with explanations.
    </p>
    <p style="font-size: 11.5px; margin-bottom: 12px;">${aiNotesDisclosure()}</p>
    <button class="btn-ai-sparkle" id="overviewGeminiActionBtn" style="width: 100%;">
      ✨ Analyze with Gemini AI
    </button>
  `;
  document.getElementById('overviewGeminiActionBtn')?.addEventListener('click', () => {
    switchSubtab('gemini');
    if (!state.aiSummaries[state.currentTicker]) {
      generateGeminiSummary(state.currentTicker, false);
    }
  });
}

function renderGeminiCTA(ticker) {
  const container = document.getElementById('geminiAnalysisContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="card ai-teaser-card" style="text-align: center; padding: 32px 16px;">
      <div style="font-size: 36px; margin-bottom: 10px;">✨</div>
      <h3 class="section-title ai-gradient-text" style="font-size: 18px; margin-bottom: 8px;">
        Gemini AI Fundamental Moat & Valuation Analysis
      </h3>
      <p style="font-size: 13px; color: var(--text-secondary); max-width: 480px; margin: 0 auto 18px auto; line-height: 1.5;">
        Send <strong>${ticker}</strong>'s complete financial statements, computed quantitative KPIs (Altman Z, Piotroski, ROIC, DCF), and 12-point checklist to Google Gemini for a rigorous, Buffett-style value investing synthesis.
      </p>
      <p style="font-size: 11.5px; max-width: 480px; margin: -8px auto 18px auto;">${aiNotesDisclosure()}</p>
      <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;">
        <span class="score-badge ai-badge-pill">🏰 Moat & Pricing Power</span>
        <span class="score-badge ai-badge-pill">🛡️ Balance Sheet Fortress</span>
        <span class="score-badge ai-badge-pill">🎯 DCF Margin of Safety</span>
        <span class="score-badge ai-badge-pill">🚦 12-Point Checklist</span>
      </div>
      <button class="btn-ai-sparkle" id="runGeminiCTAActionBtn" style="font-size: 14px; padding: 12px 24px;">
        ✨ Generate AI Moat & Health Summary
      </button>
    </div>
  `;

  document.getElementById('runGeminiCTAActionBtn')?.addEventListener('click', () => {
    generateGeminiSummary(ticker, true);
  });
}

function renderGeminiLoading(ticker) {
  const container = document.getElementById('geminiAnalysisContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="ai-loader-card">
      <div class="ai-sparkle-spin">✨</div>
      <h3 class="section-title ai-gradient-text" style="font-size: 16px; margin-bottom: 6px;">
        Analyzing ${ticker} with Gemini 3.7 Flash…
      </h3>
      <p style="font-size: 12px; color: var(--text-secondary); max-width: 360px; margin: 0 auto 16px auto;">
        Synthesizing 25+ fundamental metrics, balance sheet leverage, and intrinsic fair value.
      </p>

      <div class="ai-progress-steps">
        <div class="ai-step-item">
          <div class="ai-step-dot"></div>
          <span>1. Packing financial statement ratios & KPIs…</span>
        </div>
        <div class="ai-step-item">
          <div class="ai-step-dot" style="animation-delay: 0.3s;"></div>
          <span>2. Evaluating 12-point traffic-light checklist…</span>
        </div>
        <div class="ai-step-item">
          <div class="ai-step-dot" style="animation-delay: 0.6s;"></div>
          <span>3. Running DCF intrinsic valuation & moat tests…</span>
        </div>
        <div class="ai-step-item">
          <div class="ai-step-dot" style="animation-delay: 0.9s;"></div>
          <span>4. Formulating Buffett-style verdict & explanations…</span>
        </div>
      </div>
    </div>
  `;
}

function renderGeminiError(ticker, errorMsg) {
  const container = document.getElementById('geminiAnalysisContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="card" style="text-align: center; padding: 28px 16px; border-color: var(--health-risk-border);">
      <div style="font-size: 32px; margin-bottom: 8px;">⚠️</div>
      <h3 style="font-size: 16px; font-weight: 700; color: var(--health-risk); margin-bottom: 6px;">
        Gemini Analysis Error
      </h3>
      <p style="font-size: 12px; color: var(--text-secondary); max-width: 400px; margin: 0 auto 16px auto;">
        ${errorMsg || 'Unable to complete AI analysis. Check your connection or API key.'}
      </p>
      <button class="btn-primary" id="retryGeminiBtn">
        🔄 Retry Analysis
      </button>
    </div>
  `;

  document.getElementById('retryGeminiBtn')?.addEventListener('click', () => {
    generateGeminiSummary(ticker, true);
  });
}

async function generateGeminiSummary(ticker, force = false) {
  renderGeminiLoading(ticker);

  try {
    const res = await apiFetch(`/api/stock/${ticker}/ai-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRefresh: force })
    });

    const data = await res.json();
    if (!res.ok || !data.success || !data.summary) {
      throw new Error(data.error || 'Failed to generate Gemini analysis');
    }

    state.aiSummaries[ticker] = data.summary;
    renderGeminiDashboard(data.summary);
    updateOverviewAICard(ticker, data.summary);
    showToast('✨ Gemini analysis complete!', '🤖');
  } catch (err) {
    console.error('Gemini error:', err);
    renderGeminiError(ticker, err.message);
  }
}

function updateOverviewAICard(ticker, summary) {
  const card = document.getElementById('overviewAiCard');
  const body = document.getElementById('overviewAiBody');
  if (!card || !body || !summary || summary.ticker !== ticker) return;

  const badgeClass = summary.verdictGrade === 'PRISTINE_MOAT' ? 'pristine'
    : summary.verdictGrade === 'SOLID_COMPOUNDER' ? 'good'
    : summary.verdictGrade === 'VALUATION_WATCH' ? 'watch'
    : 'risk';

  body.innerHTML = `
    <div style="margin-bottom: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
        <span class="ai-verdict-badge ${badgeClass}" style="font-size: 11px; padding: 2px 8px;">${summary.verdictBadge || '👑 Moat Verdict'}</span>
        <span style="font-size: 11px; color: var(--text-tertiary);">Generated by Gemini</span>
      </div>
      <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); line-height: 1.4; margin-bottom: 6px;">
        "${summary.verdict}"
      </div>
      <p style="font-size: 12px; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">
        ${summary.executiveSummary}
      </p>
    </div>
    <button class="btn-ai-sparkle" id="overviewViewFullAiBtn" style="width: 100%;">
      ✨ View Full Explanations & Conclusion →
    </button>
  `;

  document.getElementById('overviewViewFullAiBtn')?.addEventListener('click', () => {
    switchSubtab('gemini');
  });
}

function renderGeminiDashboard(data) {
  const container = document.getElementById('geminiAnalysisContainer');
  if (!container) return;

  const verdictClass = data.verdictGrade === 'PRISTINE_MOAT' ? 'pristine'
    : data.verdictGrade === 'SOLID_COMPOUNDER' ? 'good'
    : data.verdictGrade === 'VALUATION_WATCH' ? 'watch'
    : 'risk';

  const dateFormatted = data.generatedAt
    ? `${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${new Date(data.generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Recently';

  // What this particular analysis was built from, which is not necessarily what
  // the setting says today — the preference can be changed after the fact, and
  // a saved analysis has to keep describing itself accurately. Summaries cached
  // before the setting existed carry no flag, and say nothing rather than guess.
  const notesProvenance = typeof data.includedNotes === 'boolean'
    ? (data.includedNotes
        ? ' · <span class="ai-notes-note is-on">included your notes</span>'
        : ' · <span class="ai-notes-note">financial data only</span>')
    : '';

  container.innerHTML = `
    <!-- 1. AI Verdict Hero Card -->
    <div class="card card-elevated ai-verdict-card" style="margin-bottom: 16px;">
      <div class="ai-verdict-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">✨</span>
          <span style="font-size: 13px; font-weight: 700; color: #C084FC;">Warren Buffett AI Framework</span>
        </div>
        <span class="ai-verdict-badge ${verdictClass}">${data.verdictBadge || '👑 Moat Verdict'}</span>
      </div>
      <div class="ai-verdict-title">${data.verdict}</div>
      ${data.buffettPrinciple ? `
        <div class="ai-quote-box">
          <strong>Buffett / Munger Rule:</strong> "${data.buffettPrinciple}"
        </div>
      ` : ''}
    </div>

    <!-- 2. Executive Summary Card -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="section-title ai-gradient-text" style="margin-bottom: 10px;">
        📝 Executive Moat & Health Summary
      </div>
      <div style="font-size: 13px; color: var(--text-primary); line-height: 1.6; white-space: pre-line;">
        ${data.executiveSummary}
      </div>
    </div>

    <!-- 3. Fundamental Deep-Dive Pillars -->
    <div class="ai-pillar-grid">
      <!-- Moat & Profitability -->
      <div class="ai-pillar-card">
        <div class="ai-pillar-header">
          <div class="ai-pillar-title">🏰 Economic Moat & Pricing Power</div>
          <span class="ai-pillar-rating-chip" style="background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3);">${data.moatAndProfitability?.ratingLabel || data.moatAndProfitability?.rating || 'Wide Moat'}</span>
        </div>
        <p class="ai-pillar-explanation">${data.moatAndProfitability?.explanation || ''}</p>
      </div>

      <!-- Solvency & Safety -->
      <div class="ai-pillar-card">
        <div class="ai-pillar-header">
          <div class="ai-pillar-title">🛡️ Balance Sheet & Solvency</div>
          <span class="ai-pillar-rating-chip" style="background: rgba(6, 182, 212, 0.15); color: #38BDF8; border: 1px solid rgba(6, 182, 212, 0.3);">${data.solvencyAndSafety?.ratingLabel || data.solvencyAndSafety?.rating || 'Fortress'}</span>
        </div>
        <p class="ai-pillar-explanation">${data.solvencyAndSafety?.explanation || ''}</p>
      </div>

      <!-- Valuation & DCF -->
      <div class="ai-pillar-card">
        <div class="ai-pillar-header">
          <div class="ai-pillar-title">🎯 Valuation & Margin of Safety</div>
          <span class="ai-pillar-rating-chip" style="background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3);">${data.valuationAndDCF?.ratingLabel || data.valuationAndDCF?.rating || 'Fair Value'}</span>
        </div>
        <p class="ai-pillar-explanation">${data.valuationAndDCF?.explanation || ''}</p>
      </div>
    </div>

    <!-- 4. Key Strengths & Catalysts -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="section-title" style="margin-bottom: 12px; color: var(--health-pristine);">
        ⚡ Key Moat Strengths & Competitive Advantages
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${(data.keyStrengths || []).map(s => `
          <div class="ai-strength-item">
            <span style="font-size: 16px;">🟢</span>
            <div>
              <div class="ai-strength-title">${s.title}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${s.detail}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 5. Key Risks & Critical Watchpoints -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="section-title" style="margin-bottom: 12px; color: var(--health-moderate);">
        ⚠️ Key Risks & Critical Watchpoints
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${(data.keyRisks || []).map(r => `
          <div class="ai-risk-item">
            <span style="font-size: 16px;">🟡</span>
            <div>
              <div class="ai-risk-title">${r.title}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${r.detail}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 6. Actionable Takeaways & Buy Target Zone -->
    <div class="ai-buyzone-card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
        <div class="section-title" style="color: var(--brand-cyan);">🎯 Value Investor Buy Zone & Strategy</div>
        ${isNum(data.buyZone?.maxPrice) ? `<span class="score-badge ${
          data.buyZone.alreadyInZone ? 'pristine' : 'moderate'
        } mono">${data.buyZone.alreadyInZone ? 'In zone' : 'Above zone'} · up to ${
          fmtPrice(data.buyZone.maxPrice, data.buyZone.currency || data.currency)
        }</span>` : ''}
      </div>
      ${data.buyZone?.perspective ? `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">${data.buyZone.perspective}</p>` : ''}
      <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5; padding: 10px 12px; background: var(--bg-surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 8px;">
        <strong>Conclusion:</strong> ${data.conclusion}
      </div>
      ${data.whatToWatch && data.whatToWatch.length > 0 ? `
        <div style="margin-top: 10px;">
          <span style="font-size: 11px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase;">Filings Watchlist:</span>
          <ul style="margin: 6px 0 0 18px; font-size: 12px; color: var(--text-secondary);">
            ${data.whatToWatch.map(w => `<li style="margin-bottom: 4px;">${w}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>

    ${data.contextFromModelKnowledge?.hasContext && data.contextFromModelKnowledge.points?.length ? `
      <div class="card ai-recall-card">
        <div class="ai-recall-head">
          <span class="ai-recall-title">Context the filings don't contain</span>
          <span class="ai-recall-tag">from the model's own knowledge</span>
        </div>
        <p class="ai-recall-caveat">
          Not measured from any filing — this is the model recalling what it knows about the
          company${data.contextFromModelKnowledge.asOfCaveat
            ? `. ${String(data.contextFromModelKnowledge.asOfCaveat).replace(/[.\s]+$/, '')}`
            : ', and its knowledge has a cutoff date'}. Verify before acting on it.
        </p>
        <ul class="ai-recall-list">
          ${data.contextFromModelKnowledge.points.map(p => `
            <li>
              <span class="ai-confidence is-${(p.confidence || 'low').toLowerCase()}">${p.confidence}</span>
              <span>${p.claim}</span>
            </li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${data.dataLimitations?.length ? `
      <div class="card ai-limits-card">
        <div class="ai-recall-head">
          <span class="ai-recall-title">What limits this analysis</span>
        </div>
        <ul class="ai-limits-list">
          ${data.dataLimitations.map(l => `<li>${l}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    <!-- 7. Meta Bar -->
    <div class="ai-meta-bar">
      <span>🤖 Model: <strong class="mono">${data.model || 'Gemini'}</strong> · Generated: ${dateFormatted}${notesProvenance}</span>
      <button class="btn-secondary" id="reAnalyzeGeminiBtn" style="padding: 4px 10px; font-size: 11px;">🔄 Re-Analyze</button>
    </div>
  `;

  document.getElementById('reAnalyzeGeminiBtn')?.addEventListener('click', () => {
    generateGeminiSummary(data.ticker, true);
  });
}

function renderChecklistSubtab(stock) {
  const container = document.getElementById('checklistFullList');
  const badge = document.getElementById('checklistScoreBadge');
  const items = stock.checklist || [];
  const summary = stock.summary?.checklistSummary || {};

  const LABEL = { pass: 'Pass', watch: 'Watch', fail: 'Fail', na: 'Not reported' };

  badge.textContent =
    `${summary.passCount || 0} pass · ${summary.watchCount || 0} watch · ${summary.failCount || 0} fail` +
    (summary.naCount ? ` · ${summary.naCount} not reported` : '');

  container.innerHTML = items.map(item => `
    <div class="checklist-item${item.status === 'na' ? ' is-na' : ''}" data-check-id="${item.id}">
      <div class="checklist-item-header">
        <div class="checklist-left">
          <div class="status-dot ${item.status}"></div>
          <div>
            <span class="checklist-name">${item.name}</span>
            <span class="checklist-category">${item.category}</span>
          </div>
        </div>
        <div class="checklist-right">
          <span class="checklist-value mono">${item.value ?? EM_DASH}</span>
          <span class="status-tag ${item.status}">${LABEL[item.status] || item.status}</span>
        </div>
      </div>
      <div class="checklist-drawer" id="drawer-${item.id}">
        ${item.benchmark ? `<div class="checklist-benchmark mono">Target: ${item.benchmark}</div>` : ''}
        <div>${item.explanation}</div>
        ${item.status === 'na'
          ? '<div class="checklist-na-note">Not scored — this measure is absent from the filings for this company, so it neither helps nor hurts the composite.</div>'
          : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.checklist-item').forEach((row) => {
    row.addEventListener('click', () => {
      haptic();
      document.getElementById(`drawer-${row.getAttribute('data-check-id')}`).classList.toggle('open');
    });
  });
}

function renderTrendsSubtab(stock) {
  const hist = stock.financials?.historical || {};
  const cur = reportingCcy(stock);
  const m = stock.summary?.metrics || {};

  const years = hist.years || [];
  const rev = hist.revenue || [];
  const fcf = hist.freeCashFlow || [];
  const gm = hist.grossMarginPct || [];
  const om = hist.operatingMarginPct || [];
  const shares = hist.sharesOutstanding || [];

  const empty = (message) =>
    `<div class="chart-empty">${message}</div>`;

  // --- Chart 1: revenue against free cash flow ------------------------------
  const chartContainer = document.getElementById('revFcfChart');
  const plottable = years.length && rev.some(isNum);

  if (!plottable) {
    chartContainer.innerHTML = empty('No revenue history filed for this company.');
  } else {
    const maxVal = Math.max(...[...rev, ...fcf].filter(isNum).map(Math.abs), 1);
    chartContainer.innerHTML = years.map((yr, idx) => {
      const rVal = rev[idx];
      const fVal = fcf[idx];
      // A year the filer did not report draws no bar at all — the previous
      // build padded missing years with a scaled-down copy of the next one.
      const bar = (value, cls) =>
        isNum(value)
          ? `<div class="bar-column ${cls}${value < 0 ? ' is-negative' : ''}"
                  style="height: ${Math.max(3, Math.round((Math.abs(value) / maxVal) * 100))}%;"
                  title="${cls === 'rev' ? 'Revenue' : 'Free cash flow'} ${yr}: ${fmtBillions(value, cur)}"></div>`
          : `<div class="bar-column is-missing" title="${yr}: not reported"></div>`;

      return `
        <div class="bar-group">
          <div class="bars-pair">
            ${bar(rVal, 'rev')}
            ${bar(fVal, 'fcf')}
          </div>
          <div class="bar-year-label mono">${Number.isFinite(yr) ? yr : EM_DASH}</div>
        </div>`;
    }).join('');
  }

  const firstRev = rev.find(isNum);
  const lastRev = [...rev].reverse().find(isNum);
  const cagrLabel = m.cagrYears ? `${m.cagrYears}Y CAGR` : 'CAGR';
  document.getElementById('revFcfSummaryText').textContent = plottable
    ? `Revenue ${fmtBillions(firstRev, cur)} → ${fmtBillions(lastRev, cur)} ` +
      `(${fmtPct(m.revenueCAGR, 1, { sign: true })} ${cagrLabel}) · ` +
      `Cash conversion ${fmtPct(stock.fcf_conversion_pct, 0, { alreadyPercent: true })}`
    : 'Revenue history is not available for this listing.';

  // --- Chart 2: liquidity against debt --------------------------------------
  const cash = m.cash;
  const debt = m.totalDebt;
  const stackEl = document.getElementById('balanceSheetStack');

  if (!isNum(cash) && !isNum(debt)) {
    stackEl.innerHTML = empty('Balance sheet detail is not filed for this listing.');
  } else {
    const scale = Math.max(Math.abs(cash || 0), Math.abs(debt || 0), 1);
    stackEl.innerHTML = `
      <div class="stack-row">
        <span class="stack-label">Cash & short-term investments</span>
        <div class="stack-track">
          <div class="stack-fill is-cash" style="width: ${((cash || 0) / scale) * 100}%;"></div>
        </div>
        <span class="mono text-emerald">${fmtMoney(cash, cur)}</span>
      </div>
      <div class="stack-row">
        <span class="stack-label">Total debt</span>
        <div class="stack-track">
          <div class="stack-fill is-debt" style="width: ${((debt || 0) / scale) * 100}%;"></div>
        </div>
        <span class="mono text-coral">${fmtMoney(debt, cur)}</span>
      </div>
      <div class="stack-verdict">
        ${
          !isNum(m.netCash)
            ? '<span class="text-muted">Net position not computable from the filed data.</span>'
            : m.netCash > 0
              ? `💎 <span class="text-emerald">Net cash of ${fmtMoney(m.netCash, cur)}</span>`
              : `<span class="text-coral">Net debt of ${fmtMoney(Math.abs(m.netCash), cur)}</span>`
        }
      </div>`;
  }

  // --- Chart 3: margin trajectory -------------------------------------------
  const marginContainer = document.getElementById('marginTrendContainer');
  const marginSeries = [
    { label: 'Gross margin', values: gm, cls: 'is-gross', change: m.grossMarginChangeBps },
    { label: 'Operating margin', values: om, cls: 'is-operating', change: m.operatingMarginChangeBps }
  ].filter((serie) => serie.values.some(isNum));

  if (!marginSeries.length) {
    marginContainer.innerHTML = empty(
      m.isFinancial
        ? 'Lenders do not report a gross margin — return on equity is the comparable measure.'
        : 'No margin history filed for this company.'
    );
  } else {
    const all = marginSeries.flatMap((serie) => serie.values.filter(isNum));
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = Math.max(hi - lo, 1);
    const y = (v) => 100 - ((v - lo) / span) * 84 - 8;
    const x = (i, n) => (n <= 1 ? 50 : (i / (n - 1)) * 100);

    marginContainer.innerHTML = `
      <svg class="margin-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label="Margin trajectory across the filed fiscal years">
        ${marginSeries.map((serie) => {
          const pts = serie.values
            .map((v, i) => (isNum(v) ? `${x(i, serie.values.length).toFixed(2)},${y(v).toFixed(2)}` : null))
            .filter(Boolean);
          return pts.length > 1
            ? `<polyline class="margin-line ${serie.cls}" points="${pts.join(' ')}"
                         vector-effect="non-scaling-stroke" />`
            : '';
        }).join('')}
      </svg>
      <div class="margin-legend">
        ${marginSeries.map((serie) => {
          const last = [...serie.values].reverse().find(isNum);
          return `
            <div class="margin-legend-row">
              <span class="margin-swatch ${serie.cls}"></span>
              <span>${serie.label}</span>
              <span class="mono">${fmtPct(last, 1, { alreadyPercent: true })}</span>
              <span class="mono ${isNum(serie.change) && serie.change < 0 ? 'text-coral' : 'text-emerald'}">
                ${isNum(serie.change) ? `${serie.change >= 0 ? '+' : ''}${serie.change} bps` : EM_DASH}
              </span>
            </div>`;
        }).join('')}
      </div>
      <div class="chart-axis mono">${years.map((yr) => `<span>${Number.isFinite(yr) ? yr : EM_DASH}</span>`).join('')}</div>`;
  }

  // --- Chart 4: share count --------------------------------------------------
  const sharesContainer = document.getElementById('sharesTrendContainer');
  const sharePoints = shares.filter(isNum);

  if (sharePoints.length < 2) {
    sharesContainer.innerHTML = empty('Share count history is not filed for this listing.');
  } else {
    const first = sharePoints[0];
    const last = sharePoints[sharePoints.length - 1];
    const totalChange = (last - first) / first;
    const retiring = last < first;

    sharesContainer.innerHTML = `
      <div class="shares-row">
        <span>Diluted shares</span>
        <span class="mono ${retiring ? 'text-emerald' : 'text-amber'}">
          ${shares.map((v) => (isNum(v) ? `${v}B` : EM_DASH)).join(' → ')}
        </span>
      </div>
      <div class="shares-note">
        ${
          retiring
            ? `🟢 Share count down ${fmtPct(Math.abs(totalChange))} in total ` +
              `(${fmtPct(m.shareChangeYoY, 1, { sign: true })} in the latest year), lifting per-share value.`
            : `⚠️ Share count up ${fmtPct(Math.abs(totalChange))} in total ` +
              `(${fmtPct(m.shareChangeYoY, 1, { sign: true })} in the latest year) — dilution from stock compensation.`
        }
      </div>`;
  }
}

// ----------------- DCF INTRINSIC VALUE SANDBOX -----------------
function getStockDCFBaselines(stock) {
  const target = stock || state.currentStock;
  const assumptions = target?.summary?.dcf?.assumptions;

  // Start from exactly what the server modelled, so the sandbox opens on the
  // same numbers the scorecard was built from.
  return {
    baseGrowth: Math.round((assumptions?.growthRate ?? 0.06) * 100),
    baseMultiple: Math.round(assumptions?.terminalMultiple ?? 15),
    baseDiscount: Number(((assumptions?.discountRate ?? 0.095) * 100).toFixed(1))
  };
}

function initDCFSandbox(stock) {
  setDCFPreset('base', stock);
}

function setDCFPreset(preset, stockOverride) {
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  const { baseGrowth, baseMultiple, baseDiscount } = getStockDCFBaselines(stockOverride || state.currentStock);

  if (preset === 'bear') {
    document.getElementById('dcfBearPreset')?.classList.add('active');
    // 35% worse than base, and able to go negative — a bear case for a
    // shrinking business is a faster decline, not a slower expansion.
    state.dcf.growth = Math.max(-25, Math.round(
      baseGrowth >= 0 ? baseGrowth * 0.65 : baseGrowth * 1.35
    ));
    state.dcf.multiple = 16;
    state.dcf.discount = 11.0;
  } else if (preset === 'bull') {
    document.getElementById('dcfBullPreset')?.classList.add('active');
    state.dcf.growth = Math.min(45, Math.round(
      baseGrowth >= 0 ? baseGrowth * 1.30 : baseGrowth * 0.70
    ));
    state.dcf.multiple = 32;
    state.dcf.discount = 9.0;
  } else {
    document.getElementById('dcfBasePreset')?.classList.add('active');
    state.dcf.growth = baseGrowth;
    state.dcf.multiple = baseMultiple;
    state.dcf.discount = baseDiscount;
  }

  const growthSlider = document.getElementById('dcfGrowthSlider');
  if (growthSlider) growthSlider.value = state.dcf.growth;
  const growthVal = document.getElementById('dcfGrowthVal');
  if (growthVal) growthVal.textContent = `${state.dcf.growth}%`;

  const multipleSlider = document.getElementById('dcfMultipleSlider');
  if (multipleSlider) multipleSlider.value = state.dcf.multiple;
  const multipleVal = document.getElementById('dcfMultipleVal');
  if (multipleVal) multipleVal.textContent = `${state.dcf.multiple.toFixed(1)}x`;

  const discountSlider = document.getElementById('dcfDiscountSlider');
  if (discountSlider) discountSlider.value = state.dcf.discount;
  const discountVal = document.getElementById('dcfDiscountVal');
  if (discountVal) discountVal.textContent = `${state.dcf.discount.toFixed(1)}%`;

  calculateClientDCF();
}

function calculateClientDCF() {
  const stock = state.currentStock;
  if (!stock) return;

  const cur = reportingCcy(stock);
  const m = stock.summary?.metrics || {};
  const serverDcf = stock.summary?.dcf || {};

  const fairValueEl = document.getElementById('dcfFairValueText');
  const priceEl = document.getElementById('dcfCurrentPriceText');
  const badge = document.getElementById('dcfMarginBadge');
  const table = document.getElementById('dcfBreakdownTable');
  const controls = document.getElementById('dcfControls');

  // The price the model works against, converted where the shares trade in a
  // different currency from the one the company reports in.
  const modelPrice = isNum(m.price) ? m.price : stock.price;
  priceEl.textContent = fmtPrice(modelPrice, cur);

  // A discounted-cash-flow model needs positive free cash flow and a share
  // count. Where either is missing the model is not run at all — the previous
  // build substituted $1bn of free cash flow and produced a fair value for
  // companies that were burning cash.
  const fcf0 = serverDcf.assumptions?.cashFlowBase ?? m.freeCashFlow;
  const shares = m.sharesOutstanding;
  const price = modelPrice;
  const blocked =
    serverDcf.applicable === false
      ? serverDcf.reason
      : !isNum(fcf0) || fcf0 <= 0
        ? 'negative-fcf'
        : !isNum(shares) || shares <= 0
          ? 'no-share-count'
          : null;

  if (blocked) {
    const explain = {
      'negative-fcf':
        'This company is not generating positive free cash flow, so a discounted cash flow model has nothing to discount. Judge it on the balance sheet and the path back to cash generation instead.',
      'no-share-count':
        'The diluted share count is not in the filings for this listing, so a per-share value cannot be derived.',
      'not-meaningful-for-financials':
        'Free cash flow is not owner earnings for a bank or insurer — deposit and loan flows dominate it. Book value and return on equity are the measures that apply here.'
    }[blocked] || 'This model cannot be run on the available filings.';

    fairValueEl.textContent = EM_DASH;
    badge.className = 'margin-of-safety-meter is-unavailable';
    badge.textContent = 'Fair value not modelled';
    table.innerHTML = `<div class="chart-empty">${explain}</div>`;
    if (controls) controls.hidden = true;
    return;
  }

  if (controls) controls.hidden = false;

  const g = state.dcf.growth / 100;
  const mult = state.dcf.multiple;
  const r = state.dcf.discount / 100;

  let fcf = fcf0;
  let cumulativePV = 0;
  const rows = [];
  for (let t = 1; t <= 5; t++) {
    fcf = fcf * (1 + g);
    const pv = fcf / Math.pow(1 + r, t);
    cumulativePV += pv;
    rows.push({ year: t, fcf, pv });
  }

  const terminalValue = fcf * mult;
  const pvTerminal = terminalValue / Math.pow(1 + r, 5);
  const enterpriseValue = cumulativePV + pvTerminal;
  const netCash = (m.cash ?? 0) - (m.totalDebt ?? 0);
  const equityValue = enterpriseValue + netCash;
  const fairValue = equityValue / shares;

  fairValueEl.textContent = fmtPrice(fairValue, cur);

  const factor = fairValue > 0 ? fairValue / price : null;
  const wideDivergence = factor !== null && (factor >= 3 || factor <= 0.33);

  if (fairValue <= 0) {
    badge.className = 'margin-of-safety-meter overvalued';
    badge.textContent =
      'No equity value at these assumptions — the discounted cash flows do not cover the debt.';
  } else if (wideDivergence) {
    // A fair value several multiples from the traded price almost always means
    // the assumptions are wrong, or the market is pricing something the
    // filings do not show. Presenting that as a large margin of safety invites
    // exactly the wrong conclusion.
    badge.className = 'margin-of-safety-meter is-divergent';
    badge.textContent =
      `This model lands ${factor >= 3 ? factor.toFixed(1) + '× above' : (1 / factor).toFixed(1) + '× below'}` +
      ' the traded price. A gap this wide usually means the assumptions need revisiting,' +
      ' or the market is pricing in something the filings do not show.';
  } else if (fairValue > price) {
    const marginPct = ((fairValue - price) / fairValue) * 100;
    badge.className = 'margin-of-safety-meter undervalued';
    badge.textContent = `Margin of safety ${fmtPct(marginPct, 1, { alreadyPercent: true, sign: true })} — trading below fair value`;
  } else {
    // Stated as a premium rather than a negative margin of safety: the
    // margin-of-safety form reaches −188% on an expensive stock and stops
    // carrying any meaning.
    const premiumPct = ((price - fairValue) / fairValue) * 100;
    badge.className = 'margin-of-safety-meter overvalued';
    badge.textContent = `${fmtPct(premiumPct, 1, { alreadyPercent: true })} above fair value at these assumptions`;
  }

  const line = (label, value, cls = '') =>
    `<div class="dcf-line"><span>${label}</span><span class="mono ${cls}">${value}</span></div>`;

  const assumptions = serverDcf.assumptions || {};
  table.innerHTML =
    line(
      assumptions.cashFlowBasis?.startsWith('three-year')
        ? 'Free cash flow base (3-year median)'
        : 'Trailing free cash flow',
      fmtMoney(fcf0, cur)
    ) +
    (assumptions.cashFlowBasis?.startsWith('three-year')
      ? line('Latest filed year (outlier, not used)', fmtMoney(assumptions.latestFiledCashFlow, cur), 'text-muted')
      : '') +
    line('Present value, years 1–5', fmtMoney(cumulativePV, cur)) +
    line(`Terminal value at ${mult.toFixed(1)}x, discounted`, fmtMoney(pvTerminal, cur)) +
    line('Net cash / (debt)', fmtMoney(netCash, cur), netCash >= 0 ? 'text-emerald' : 'text-coral') +
    line('Intrinsic equity value', fmtMoney(equityValue, cur), equityValue >= 0 ? 'text-cyan' : 'text-coral') +
    line('Diluted shares', `${(shares / 1e9).toFixed(2)}B`) +
    `<div class="dcf-line is-total"><span>Fair value per share</span>
       <span class="mono">${fmtPrice(fairValue, cur)}</span></div>` +
    // The rate that would make the model agree with the market. When the two
    // disagree this is the more useful of the two numbers: it states what you
    // would have to believe, rather than asserting who is right.
    (isNum(serverDcf.impliedGrowthRate)
      ? `<div class="dcf-implied">
           <strong>What the market is pricing in:</strong> at ${fmtPrice(price, cur)} the traded price
           implies free cash flow ${serverDcf.impliedGrowthRate < 0 ? 'shrinking' : 'growing'}
           <span class="mono">${fmtPct(Math.abs(serverDcf.impliedGrowthRate))}</span> a year for five years,
           against the <span class="mono">${fmtPct(state.dcf.growth, 1, { alreadyPercent: true, sign: true })}</span>
           set on the slider.
         </div>`
      : '') +
    `<table class="dcf-years"><thead><tr><th>Year</th><th>Projected FCF</th><th>Present value</th></tr></thead><tbody>` +
    rows.map((row) =>
      `<tr><td class="mono">${row.year}</td><td class="mono">${fmtMoney(row.fcf, cur)}</td><td class="mono">${fmtMoney(row.pv, cur)}</td></tr>`
    ).join('') +
    '</tbody></table>';
}

// ----------------- INVESTMENT THESIS & JOURNAL -----------------
async function loadInvestmentThesis(ticker) {
  try {
    const res = await apiFetch(`/api/theses/${ticker}`);
    const data = await res.json();
    state.thesis = data;

    document.getElementById('thesisConvictionSelect').value = data.conviction || 'high';
    document.getElementById('thesisTargetPrice').value = data.targetBuyPrice || '';
    document.getElementById('thesisRationale').value = data.coreRationale || '';

    renderSellTriggers();
    renderJournalEntries();
  } catch (err) {
    console.error('Error loading thesis:', err);
  }
}

async function handleSaveThesis() {
  if (!state.currentTicker) return;

  const conviction = document.getElementById('thesisConvictionSelect').value;
  const targetBuyPrice = parseFloat(document.getElementById('thesisTargetPrice').value) || null;
  const coreRationale = document.getElementById('thesisRationale').value.trim();

  state.thesis.conviction = conviction;
  state.thesis.targetBuyPrice = targetBuyPrice;
  state.thesis.coreRationale = coreRationale;

  try {
    const res = await apiFetch(`/api/theses/${state.currentTicker}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.thesis)
    });
    if (res.ok) {
      alert(`✅ Thesis saved for ${state.currentTicker}!`);
    }
  } catch (err) {
    console.error('Error saving thesis:', err);
  }
}

function renderSellTriggers() {
  const container = document.getElementById('sellTriggersList');
  const triggers = state.thesis.sellTriggers || [
    { id: '1', text: 'Gross margin drops below 55% for 2 quarters', triggered: false },
    { id: '2', text: 'Total debt exceeds 2.5x annual EBITDA', triggered: false },
    { id: '3', text: 'Share dilution exceeds 3% from SBC', triggered: false }
  ];

  state.thesis.sellTriggers = triggers;

  container.innerHTML = triggers.map(trig => `
    <div class="trigger-item">
      <input type="checkbox" class="trigger-checkbox" data-trig-id="${trig.id}" ${trig.triggered ? 'checked' : ''}>
      <span style="${trig.triggered ? 'text-decoration: line-through; color: var(--health-risk);' : ''}">${trig.text}</span>
    </div>
  `).join('');

  container.querySelectorAll('.trigger-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = cb.getAttribute('data-trig-id');
      const item = state.thesis.sellTriggers.find(t => t.id === id);
      if (item) {
        item.triggered = e.target.checked;
        handleSaveThesisSilent();
        renderSellTriggers();
      }
    });
  });
}

function handleAddGuardrail() {
  const text = prompt('Enter new objective exit guardrail:');
  if (text && text.trim()) {
    state.thesis.sellTriggers.push({
      id: Date.now().toString(),
      text: text.trim(),
      triggered: false
    });
    handleSaveThesisSilent();
    renderSellTriggers();
  }
}

function renderJournalEntries() {
  const container = document.getElementById('journalEntriesList');
  const entries = state.thesis.journalEntries || [];

  if (entries.length === 0) {
    container.innerHTML = `<div style="font-size: 12px; color: var(--text-tertiary);">No journal entries yet. Log your earnings reactions and thesis milestones.</div>`;
    return;
  }

  container.innerHTML = entries.map(e => `
    <div class="journal-entry">
      <div class="journal-date mono">📅 ${new Date(e.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
      <div class="journal-text">${e.note}</div>
    </div>
  `).join('');
}

async function handleSaveJournalNote() {
  const text = document.getElementById('newJournalNoteText').value.trim();
  if (!text) return;

  state.thesis.journalEntries.unshift({
    id: Date.now().toString(),
    date: new Date().toISOString(),
    note: text
  });

  document.getElementById('newJournalNoteText').value = '';
  closeModal('journalModal');
  await handleSaveThesisSilent();
  renderJournalEntries();
}

async function handleSaveThesisSilent() {
  if (!state.currentTicker) return;
  await apiFetch(`/api/theses/${state.currentTicker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.thesis)
  }).catch(() => {});
}

// ----------------- SCREENER LOGIC -----------------
async function loadScreenerData() {
  try {
    const res = await apiFetch('/api/screener');
    const data = await res.json();
    state.allScreenerStocks = data.stocks || [];
    filterScreenerStocks();
  } catch (err) {
    console.error('Screener fetch error:', err);
  }
}

function filterScreenerStocks() {
  const minHealth = parseInt(document.getElementById('filterHealthSlider')?.value || '0', 10);
  const minPiotroski = parseInt(document.getElementById('filterPiotroskiSlider')?.value || '0', 10);
  const minRoic = parseFloat(document.getElementById('filterRoicSlider')?.value || '0');
  const sector = document.getElementById('filterSectorSelect')?.value || 'all';

  const netCashOnly = document.getElementById('filterNetCash')?.checked;
  const fcfPositive = document.getElementById('filterFcfPositive')?.checked;
  const maxDe = parseFloat(document.getElementById('filterDebtEquitySlider')?.value || '5');

  const filtered = state.allScreenerStocks.filter(s => {
    // A null metric cannot satisfy a minimum. Treating it as passing would
    // surface exactly the companies we know least about.
    if (!isNum(s.health_score) || s.health_score < minHealth) return false;
    if (minPiotroski > 0 && (!isNum(s.piotroski_score) || s.piotroski_score < minPiotroski)) return false;
    if (minRoic > 0 && (!isNum(s.roic_pct) || s.roic_pct < minRoic)) return false;
    if (sector !== 'all' && s.sector !== sector) return false;
    if (netCashOnly && !(isNum(s.net_cash_b) && s.net_cash_b > 0)) return false;
    if (fcfPositive && !(isNum(s.free_cash_flow) && s.free_cash_flow > 0)) return false;
    if (maxDe < 5) {
      const hasNetCash = isNum(s.net_cash_b) && s.net_cash_b > 0;
      if (!hasNetCash && !(isNum(s.debt_to_equity) && s.debt_to_equity <= maxDe)) return false;
    }
    return true;
  });

  document.getElementById('screenerCountBadge').textContent =
    `${filtered.length} of ${state.allScreenerStocks.length}`;

  const tbody = document.getElementById('screenerTableBody');
  if (tbody) {
    tbody.innerHTML = filtered.map(s => `
      <tr data-ticker="${s.ticker}">
        <td>
          <span class="mono" style="font-weight: 700;">${s.ticker}</span>
          <div style="font-size: 11px; color: var(--text-secondary);">${s.name}</div>
        </td>
        <td class="mono">${fmtPrice(s.price, s.currency)}</td>
        <td>
          <span class="score-badge ${s.summary?.healthTier || 'good'}">${fmtScore(s.health_score)}${isNum(s.health_score) ? '/100' : ''}</span>
        </td>
        <td class="mono">${isNum(s.piotroski_score) ? `${s.piotroski_score}/9` : EM_DASH}</td>
        <td class="mono text-emerald">${fmtPct(s.roic_pct, 1, { alreadyPercent: true })}</td>
        <td class="mono">${isNum(s.net_cash_b) ? `${fmtBillions(s.net_cash_b, s.reporting_currency || s.currency)}${s.net_cash_b > 0 ? ' 💎' : ''}` : EM_DASH}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', () => {
        const ticker = row.getAttribute('data-ticker');
        openStockDeepDive(ticker);
      });
    });
  }
}

function setScreenerPreset({
  health = 0, piotroski = 0, roic = 0, debtToEquity = 5,
  netCash = false, fcfPositive = false, sector = 'all'
} = {}) {
  haptic();
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  set('filterHealthSlider', health);   text('filterHealthVal', health);
  set('filterPiotroskiSlider', piotroski); text('filterPiotroskiVal', piotroski);
  set('filterRoicSlider', roic);       text('filterRoicVal', `${roic}%`);
  set('filterDebtEquitySlider', debtToEquity);
  text('filterDebtEquityVal', debtToEquity >= 5 ? 'any' : `${debtToEquity.toFixed(2)}x`);
  set('filterSectorSelect', sector);

  const netCashBox = document.getElementById('filterNetCash');
  if (netCashBox) netCashBox.checked = netCash;
  const fcfBox = document.getElementById('filterFcfPositive');
  if (fcfBox) fcfBox.checked = fcfPositive;

  filterScreenerStocks();
}

// ----------------- PEER COMPARE MATRIX -----------------
async function runComparison() {
  const input = document.getElementById('compareInput')?.value || 'AAPL, MSFT, NVDA, GOOGL';
  const container = document.getElementById('compareMatrixContainer');

  try {
    const res = await apiFetch(`/api/compare?tickers=${encodeURIComponent(input)}`);
    const data = await res.json();
    const stocks = data.stocks || [];

    if (stocks.length === 0) {
      container.innerHTML = '<div class="card chart-empty">None of those symbols resolved to a listing.</div>';
      return;
    }

    const row = (label, render) => `
      <tr>
        <td><strong>${label}</strong></td>
        ${stocks.map((s) => `<td class="mono">${render(s)}</td>`).join('')}
      </tr>`;

    container.innerHTML = `
      ${renderCompareRadar(stocks)}
      <div class="stock-table-container">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${stocks.map((s) => `<th class="mono compare-head">${s.ticker}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Health score</strong></td>
              ${stocks.map((s) => `<td><span class="score-badge ${s.summary?.healthTier || 'good'}">${
                isNum(s.health_score) ? `${s.health_score}/100` : 'N/A'
              }</span></td>`).join('')}
            </tr>
            ${row('Altman Z-Score', (s) => fmtNum(s.altman_z, 2))}
            ${row('Piotroski F-Score', (s) => (isNum(s.piotroski_score) ? `${s.piotroski_score}/9` : EM_DASH))}
            ${row('ROIC', (s) => fmtPct(s.roic_pct, 1, { alreadyPercent: true }))}
            ${row('ROIC − WACC', (s) => (isNum(s.summary?.metrics?.roicSpread)
              ? fmtPct(s.summary.metrics.roicSpread, 1, { alreadyPercent: true, sign: true })
              : EM_DASH))}
            ${row('Cash conversion', (s) => fmtPct(s.fcf_conversion_pct, 0, { alreadyPercent: true }))}
            ${row('Gross margin', (s) => fmtPct(s.summary?.metrics?.grossMargin))}
            ${row('Operating margin', (s) => fmtPct(s.summary?.metrics?.operatingMargin))}
            ${row('Net cash / (debt)', (s) => fmtBillions(s.net_cash_b, reportingCcy(s)))}
            ${row('Current ratio', (s) => fmtNum(s.summary?.metrics?.currentRatio, 2))}
            ${row('Trailing P/E', (s) => fmtNum(s.summary?.ratios?.pe, 1, 'x'))}
            ${row('P/E vs 5y median', (s) => (isNum(s.summary?.peHistory?.vsMedianPct)
              ? fmtPct(s.summary.peHistory.vsMedianPct, 0, { alreadyPercent: true, sign: true })
              : EM_DASH))}
            ${row('Revenue CAGR', (s) => fmtPct(s.summary?.metrics?.revenueCAGR, 1, { sign: true }))}
            ${row('Checklist passed', (s) => {
              const c = s.summary?.checklistSummary;
              return c && c.scored ? `${c.passCount}/${c.scored}` : EM_DASH;
            })}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    console.error('Comparison error:', err);
    container.innerHTML = '<div class="card chart-empty">Could not load the comparison. Check the connection and try again.</div>';
  }
}

/**
 * Pillar radar. Each spoke is one of the five pillars, so the shape shows at a
 * glance where a company is strong and where its peers beat it — which a
 * column of numbers does not.
 */
function renderCompareRadar(stocks) {
  const AXES = ['Solvency', 'Profitability', 'Valuation', 'Growth', 'Capital'];
  const plotted = stocks.filter((s) => Array.isArray(s.pillars) && s.pillars.some((p) => isNum(p.score)));
  if (!plotted.length) return '';

  const COLORS = ['#38BDF8', '#10B981', '#F59E0B', '#A78BFA'];
  const size = 260;
  const c = size / 2;
  const rMax = c - 34;

  const point = (axisIndex, fraction) => {
    const angle = (Math.PI * 2 * axisIndex) / AXES.length - Math.PI / 2;
    const r = rMax * Math.max(0, Math.min(1, fraction));
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)];
  };

  const rings = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const pts = AXES.map((_, i) => point(i, f).map((v) => v.toFixed(1)).join(',')).join(' ');
      return `<polygon class="radar-ring" points="${pts}" />`;
    })
    .join('');

  const spokes = AXES.map((_, i) => {
    const [x, y] = point(i, 1);
    return `<line class="radar-spoke" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
  }).join('');

  const labels = AXES.map((name, i) => {
    const [x, y] = point(i, 1.2);
    return `<text class="radar-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
                  text-anchor="middle" dominant-baseline="middle">${name}</text>`;
  }).join('');

  const shapes = plotted.map((s, idx) => {
    const pts = AXES.map((_, i) => {
      const pillar = s.pillars[i];
      // An unmeasured pillar collapses to the centre rather than inventing a
      // midpoint, so a sparse company reads as sparse.
      const fraction = isNum(pillar?.score) ? pillar.score / 20 : 0;
      return point(i, fraction).map((v) => v.toFixed(1)).join(',');
    }).join(' ');
    const color = COLORS[idx % COLORS.length];
    return `<polygon class="radar-shape" points="${pts}" style="stroke: ${color}; fill: ${color};" />`;
  }).join('');

  const legend = plotted.map((s, idx) => `
    <span class="radar-legend-item">
      <span class="radar-swatch" style="background: ${COLORS[idx % COLORS.length]};"></span>
      ${s.ticker}
    </span>`).join('');

  return `
    <div class="card radar-card">
      <div class="section-title">Pillar comparison</div>
      <svg class="radar-chart" viewBox="0 0 ${size} ${size}" role="img"
           aria-label="Radar chart comparing the five pillar scores across the selected companies">
        ${rings}${spokes}${shapes}${labels}
      </svg>
      <div class="radar-legend">${legend}</div>
    </div>`;
}

/** Peers Yahoo associates with the open ticker, offered as one-tap compares. */
async function loadPeerSuggestions(ticker) {
  const host = document.getElementById('comparePeerChips');
  if (!host) return;
  host.innerHTML = '';

  try {
    const res = await apiFetch(`/api/stock/${encodeURIComponent(ticker)}/peers`);
    if (!res.ok) return;
    const { peers = [] } = await res.json();
    if (!peers.length) return;

    host.innerHTML =
      `<span class="peer-chip-label">Peers of ${ticker}:</span>` +
      peers.map((p) => `
        <button type="button" class="peer-chip" data-peer="${p.ticker}">
          ${p.ticker}${isNum(p.health_score) ? ` <span class="mono">${p.health_score}</span>` : ''}
        </button>`).join('');

    host.querySelectorAll('.peer-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        haptic();
        const field = document.getElementById('compareInput');
        const current = field.value.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
        const peer = chip.dataset.peer;
        if (!current.includes(peer)) current.push(peer);
        field.value = current.slice(0, 4).join(', ');
        runComparison();
      });
    });
  } catch {
    // Suggestions are a convenience; their absence is not worth an error.
  }
}

// ----------------- TOAST NOTIFICATIONS -----------------
function showToast(message, icon = '✓') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s forwards';
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}

// ----------------- SEARCH & ADD STOCK LOGIC -----------------
async function handleSearchInput() {
  const inputEl = document.getElementById('searchInput');
  const query = (inputEl?.value || '').trim();
  const list = document.getElementById('searchResultsList');
  const targetWlId = document.getElementById('searchTargetWatchlistSelect')?.value || state.activeWatchlistId;
  const targetWl = state.watchlists.find(w => w.id === targetWlId);
  const currentTickers = targetWl?.tickers || [];

  if (!list) return;

  if (!query) {
    // Render popular recommendation cards when input is empty
    const popularRecommendations = [
      { ticker: 'COST', name: 'Costco Wholesale Corporation', sector: 'Consumer Defensive', exchange: 'NASDAQ' },
      { ticker: 'PLTR', name: 'Palantir Technologies Inc.', sector: 'Technology', exchange: 'NASDAQ' },
      { ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', exchange: 'NASDAQ' },
      { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology', exchange: 'NASDAQ' },
      { ticker: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', exchange: 'NASDAQ' },
      { ticker: 'ASML', name: 'ASML Holding N.V.', sector: 'Technology', exchange: 'NASDAQ' },
      { ticker: 'TSM', name: 'Taiwan Semiconductor Manufacturing', sector: 'Technology', exchange: 'NYSE' },
      { ticker: 'BRK-B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services', exchange: 'NYSE' }
    ];

    list.innerHTML = popularRecommendations.map(r => {
      const inWl = currentTickers.includes(r.ticker);
      return `
        <div class="search-result-card" data-ticker="${r.ticker}">
          <div class="search-result-left">
            <div class="search-result-header">
              <span class="search-result-ticker mono">${r.ticker}</span>
              ${r.exchange ? `<span class="search-result-exchange">${r.exchange}</span>` : ''}
              ${r.sector ? `<span class="search-result-meta">• ${r.sector}</span>` : ''}
            </div>
            <div class="search-result-name">${r.name}</div>
          </div>
          <div class="search-result-actions">
            <button class="btn-add-action ${inWl ? 'added' : 'add'}" data-add-ticker="${r.ticker}">
              ${inWl ? '✓ Added' : '+ Add'}
            </button>
            <button class="btn-view-action" data-view-ticker="${r.ticker}">📊 Analyze</button>
          </div>
        </div>
      `;
    }).join('');

    attachSearchResultEvents(list, targetWlId);
    return;
  }

  // Show subtle loading state
  list.innerHTML = `<div style="font-size: 13px; color: var(--text-secondary); padding: 14px; text-align: center;">🔍 Searching global markets for "${query}"…</div>`;

  try {
    const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();

    if (results.length === 0) {
      list.innerHTML = `
        <div style="font-size: 13px; color: var(--text-secondary); padding: 16px; text-align: center;">
          No matching companies found for "<strong>${query}</strong>".<br>
          <button class="btn-primary" id="directAddBtn" style="margin-top: 10px; font-size: 12px; padding: 6px 14px;">
            + Add "${query.toUpperCase()}" Directly
          </button>
        </div>
      `;
      document.getElementById('directAddBtn')?.addEventListener('click', () => {
        handleAddStockToWatchlist(query.toUpperCase(), targetWlId);
      });
      return;
    }

    list.innerHTML = results.map(r => {
      const inWl = currentTickers.includes(r.ticker);
      return `
        <div class="search-result-card" data-ticker="${r.ticker}">
          <div class="search-result-left">
            <div class="search-result-header">
              <span class="search-result-ticker mono">${r.ticker}</span>
              ${r.exchange ? `<span class="search-result-exchange">${r.exchange}</span>` : ''}
              ${r.sector ? `<span class="search-result-meta">• ${r.sector}</span>` : ''}
              ${r.health_score ? `<span class="score-badge pristine" style="font-size: 11px; padding: 2px 6px;">${r.health_score}/100</span>` : ''}
            </div>
            <div class="search-result-name">${r.name}</div>
          </div>
          <div class="search-result-actions">
            <button class="btn-add-action ${inWl ? 'added' : 'add'}" data-add-ticker="${r.ticker}">
              ${inWl ? '✓ Added' : '+ Add'}
            </button>
            <button class="btn-view-action" data-view-ticker="${r.ticker}">📊 Analyze</button>
          </div>
        </div>
      `;
    }).join('');

    attachSearchResultEvents(list, targetWlId);
  } catch (err) {
    console.error('Search error:', err);
    list.innerHTML = `<div style="font-size: 13px; color: var(--health-risk); padding: 12px; text-align: center;">Failed to search stocks. Check network connection.</div>`;
  }
}

function attachSearchResultEvents(container, targetWlId) {
  // Add button click
  container.querySelectorAll('[data-add-ticker]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ticker = btn.getAttribute('data-add-ticker');
      await handleAddStockToWatchlist(ticker, targetWlId, btn);
    });
  });

  // View / Analyze button click
  container.querySelectorAll('[data-view-ticker]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticker = btn.getAttribute('data-view-ticker');
      closeModal('searchModal');
      openStockDeepDive(ticker);
    });
  });

  // Card click -> View
  container.querySelectorAll('.search-result-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const ticker = card.getAttribute('data-ticker');
      closeModal('searchModal');
      openStockDeepDive(ticker);
    });
  });
}

// Add a stock to a watchlist
async function handleAddStockToWatchlist(tickerSymbol, targetWatchlistId, btnEl = null) {
  const ticker = tickerSymbol.trim().toUpperCase();
  const watchlistId = targetWatchlistId || state.activeWatchlistId;
  const wl = state.watchlists.find(w => w.id === watchlistId);
  const wlName = wl ? wl.name : 'Watchlist';

  if (!ticker) return;

  if (btnEl) {
    btnEl.textContent = 'Adding…';
    btnEl.disabled = true;
  }

  try {
    const res = await apiFetch(`/api/watchlists/${watchlistId}/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to add stock');
    }

    if (btnEl) {
      btnEl.className = 'btn-add-action added';
      btnEl.textContent = '✓ Added';
      btnEl.disabled = false;
    }

    showToast(`Added ${ticker} to ${wlName}!`, '🏰');

    // Update local state and reload
    await loadWatchlists();
    if (watchlistId === state.activeWatchlistId) {
      await loadWatchlistData(watchlistId);
    }
  } catch (err) {
    console.error('Error adding stock to watchlist:', err);
    if (btnEl) {
      btnEl.className = 'btn-add-action add';
      btnEl.textContent = '+ Add';
      btnEl.disabled = false;
    }
    showToast(`Failed to add ${ticker}: ${err.message}`, '⚠️');
  }
}

// Remove a stock from the active watchlist
async function handleRemoveStockFromWatchlist(tickerSymbol) {
  const ticker = tickerSymbol.trim().toUpperCase();
  const watchlistId = state.activeWatchlistId;
  const wl = state.watchlists.find(w => w.id === watchlistId);
  const wlName = wl ? wl.name : 'Watchlist';

  try {
    const res = await apiFetch(`/api/watchlists/${watchlistId}/stocks/${ticker}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to remove stock');
    }

    showToast(`Removed ${ticker} from ${wlName}.`, '🗑️');
    await loadWatchlists();
    await loadWatchlistData(watchlistId);
  } catch (err) {
    console.error('Error removing stock from watchlist:', err);
    showToast(`Failed to remove ${ticker}: ${err.message}`, '⚠️');
  }
}

// ----------------- WATCHLIST CREATION & BOOKMARK -----------------
async function handleCreateWatchlist() {
  const name = document.getElementById('newWatchlistNameInput').value.trim();
  const rawTickers = document.getElementById('newWatchlistTickersInput').value.trim();

  if (!name) {
    alert('Please enter a watchlist name.');
    return;
  }

  const tickers = rawTickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  try {
    const res = await apiFetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tickers })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('newWatchlistModal');
      state.activeWatchlistId = data.id;
      localStorage.setItem('omaha_active_watchlist', data.id);
      await loadWatchlists();
      await loadWatchlistData(data.id);
      showToast(`Created watchlist "${name}"`, '✨');
    }
  } catch (err) {
    console.error('Error creating watchlist:', err);
  }
}

function updateBookmarkButtonState() {
  const btn = document.getElementById('bookmarkBtn');
  if (!btn) return;
  const currentWl = state.watchlists.find(w => w.id === state.activeWatchlistId);
  const inWl = currentWl && (currentWl.tickers || []).includes(state.currentTicker);
  if (inWl) {
    btn.innerHTML = '⭐';
    btn.title = `In ${currentWl.name} (Click to remove)`;
    btn.style.color = '#F59E0B';
  } else {
    btn.innerHTML = '☆';
    btn.title = `Add to ${currentWl ? currentWl.name : 'Watchlist'}`;
    btn.style.color = 'var(--text-secondary)';
  }
}

async function handleToggleBookmark() {
  if (!state.currentTicker || !state.activeWatchlistId) return;

  const currentWl = state.watchlists.find(w => w.id === state.activeWatchlistId);
  if (!currentWl) return;

  const inWl = (currentWl.tickers || []).includes(state.currentTicker);
  if (inWl) {
    await handleRemoveStockFromWatchlist(state.currentTicker);
  } else {
    await handleAddStockToWatchlist(state.currentTicker, state.activeWatchlistId);
  }
  updateBookmarkButtonState();
}

// ----------------- PUSH SUBSCRIPTION -----------------
async function checkPushStatus() {
  const btn = document.getElementById('enablePushBtn');
  if (!btn) return;

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    btn.textContent = 'Unsupported';
    btn.disabled = true;
    setTestPushEnabled(false, 'This browser cannot show notifications.');
    return;
  }

  if (Notification.permission === 'denied') {
    btn.textContent = 'Blocked';
    btn.disabled = true;
    setTestPushEnabled(false, 'Notifications are blocked in your browser settings.');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      btn.textContent = '✓ Enabled';
      btn.className = 'btn-secondary added';
      btn.disabled = true;
    } else {
      btn.textContent = 'Enable';
      btn.className = 'btn-secondary';
      btn.disabled = false;
    }
    setTestPushEnabled(Boolean(sub));
  } catch (e) {
    console.warn('Error checking push status:', e);
  }
}

async function handleEnablePush() {
  const btn = document.getElementById('enablePushBtn');

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    showToast('Web Push is not supported in this browser.', '⚠️');
    return;
  }

  if (Notification.permission === 'denied') {
    showToast('Push notification permission is blocked in browser settings.', '⚠️');
    return;
  }

  try {
    if (btn) {
      btn.textContent = 'Enabling…';
      btn.disabled = true;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Push notification permission was not granted.', '⚠️');
      if (btn) {
        btn.textContent = 'Enable';
        btn.disabled = false;
      }
      return;
    }

    const keyRes = await fetch('/api/push/vapid-key');
    const { publicKey } = await keyRes.json();
    if (!publicKey) {
      throw new Error('VAPID key unavailable from server.');
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    const res = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to register subscription.');
    }

    if (btn) {
      btn.textContent = '✓ Enabled';
      btn.className = 'btn-secondary added';
      btn.disabled = true;
    }

    setTestPushEnabled(true);
    showToast('Push notifications enabled', '🔔');

    // Trigger an immediate confirmation notification via Service Worker
    if (reg.showNotification) {
      reg.showNotification('Pocket Omaha 🎩', {
        body: 'Notifications are on. You will hear about health changes, distress signals and entry points.',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: 'push-enabled',
        data: { url: '/' }
      });
    }
  } catch (err) {
    console.error('Push error:', err);
    showToast(`Failed to enable push: ${err.message}`, '⚠️');
    if (btn) {
      btn.textContent = 'Enable';
      btn.disabled = false;
    }
  }
}

// ----------------- URL PARAMS & UTILS -----------------
function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const ticker = params.get('ticker');
  const tab = params.get('tab');
  const view = params.get('view');
  const watchlist = params.get('watchlist') || params.get('wl');

  if (watchlist && state.watchlists.some(w => w.id === watchlist)) {
    state.activeWatchlistId = watchlist;
    localStorage.setItem('omaha_active_watchlist', watchlist);
    loadWatchlistData(watchlist);
    const select = document.getElementById('watchlistSelect');
    if (select) select.value = watchlist;
  }

  if (ticker) {
    openStockDeepDive(ticker, tab || 'overview');
    return true;
  }

  if (view) {
    if (view === 'screener' || view === 'viewScreener') {
      loadScreenerData();
      switchView('viewScreener');
      return true;
    } else if (view === 'compare' || view === 'viewCompare') {
      runComparison();
      switchView('viewCompare');
      return true;
    } else if (view === 'watchlist' || view === 'viewWatchlist') {
      switchView('viewWatchlist');
      return true;
    }
  }

  return false;
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function getScoreColor(score) {
  // An unscored company is neutral, not red: "not enough filed data" is a
  // different statement from "this company is in trouble".
  if (!isNum(score)) return 'var(--text-tertiary)';
  if (score >= 85) return 'var(--health-pristine)';
  if (score >= 70) return 'var(--health-good)';
  if (score >= 50) return 'var(--health-moderate)';
  return 'var(--health-risk)';
}

function getPillarColor(pct) {
  if (!isNum(pct)) return 'var(--border-subtle)';
  if (pct >= 85) return '#10B981';
  if (pct >= 70) return '#34D399';
  if (pct >= 50) return '#FBBF24';
  return '#F87171';
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ----------------- NOTIFICATION PREFERENCES & HISTORY -----------------

async function loadNotificationCentre() {
  try {
    const res = await apiFetch('/api/notifications?limit=30');
    if (!res.ok) return;
    const { settings = {}, history = [] } = await res.json();

    document.querySelectorAll('[data-notify-pref]').forEach((box) => {
      const key = box.dataset.notifyPref;
      if (key in settings) box.checked = Boolean(settings[key]);
    });

    const list = document.getElementById('notificationHistory');
    if (!list) return;

    if (!history.length) {
      list.innerHTML =
        '<div class="chart-empty">No alerts yet. Holdings are checked four times a day.</div>';
      return;
    }

    list.innerHTML = history.map((n) => `
      <div class="notification-row is-${n.severity || 'info'}">
        <div class="notification-title">${n.title}</div>
        <div class="notification-body">${n.body}</div>
        <div class="notification-time mono">${formatRelativeTime(n.delivered_at)}</div>
      </div>`).join('');

    apiFetch('/api/notifications/read', { method: 'POST' }).catch(() => {});
  } catch {
    // The alert centre is secondary; failing to load it must not break settings.
  }
}

async function loadAppSettings() {
  try {
    const res = await apiFetch('/api/settings');
    if (!res.ok) return;
    const { settings = {} } = await res.json();
    state.appSettings = { ...state.appSettings, ...settings };

    document.querySelectorAll('[data-app-setting]').forEach((box) => {
      const key = box.dataset.appSetting;
      if (key in settings) box.checked = Boolean(settings[key]);
    });
  } catch {
    // Leave the checkboxes at their unchecked default. For a privacy opt-in
    // that is the safe way to fail: the box reads "off" and the server, which
    // is the one that actually decides, also defaults to off.
  }
}

async function saveAppSettings() {
  const patch = {};
  document.querySelectorAll('[data-app-setting]').forEach((box) => {
    patch[box.dataset.appSetting] = box.checked;
  });

  try {
    const res = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error('save failed');
    const { settings = {} } = await res.json();
    state.appSettings = { ...state.appSettings, ...settings };
    showToast('Settings saved', '✓');
  } catch {
    // Re-read rather than leaving the box showing a state the server rejected.
    // Silently keeping a ticked box here would claim an opt-in that never
    // happened, which is the one failure this setting cannot afford.
    showToast('Could not save settings', '⚠️');
    loadAppSettings();
  }
}

async function saveNotificationPrefs() {
  const patch = {};
  document.querySelectorAll('[data-notify-pref]').forEach((box) => {
    patch[box.dataset.notifyPref] = box.checked;
  });

  try {
    await apiFetch('/api/notifications/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    showToast('Alert preferences saved', '✓');
  } catch {
    showToast('Could not save preferences', '⚠️');
  }
}

/** "4 hours ago" from a SQLite UTC timestamp. */
function formatRelativeTime(stamp) {
  if (!stamp) return '';
  const then = new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// ----------------- TEST NOTIFICATION -----------------

/** The test button is only honest once the browser has actually granted push. */
function setTestPushEnabled(enabled, reason = '') {
  const btn = document.getElementById('testPushBtn');
  if (btn) btn.disabled = !enabled;
  if (reason) setTestPushStatus(reason, 'error');
}

function setTestPushStatus(message, kind = '') {
  const el = document.getElementById('testPushStatus');
  if (!el) return;
  el.textContent = message;
  el.className = 'push-test-status' + (kind ? ` is-${kind}` : '');
}

/**
 * Sends a real push through the real delivery path — same icon, badge and tag
 * as an alert — rather than calling showNotification locally. A local call
 * would light up even when the subscription is dead, which is exactly the
 * failure this button exists to catch.
 */
async function handleTestPush() {
  const btn = document.getElementById('testPushBtn');
  if (!btn || btn.disabled) return;

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  setTestPushStatus('');
  haptic();

  try {
    const res = await apiFetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setTestPushStatus(data.error || 'Could not send the test notification.', 'error');
      // A dead subscription is worth re-offering, not just reporting.
      if (data.code === 'no-subscription' || data.code === 'delivery-failed') {
        const enableBtn = document.getElementById('enablePushBtn');
        if (enableBtn) {
          enableBtn.textContent = 'Enable';
          enableBtn.className = 'btn-secondary';
          enableBtn.disabled = false;
        }
      }
      return;
    }

    setTestPushStatus(
      `Sent to ${data.scope || 'this device'}. If nothing appears within a few ` +
      'seconds, check notification permissions for this app.',
      'ok'
    );
  } catch (err) {
    setTestPushStatus('Could not reach the server. Check your connection.', 'error');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}
