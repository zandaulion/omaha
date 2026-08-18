/**
 * Pocket Omaha — Core PWA Client Application Logic
 * Mobile-First, Offline-Ready Fundamental Analysis PWA
 */

// Global Application State
const state = {
  activeView: 'viewWatchlist',
  activeSubtab: 'overview',
  activeWatchlistId: 'compounders',
  currentTicker: 'NVDA',
  currentStock: null,
  watchlists: [],
  currentWatchlistData: null,
  allScreenerStocks: [],
  theme: localStorage.getItem('omaha_theme') || 'dark',
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
  }
};

// DOM Content Loaded Entry Point
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  registerServiceWorker();
  initEventListeners();
  initNetworkListeners();
  initGateForm();

  // Check device registration / invite session
  const isAuthed = await checkAuthSession();
  if (isAuthed) {
    // Load initial data
    await loadWatchlists();
    await loadWatchlistData(state.activeWatchlistId);

    // Check first run onboarding
    if (!localStorage.getItem('omaha_onboarded')) {
      openModal('onboardingModal');
    }

    // Handle URL deep links e.g. ?ticker=AAPL&tab=checklist
    handleUrlParams();
  }
});

// ----------------- AUTHENTICATION & GATE CONTROLLER -----------------
async function checkAuthSession() {
  const params = new URLSearchParams(window.location.search);
  const inviteParam = params.get('invite') || params.get('code');
  if (inviteParam) {
    const input = document.getElementById('gateCodeInput');
    if (input) input.value = inviteParam.trim().toUpperCase();
  }

  try {
    const res = await fetch('/api/auth/session', {
      headers: getAuthHeaders()
    });
    const session = await res.json();

    if (session.authenticated && !session.revoked) {
      document.getElementById('gateScreen')?.classList.add('hidden');
      document.getElementById('appShell')?.classList.remove('hidden');
      return true;
    } else {
      showGateScreen();
      return false;
    }
  } catch (err) {
    console.warn('Session check error:', err);
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

  // Show installation tip on iOS/Android if not running in standalone mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isStandalone && isMobile) {
    document.getElementById('gateInAppNotice')?.classList.remove('hidden');
  }
}

function initGateForm() {
  const form = document.getElementById('gateForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeInput = document.getElementById('gateCodeInput');
    const errEl = document.getElementById('gateErrorText');
    const submitBtn = document.getElementById('gateSubmitBtn');

    const code = (codeInput?.value || '').trim().toUpperCase();
    if (!code) return;

    errEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Se verifică…';

    try {
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      const deviceLabel = isIOS ? 'iPhone' : isAndroid ? 'Android' : 'Web Browser';

      const res = await fetch('/api/auth/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          device_label: `${deviceLabel} (${new Date().toLocaleDateString('ro-RO', { month: 'short', day: 'numeric' })})`
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Cod de invitație invalid sau expirat.');
      }

      // Store device token
      if (data.token) {
        localStorage.setItem('omaha_token', data.token);
      }

      // Smooth transition into app
      document.getElementById('gateScreen')?.classList.add('hidden');
      document.getElementById('appShell')?.classList.remove('hidden');
      document.getElementById('appShell')?.classList.add('fade-in');

      // Load data
      await loadWatchlists();
      await loadWatchlistData(state.activeWatchlistId);

      if (!localStorage.getItem('omaha_onboarded')) {
        openModal('onboardingModal');
      }

      handleUrlParams();
    } catch (err) {
      errEl.textContent = err.message || 'Eroare la activare. Verifică codul.';
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Activează Dispozitivul';
    }
  });
}

function getAuthHeaders() {
  const token = localStorage.getItem('omaha_token');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    showGateScreen();
    throw new Error('Dispozitiv neautorizat. Introdu codul de invitație.');
  }
  return res;
}

// ----------------- THEME CONTROLLER -----------------
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      localStorage.setItem('omaha_theme', state.theme);
    });
  }
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
  const banner = document.getElementById('offlineBanner');
  const updateStatus = () => {
    if (!navigator.onLine) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  };
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// ----------------- NAVIGATION & ROUTING -----------------
function switchView(viewId) {
  state.activeView = viewId;

  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.add('hidden');
    panel.classList.remove('fade-in');
  });

  const targetPanel = document.getElementById(viewId);
  if (targetPanel) {
    targetPanel.classList.remove('hidden');
    targetPanel.classList.add('fade-in');
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

  // Watchlist Selector change
  document.getElementById('watchlistSelect')?.addEventListener('change', (e) => {
    state.activeWatchlistId = e.target.value;
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
  document.getElementById('searchTriggerBtn')?.addEventListener('click', () => {
    openModal('searchModal');
    document.getElementById('searchInput')?.focus();
  });
  document.getElementById('closeSearchModalBtn')?.addEventListener('click', () => {
    closeModal('searchModal');
  });
  document.getElementById('emptyAddStockBtn')?.addEventListener('click', () => {
    openModal('searchModal');
  });

  // Search Input live typing
  document.getElementById('searchInput')?.addEventListener('input', debounce(handleSearchInput, 200));

  // Settings Modal triggers
  document.getElementById('settingsTriggerBtn')?.addEventListener('click', () => {
    openModal('settingsModal');
  });
  document.getElementById('closeSettingsModalBtn')?.addEventListener('click', () => {
    closeModal('settingsModal');
  });

  // Redeem Invite Button
  document.getElementById('redeemInviteBtn')?.addEventListener('click', handleRedeemInvite);

  // Push Notifications Button
  document.getElementById('enablePushBtn')?.addEventListener('click', handleEnablePush);

  // Export Backup JSON Button
  document.getElementById('exportBackupBtn')?.addEventListener('click', () => {
    window.location.href = '/api/theses';
  });

  // Onboarding starter selection
  document.querySelectorAll('#onboardingModal [data-starter]').forEach((card) => {
    card.addEventListener('click', async () => {
      const starterId = card.getAttribute('data-starter');
      state.activeWatchlistId = starterId;
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
    state.dcf.growth = parseFloat(e.target.value);
    document.getElementById('dcfGrowthVal').textContent = `${state.dcf.growth}%`;
    calculateClientDCF();
  });
  document.getElementById('dcfMultipleSlider')?.addEventListener('input', (e) => {
    state.dcf.multiple = parseFloat(e.target.value);
    document.getElementById('dcfMultipleVal').textContent = `${state.dcf.multiple.toFixed(1)}x`;
    calculateClientDCF();
  });
  document.getElementById('dcfDiscountSlider')?.addEventListener('input', (e) => {
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
  document.getElementById('filterSectorSelect')?.addEventListener('change', () => {
    filterScreenerStocks();
  });

  // Screener Presets
  document.getElementById('presetAllBtn')?.addEventListener('click', () => setScreenerPreset(0, 0, 0));
  document.getElementById('presetFortressBtn')?.addEventListener('click', () => setScreenerPreset(85, 7, 15));
  document.getElementById('presetRoicBtn')?.addEventListener('click', () => setScreenerPreset(70, 6, 20));
  document.getElementById('presetCashBtn')?.addEventListener('click', () => setScreenerPreset(75, 6, 12));

  // Compare Runner
  document.getElementById('compareRunBtn')?.addEventListener('click', runComparison);
}

// ----------------- WATCHLIST LOGIC & RENDERING -----------------
async function loadWatchlists() {
  try {
    const res = await apiFetch('/api/watchlists');
    const data = await res.json();
    state.watchlists = data.watchlists || [];

    const select = document.getElementById('watchlistSelect');
    if (select) {
      select.innerHTML = state.watchlists.map(w =>
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
  document.getElementById('heroStockCount').textContent = `${data.stockCount || 0} companies in portfolio`;

  const gradeBadge = document.getElementById('heroGradeBadge');
  const score = data.compositeScore || 0;
  gradeBadge.textContent = `${data.grade || 'N/A'} (${score}/100)`;
  
  gradeBadge.className = 'hero-grade-badge';
  if (score >= 85) gradeBadge.classList.add('pristine');
  else if (score >= 70) gradeBadge.classList.add('good');
  else if (score >= 50) gradeBadge.classList.add('moderate');
  else gradeBadge.classList.add('risk');

  // Render 5-Pillar Mini Meters
  const pillarsContainer = document.getElementById('heroPillars');
  if (pillarsContainer && data.pillars) {
    pillarsContainer.innerHTML = data.pillars.map(p => `
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

  // Checklist Aggregates
  const checkText = document.getElementById('heroChecklistText');
  if (checkText && data.checklistAggregates) {
    const { totalPass = 0, totalWatch = 0, totalFail = 0 } = data.checklistAggregates;
    checkText.innerHTML = `🟢 ${totalPass} Pass · 🟡 ${totalWatch} Watch · 🔴 ${totalFail} Risk Flags`;
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
            <span>P/E: ${(stock.summary?.ratios?.pe || 25).toFixed(1)}x</span>
            <span>•</span>
            <span>ROIC: ${stock.roic_pct.toFixed(1)}%</span>
            <span>•</span>
            <span>Altman Z: ${stock.altman_z}</span>
          </div>
        </div>

        <div class="stock-right">
          <div class="stock-price-col">
            <div class="stock-price mono">$${stock.price.toFixed(2)}</div>
            <div class="stock-change mono ${isPos ? 'positive' : 'negative'}">
              ${isPos ? '+' : ''}${stock.change_pct.toFixed(2)}%
            </div>
          </div>
          <div class="score-badge ${tier}" style="margin-top: 6px;">
            ${stock.health_score}/100 🟢
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
    card.addEventListener('click', () => {
      const ticker = card.getAttribute('data-ticker');
      openStockDeepDive(ticker);
    });
  });
}

// ----------------- STOCK DEEP DIVE SCORECARD -----------------
async function openStockDeepDive(tickerSymbol) {
  const ticker = tickerSymbol.toUpperCase();
  state.currentTicker = ticker;

  // Show loading state or navigate immediately
  switchView('viewDeepDive');
  switchSubtab('overview');

  try {
    const res = await apiFetch(`/api/stock/${ticker}`);
    if (!res.ok) throw new Error('Stock not found');
    const data = await res.json();
    state.currentStock = data;

    renderDeepDiveHero(data);
    renderOverviewSubtab(data);
    renderChecklistSubtab(data);
    renderTrendsSubtab(data);
    initDCFSandbox(data);
    loadInvestmentThesis(ticker);
  } catch (err) {
    console.error('Deep dive error:', err);
  }
}

function renderDeepDiveHero(stock) {
  document.getElementById('deepDiveTicker').textContent = stock.ticker;
  document.getElementById('deepDiveName').textContent = stock.name;
  document.getElementById('deepDivePrice').textContent = `$${stock.price.toFixed(2)}`;
  document.getElementById('deepDiveCurrency').textContent = stock.currency || 'USD';

  const isPos = stock.change_pct >= 0;
  const changeEl = document.getElementById('deepDiveChange');
  changeEl.textContent = `${isPos ? '+' : ''}${stock.change_pct.toFixed(2)}%`;
  changeEl.className = `mono stock-change ${isPos ? 'positive' : 'negative'}`;

  document.getElementById('deepDiveScoreVal').textContent = stock.health_score;
  document.getElementById('deepDiveScoreLabel').textContent = stock.summary?.healthLabel || 'Strong Financials';
  document.getElementById('deepDiveSectorInfo').textContent = `${stock.sector || 'Equities'} · ${stock.industry || 'Core Business'}`;

  // SVG Radial Circle Progress Animation
  const ring = document.getElementById('scoreRingProgress');
  const circumference = 2 * Math.PI * 50; // r=50 -> 314.15
  const offset = circumference - (stock.health_score / 100) * circumference;
  ring.style.strokeDashoffset = offset;

  // Set ring color
  const color = getScoreColor(stock.health_score);
  ring.style.stroke = color;
  document.getElementById('deepDiveScoreLabel').style.color = color;

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
    const f = stock.financials || {};
    const r = stock.summary?.ratios || {};
    const items = [
      { label: 'ROIC (Capital Moat)', val: `${stock.roic_pct.toFixed(1)}%`, good: stock.roic_pct >= 15 },
      { label: 'Altman Z-Score', val: `${stock.altman_z}`, good: stock.altman_z >= 3.0 },
      { label: 'Piotroski F-Score', val: `${stock.piotroski_score}/9`, good: stock.piotroski_score >= 7 },
      { label: 'FCF Conversion', val: `${stock.fcf_conversion_pct}%`, good: stock.fcf_conversion_pct >= 90 },
      { label: 'Gross Margin', val: `${((f.grossMargin || 0.45) * 100).toFixed(1)}%`, good: true },
      { label: 'Trailing P/E', val: `${(r.pe || 25).toFixed(1)}x`, good: (r.pe || 25) < 30 },
      { label: 'PEG Ratio', val: `${(r.peg || 1.5).toFixed(2)}x`, good: (r.peg || 1.5) <= 1.5 },
      { label: 'Net Cash Cushion', val: `$${stock.net_cash_b}B`, good: stock.net_cash_b > 0 }
    ];

    grid.innerHTML = items.map(it => `
      <div style="background: var(--bg-surface-subtle); padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
        <div style="font-size: 11px; color: var(--text-tertiary); margin-bottom: 2px;">${it.label}</div>
        <div class="mono" style="font-size: 15px; font-weight: 700; color: ${it.good ? 'var(--health-pristine)' : 'var(--text-primary)'};">${it.val}</div>
      </div>
    `).join('');
  }
}

function renderChecklistSubtab(stock) {
  const container = document.getElementById('checklistFullList');
  const badge = document.getElementById('checklistScoreBadge');
  const items = stock.checklist || [];

  const summary = stock.summary?.checklistSummary || {};
  badge.textContent = `${summary.passCount || 0} Pass · ${summary.watchCount || 0} Watch · ${summary.failCount || 0} Fail`;

  container.innerHTML = items.map(item => `
    <div class="checklist-item" data-check-id="${item.id}">
      <div class="checklist-item-header">
        <div class="checklist-left">
          <div class="status-dot ${item.status}"></div>
          <div>
            <span class="checklist-name">${item.name}</span>
            <span class="checklist-category">(${item.category})</span>
          </div>
        </div>
        <div class="checklist-right">
          <span class="checklist-value mono">${item.value}</span>
          <span class="status-tag ${item.status}">${item.status}</span>
        </div>
      </div>
      <div class="checklist-drawer" id="drawer-${item.id}">
        <div class="checklist-benchmark mono">🎯 Benchmark Target: ${item.benchmark}</div>
        <div>${item.explanation}</div>
      </div>
    </div>
  `).join('');

  // Accordion drawer toggle
  container.querySelectorAll('.checklist-item').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-check-id');
      const drawer = document.getElementById(`drawer-${id}`);
      drawer.classList.toggle('open');
    });
  });
}

function renderTrendsSubtab(stock) {
  const hist = stock.financials?.historical || {};
  const years = hist.years || [2020, 2021, 2022, 2023, 2024];
  const rev = hist.revenue || [100, 120, 140, 160, 180];
  const fcf = hist.freeCashFlow || [20, 30, 40, 45, 55];
  const gm = hist.grossMarginPct || [40, 42, 44, 45, 46];
  const om = hist.operatingMarginPct || [20, 22, 24, 25, 26];
  const shares = hist.sharesOutstanding || [10, 9.8, 9.6, 9.4, 9.2];

  // Chart 1: Revenue vs FCF Dual Bars
  const maxRev = Math.max(...rev, 1);
  const chartContainer = document.getElementById('revFcfChart');
  chartContainer.innerHTML = years.map((yr, idx) => {
    const rVal = rev[idx] || 0;
    const fVal = fcf[idx] || 0;
    const rHeight = Math.max(10, Math.round((rVal / maxRev) * 100));
    const fHeight = Math.max(8, Math.round((fVal / maxRev) * 100));

    return `
      <div class="bar-group">
        <div class="bars-pair">
          <div class="bar-column rev" style="height: ${rHeight}%;" title="Revenue: $${rVal}B"></div>
          <div class="bar-column fcf" style="height: ${fHeight}%;" title="Free Cash Flow: $${fVal}B"></div>
        </div>
        <div class="bar-year-label mono">${yr}</div>
      </div>
    `;
  }).join('');

  document.getElementById('revFcfSummaryText').textContent =
    `5Y Revenue: $${rev[0]}B ➔ $${rev[rev.length - 1]}B (${((hist.revenue3yCAGR || 0.12) * 100).toFixed(1)}% 3Y CAGR) · FCF Conversion: ${stock.fcf_conversion_pct}%`;

  // Chart 2: Balance Sheet Stack
  const cashB = Math.max(1, (stock.financials?.cashAndEquivalents || 1e9) / 1e9);
  const debtB = Math.max(0.1, (stock.financials?.totalDebt || 0) / 1e9);
  const maxBS = Math.max(cashB, debtB) * 1.15;

  const stackContainer = document.getElementById('balanceSheetStack');
  stackContainer.innerHTML = `
    <div class="cushion-row">
      <div class="cushion-label">
        <span>Liquid Cash & Equivalents</span>
        <span class="mono text-emerald">$${cashB.toFixed(1)} Billion</span>
      </div>
      <div class="cushion-track">
        <div class="cushion-bar cash" style="width: ${(cashB / maxBS) * 100}%;"></div>
      </div>
    </div>
    <div class="cushion-row">
      <div class="cushion-label">
        <span>Total Debt Obligations</span>
        <span class="mono text-coral">$${debtB.toFixed(1)} Billion</span>
      </div>
      <div class="cushion-track">
        <div class="cushion-bar debt" style="width: ${(debtB / maxBS) * 100}%;"></div>
      </div>
    </div>
    <div class="net-cash-callout">
      ${stock.net_cash_b >= 0
        ? `💎 <span class="text-emerald">Net Cash Fortress: +$${stock.net_cash_b}B (Zero Solvency Risk)</span>`
        : `⚠️ <span class="text-coral">Net Debt: -$${Math.abs(stock.net_cash_b)}B</span>`}
    </div>
  `;

  // Chart 3: Margin Expansion
  const marginContainer = document.getElementById('marginTrendContainer');
  marginContainer.innerHTML = `
    <div style="font-size: 13px; display: flex; justify-content: space-between;">
      <span>Gross Margin:</span>
      <span class="mono text-emerald">${gm.map(v => `${v}%`).join(' ➔ ')}</span>
    </div>
    <div style="font-size: 13px; display: flex; justify-content: space-between;">
      <span>Operating Margin:</span>
      <span class="mono text-cyan">${om.map(v => `${v}%`).join(' ➔ ')}</span>
    </div>
  `;

  // Chart 4: Shares Dilution
  const sharesContainer = document.getElementById('sharesTrendContainer');
  const isRetiring = shares[shares.length - 1] <= shares[0];
  sharesContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span>Share Count:</span>
      <span class="mono ${isRetiring ? 'text-emerald' : 'text-amber'}">${shares.map(s => `${s}B`).join(' ➔ ')}</span>
    </div>
    <div style="font-size: 12px; color: var(--text-secondary);">
      ${isRetiring
        ? `🟢 Management retired shares (${((hist.shareDilutionYoY || -0.01) * 100).toFixed(1)}% YoY), boosting per-share intrinsic value.`
        : `⚠️ Share dilution from SBC (+${((hist.shareDilutionYoY || 0.01) * 100).toFixed(1)}% YoY).`}
    </div>
  `;
}

// ----------------- DCF INTRINSIC VALUE SANDBOX -----------------
function initDCFSandbox(stock) {
  const revGrowth = Math.round((stock.financials?.historical?.revenue3yCAGR || 0.14) * 100);
  const pe = stock.summary?.ratios?.pe || 24;

  state.dcf.growth = Math.min(35, Math.max(5, revGrowth));
  state.dcf.multiple = Math.min(35, Math.max(12, Math.round(pe * 0.85)));
  state.dcf.discount = 9.5;

  document.getElementById('dcfGrowthSlider').value = state.dcf.growth;
  document.getElementById('dcfGrowthVal').textContent = `${state.dcf.growth}%`;

  document.getElementById('dcfMultipleSlider').value = state.dcf.multiple;
  document.getElementById('dcfMultipleVal').textContent = `${state.dcf.multiple}x`;

  document.getElementById('dcfDiscountSlider').value = state.dcf.discount;
  document.getElementById('dcfDiscountVal').textContent = `${state.dcf.discount}%`;

  calculateClientDCF();
}

function setDCFPreset(preset) {
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

  if (preset === 'bear') {
    document.getElementById('dcfBearPreset').classList.add('active');
    state.dcf.growth = Math.max(4, Math.round(state.dcf.growth * 0.65));
    state.dcf.multiple = 16.0;
    state.dcf.discount = 11.0;
  } else if (preset === 'base') {
    document.getElementById('dcfBasePreset').classList.add('active');
    state.dcf.growth = 15;
    state.dcf.multiple = 22.0;
    state.dcf.discount = 9.5;
  } else if (preset === 'bull') {
    document.getElementById('dcfBullPreset').classList.add('active');
    state.dcf.growth = Math.min(45, Math.round(state.dcf.growth * 1.35));
    state.dcf.multiple = 30.0;
    state.dcf.discount = 9.0;
  }

  document.getElementById('dcfGrowthSlider').value = state.dcf.growth;
  document.getElementById('dcfGrowthVal').textContent = `${state.dcf.growth}%`;
  document.getElementById('dcfMultipleSlider').value = state.dcf.multiple;
  document.getElementById('dcfMultipleVal').textContent = `${state.dcf.multiple}x`;
  document.getElementById('dcfDiscountSlider').value = state.dcf.discount;
  document.getElementById('dcfDiscountVal').textContent = `${state.dcf.discount}%`;

  calculateClientDCF();
}

function calculateClientDCF() {
  if (!state.currentStock) return;
  const stock = state.currentStock;
  const price = stock.price;
  const fcf0 = Math.max(1, (stock.financials?.freeCashFlow || 1e9) / 1e9); // In Billions
  const cashB = (stock.financials?.cashAndEquivalents || 0) / 1e9;
  const debtB = (stock.financials?.totalDebt || 0) / 1e9;
  const sharesB = Math.max(0.1, (stock.market_cap / price) / 1e9);

  const g = state.dcf.growth / 100;
  const m = state.dcf.multiple;
  const r = state.dcf.discount / 100;

  let fcf = fcf0;
  let cumulativePV = 0;
  const tableRows = [];

  for (let t = 1; t <= 5; t++) {
    fcf = fcf * (1 + g);
    const pv = fcf / Math.pow(1 + r, t);
    cumulativePV += pv;
    tableRows.push({ year: t, fcf: fcf.toFixed(2), pv: pv.toFixed(2) });
  }

  const terminalVal = fcf * m;
  const pvTerminalVal = terminalVal / Math.pow(1 + r, 5);
  const enterpriseVal = cumulativePV + pvTerminalVal;
  const equityVal = enterpriseVal + cashB - debtB;
  const fairValue = equityVal / sharesB;

  const marginPct = ((fairValue - price) / fairValue) * 100;
  const isUndervalued = marginPct >= 0;

  document.getElementById('dcfFairValueText').textContent = `$${fairValue.toFixed(2)}`;
  document.getElementById('dcfCurrentPriceText').textContent = `$${price.toFixed(2)}`;

  const badge = document.getElementById('dcfMarginBadge');
  badge.className = `margin-of-safety-meter ${isUndervalued ? 'undervalued' : 'overvalued'}`;
  badge.textContent = isUndervalued
    ? `🟢 MARGIN OF SAFETY: +${marginPct.toFixed(1)}% Undervalued`
    : `🔴 OVERVALUED: ${Math.abs(marginPct).toFixed(1)}% Premium to Fair Value`;

  // Render Table Breakdown
  const tableContainer = document.getElementById('dcfBreakdownTable');
  tableContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span>Trailing FCF Base (Year 0):</span>
      <span class="mono">$${fcf0.toFixed(2)} Billion</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span>5-Year Cumulative PV:</span>
      <span class="mono">$${cumulativePV.toFixed(2)} Billion</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span>Discounted Terminal Value:</span>
      <span class="mono">$${pvTerminalVal.toFixed(2)} Billion</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span>Net Cash Adjustment:</span>
      <span class="mono">${(cashB - debtB) >= 0 ? '+' : ''}${(cashB - debtB).toFixed(2)} Billion</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-weight: 700; margin-top: 6px; border-top: 1px solid var(--border-subtle); padding-top: 6px;">
      <span>Total Intrinsic Equity Value:</span>
      <span class="mono text-cyan">$${equityVal.toFixed(2)} Billion</span>
    </div>
  `;
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

  const filtered = state.allScreenerStocks.filter(s => {
    if (s.health_score < minHealth) return false;
    if (s.piotroski_score < minPiotroski) return false;
    if (s.roic_pct < minRoic) return false;
    if (sector !== 'all' && s.sector !== sector) return false;
    return true;
  });

  document.getElementById('screenerCountBadge').textContent = `${filtered.length} Matches`;

  const tbody = document.getElementById('screenerTableBody');
  if (tbody) {
    tbody.innerHTML = filtered.map(s => `
      <tr data-ticker="${s.ticker}">
        <td>
          <span class="mono" style="font-weight: 700;">${s.ticker}</span>
          <div style="font-size: 11px; color: var(--text-secondary);">${s.name}</div>
        </td>
        <td class="mono">$${s.price.toFixed(2)}</td>
        <td>
          <span class="score-badge ${s.summary?.healthTier || 'good'}">${s.health_score}/100</span>
        </td>
        <td class="mono">${s.piotroski_score}/9</td>
        <td class="mono text-emerald">${s.roic_pct.toFixed(1)}%</td>
        <td class="mono">${s.net_cash_b > 0 ? `+$${s.net_cash_b}B 💎` : `-$${Math.abs(s.net_cash_b)}B`}</td>
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

function setScreenerPreset(minH, minP, minR) {
  document.getElementById('filterHealthSlider').value = minH;
  document.getElementById('filterHealthVal').textContent = minH;
  document.getElementById('filterPiotroskiSlider').value = minP;
  document.getElementById('filterPiotroskiVal').textContent = minP;
  document.getElementById('filterRoicSlider').value = minR;
  document.getElementById('filterRoicVal').textContent = `${minR}%`;
  document.getElementById('filterSectorSelect').value = 'all';

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
      container.innerHTML = `<div class="card" style="text-align: center;">No valid tickers found to compare.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="stock-table-container">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${stocks.map(s => `<th class="mono" style="font-size: 13px; color: var(--brand-cyan);">${s.ticker}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Health Score (0-100)</strong></td>
              ${stocks.map(s => `<td><span class="score-badge ${s.summary?.healthTier || 'good'}">${s.health_score}/100</span></td>`).join('')}
            </tr>
            <tr>
              <td><strong>Altman Z-Score</strong></td>
              ${stocks.map(s => `<td class="mono">${s.altman_z}</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Piotroski F-Score</strong></td>
              ${stocks.map(s => `<td class="mono">${s.piotroski_score}/9</td>`).join('')}
            </tr>
            <tr>
              <td><strong>ROIC (Capital Moat)</strong></td>
              ${stocks.map(s => `<td class="mono text-emerald">${s.roic_pct.toFixed(1)}%</td>`).join('')}
            </tr>
            <tr>
              <td><strong>FCF Conversion</strong></td>
              ${stocks.map(s => `<td class="mono">${s.fcf_conversion_pct}%</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Gross Margin</strong></td>
              ${stocks.map(s => `<td class="mono">${((s.financials?.grossMargin || 0.45) * 100).toFixed(1)}%</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Net Cash Stack</strong></td>
              ${stocks.map(s => `<td class="mono">${s.net_cash_b >= 0 ? `+$${s.net_cash_b}B 💎` : `-$${Math.abs(s.net_cash_b)}B`}</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Trailing P/E</strong></td>
              ${stocks.map(s => `<td class="mono">${(s.summary?.ratios?.pe || 25).toFixed(1)}x</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Checklist Pass Rate</strong></td>
              ${stocks.map(s => `<td class="mono text-cyan">${s.summary?.checklistSummary?.passPct || 80}%</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Comparison error:', err);
  }
}

// ----------------- SEARCH AUTOCOMPLETE -----------------
async function handleSearchInput(e) {
  const query = e.target.value.trim();
  const list = document.getElementById('searchResultsList');
  if (!query) {
    list.innerHTML = '';
    return;
  }

  try {
    const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();

    if (results.length === 0) {
      list.innerHTML = `<div style="font-size: 13px; color: var(--text-secondary); padding: 12px; text-align: center;">No matching companies found.</div>`;
      return;
    }

    list.innerHTML = results.map(r => `
      <div class="card card-clickable" data-search-ticker="${r.ticker}" style="margin-bottom: 0; padding: 10px 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="mono" style="font-weight: 700; font-size: 15px;">${r.ticker}</span>
            <span style="font-size: 13px; color: var(--text-secondary); margin-left: 8px;">${r.name}</span>
          </div>
          ${r.health_score ? `<span class="score-badge pristine">${r.health_score}/100</span>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-search-ticker]').forEach(card => {
      card.addEventListener('click', () => {
        const ticker = card.getAttribute('data-search-ticker');
        closeModal('searchModal');
        openStockDeepDive(ticker);
      });
    });
  } catch (err) {
    console.error('Search error:', err);
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
      await loadWatchlists();
      await loadWatchlistData(data.id);
    }
  } catch (err) {
    console.error('Error creating watchlist:', err);
  }
}

async function handleToggleBookmark() {
  if (!state.currentTicker || !state.activeWatchlistId) return;

  const currentWl = state.watchlists.find(w => w.id === state.activeWatchlistId);
  if (!currentWl) return;

  let tickers = [...(currentWl.tickers || [])];
  if (tickers.includes(state.currentTicker)) {
    tickers = tickers.filter(t => t !== state.currentTicker);
    alert(`Removed ${state.currentTicker} from ${currentWl.name}`);
  } else {
    tickers.push(state.currentTicker);
    alert(`Added ${state.currentTicker} to ${currentWl.name}!`);
  }

  await apiFetch(`/api/watchlists/${state.activeWatchlistId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers })
  });

  await loadWatchlistData(state.activeWatchlistId);
}

// ----------------- INVITE REDEMPTION & PUSH -----------------
function checkInviteParam() {
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('invite');
  if (invite) {
    document.getElementById('inviteCodeInput').value = invite;
    openModal('settingsModal');
  }
}

async function handleRedeemInvite() {
  const code = document.getElementById('inviteCodeInput').value.trim().toUpperCase();
  const statusEl = document.getElementById('activationStatusText');

  if (!code) {
    statusEl.innerHTML = `<span style="color: var(--health-risk);">Please enter a valid invite code.</span>`;
    return;
  }

  try {
    const res = await fetch('/api/auth/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        device_label: navigator.userAgent.includes('iPhone') ? 'iPhone PWA' : 'Mobile PWA'
      })
    });

    const data = await res.json();
    if (data.success) {
      statusEl.innerHTML = `<span style="color: var(--health-pristine);">🎉 Device successfully activated! Access granted.</span>`;
      localStorage.setItem('omaha_token', data.token);
    } else {
      statusEl.innerHTML = `<span style="color: var(--health-risk);">${data.error || 'Failed to activate code.'}</span>`;
    }
  } catch (err) {
    statusEl.innerHTML = `<span style="color: var(--health-risk);">Network error during activation.</span>`;
  }
}

async function handleEnablePush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    alert('Web Push is not supported in this browser.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Push notification permission denied.');
    return;
  }

  try {
    const keyRes = await fetch('/api/push/vapid-key');
    const { publicKey } = await keyRes.json();

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub })
    });

    alert('🔔 Push notifications enabled! You will receive earnings & health score alerts.');
  } catch (err) {
    console.error('Push error:', err);
    alert('Failed to register push subscription.');
  }
}

// ----------------- URL PARAMS & UTILS -----------------
function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const ticker = params.get('ticker');
  const tab = params.get('tab');

  if (ticker) {
    openStockDeepDive(ticker);
    if (tab) {
      switchSubtab(tab);
    }
  }
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function getScoreColor(score) {
  if (score >= 85) return 'var(--health-pristine)';
  if (score >= 70) return 'var(--health-good)';
  if (score >= 50) return 'var(--health-moderate)';
  return 'var(--health-risk)';
}

function getPillarColor(pct) {
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
