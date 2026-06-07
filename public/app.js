/**
 * 真心話大冒險 — 前端邏輯
 * - 牌庫從後端 API 載入（或內建示範）
 * - 本局狀態存 localStorage，F5 不會重置
 * - 僅「開啟新局」會清空已抽紀錄
 */

const STORAGE_KEY = 'truth_or_dare_session_v1';

const TEMP_STORAGE_KEY = 'truth_or_dare_temp_cards_v1';

const CROSS_DECK_MODE_KEY = 'truth_or_dare_cross_deck_mode_v1';

/** @typedef {'peace'|'icebreaker'|'drunk'} CrossDeckMode */

const CROSS_DECK_CHANCES = {
  peace: 0,
  icebreaker: 0.2,
  drunk: 0.5,
};

const DEMO_DECK = {
  truth: [
    { id: 't1', text: '說出一個你從沒告訴過在場任何人的秘密。' },
    { id: 't2', text: '你最後一次說謊是什麼時候？為什麼？' },
    { id: 't3', text: '在場誰最可能讓你心動？為什麼？' },
    { id: 't4', text: '分享一件你覺得很尷尬的往事。' },
    { id: 't5', text: '你手機相簿裡最新一張自拍是什麼情境？' },
  ],
  dare: [
    { id: 'd1', text: '對著窗外大喊：「我是最帥／美的！」' },
    { id: 'd2', text: '模仿在場一位朋友的招牌動作或語氣。' },
    { id: 'd3', text: '用單腳跳繞房間一圈。' },
    { id: 'd4', text: '傳一則搞笑貼圖到最近一個群組。' },
    { id: 'd5', text: '跟左手邊的人握手並說一句真誠讚美。' },
  ],
};

/** @typedef {{ id: string, text: string }} Card */
/** @typedef {{ truth: Card[], dare: Card[] }} DeckCatalog */
/** @typedef {{
 *   sessionId: string,
 *   catalogVersion: string,
 *   remainingTruthIds: string[],
 *   remainingDareIds: string[],
 *   history: { type: 'truth'|'dare', id: string, text: string, at: number }[]
 * }} GameSession */

const $ = (sel) => document.querySelector(sel);

const els = {
  loading: $('#loading'),
  error: $('#errorBanner'),
  countTruth: $('#countTruth'),
  countDare: $('#countDare'),
  pileRemainingTruth: $('#pileRemainingTruth'),
  pileRemainingDare: $('#pileRemainingDare'),
  btnNew: $('#btnNewGame'),
  truthDeck: $('#truthDeckVisual'),
  dareDeck: $('#dareDeckVisual'),
  revealOverlay: $('#revealOverlay'),
  result: $('#resultPanel'),
  history: $('#historyList'),
  historyPopup: $('#historyListPopup'),
  historyBar: $('#historyBar'),
  historyOverlay: $('#historyOverlay'),
  historyClose: $('#historyClose'),
  appFrame: $('#appFrame'),
  crossDeckModeBtns: document.querySelectorAll('.cross-deck-mode__btn'),
  playModeHelp: $('#btnPlayModeHelp'),
  playModeTooltip: $('#playModeTooltip'),
};

const MOBILE_MAX_WIDTH = 640;
const CARD_ASPECT = 1.45;
const MIN_MOBILE_CARD_W = 64;
const MAX_MOBILE_CARD_W = 160;

let mobileFitRaf = 0;

/** @type {DeckCatalog} */
let baseCatalog = { truth: [], dare: [] };
/** @type {DeckCatalog} */
let catalog = { truth: [], dare: [] };
/** @type {string} */
let catalogVersion = '';

/** @returns {GameSession|null} */
function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {GameSession} session */
function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function catalogFingerprint(deck) {
  const ids = [...deck.truth.map((c) => c.id), ...deck.dare.map((c) => c.id)].sort();
  return ids.join('|');
}

/** @returns {GameSession} */
function createNewSession() {
  return {
    sessionId: crypto.randomUUID(),
    catalogVersion,
    remainingTruthIds: catalog.truth.map((c) => c.id),
    remainingDareIds: catalog.dare.map((c) => c.id),
    history: [],
  };
}

function getOrInitSession() {
  let session = loadSession();
  const versionChanged = session && session.catalogVersion !== catalogVersion;
  if (!session) {
    session = createNewSession();
    saveSession(session);
  } else if (versionChanged) {
    applyCatalogToSession(session);
  }
  return session;
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.add('visible');
  scheduleMobileFit();
}

function hideError() {
  els.error.classList.remove('visible');
  scheduleMobileFit();
}

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

function getDeckWrapExtra() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--deck-wrap-extra');
  return parseFloat(raw) || 24;
}

function measureFixedChromeHeight() {
  let height = 0;
  const header = document.querySelector('header');
  const toolbar = document.querySelector('.toolbar');
  if (header) height += header.getBoundingClientRect().height;
  if (toolbar) height += toolbar.getBoundingClientRect().height;
  if (els.error?.classList.contains('visible')) height += els.error.getBoundingClientRect().height;
  return height;
}

function getCurrentCardWidth() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--card-w');
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : MIN_MOBILE_CARD_W;
}

function applyMobileCardWidth(cardW) {
  document.documentElement.style.setProperty('--card-w', `${Math.floor(cardW)}px`);
}

function resetMobileCardWidth() {
  document.documentElement.style.removeProperty('--card-w');
}

function tightenMobileArena(viewportH) {
  const arena = document.querySelector('.arena');
  if (!isMobileLayout() || !arena) return;

  let cardW = getCurrentCardWidth();
  const deckWrapExtra = getDeckWrapExtra();

  const measureGap = () => viewportH - arena.getBoundingClientRect().bottom;

  let gap = measureGap();
  let guard = 0;
  while (gap < -1 && cardW > MIN_MOBILE_CARD_W && guard < 24) {
    cardW = Math.max(MIN_MOBILE_CARD_W, cardW - Math.max(1, Math.ceil(Math.abs(gap) / (2 * CARD_ASPECT))));
    applyMobileCardWidth(cardW);
    gap = measureGap();
    guard += 1;
  }

  if (document.documentElement.scrollHeight > viewportH + 1 && cardW > MIN_MOBILE_CARD_W) {
    const overflow = document.documentElement.scrollHeight - viewportH;
    cardW = Math.max(
      MIN_MOBILE_CARD_W,
      cardW - Math.ceil(overflow / (2 * CARD_ASPECT)) - 1
    );
    applyMobileCardWidth(cardW);
  }
}

function fitMobileArena() {
  if (!isMobileLayout()) {
    resetMobileCardWidth();
    return;
  }

  const viewportH = window.visualViewport?.height ?? window.innerHeight;
  const chromeH = measureFixedChromeHeight();
  const arena = document.querySelector('.arena');
  const arenaStyles = arena ? getComputedStyle(arena) : null;
  const arenaGap = arenaStyles ? parseFloat(arenaStyles.rowGap || arenaStyles.gap || '8') : 8;
  const arenaPad =
    (arenaStyles ? parseFloat(arenaStyles.paddingTop) + parseFloat(arenaStyles.paddingBottom) : 14) + 4;

  const pile = document.querySelector('.pile');
  const pileStyles = pile ? getComputedStyle(pile) : null;
  const pilePad = pileStyles ? parseFloat(pileStyles.paddingTop) + parseFloat(pileStyles.paddingBottom) : 17.6;
  const pileRemaining = 22;
  const deckMargin = 4;
  const deckWrapExtra = getDeckWrapExtra();
  const perPileFixed = pilePad + deckWrapExtra + deckMargin + pileRemaining;
  const available = viewportH - chromeH - arenaGap - arenaPad - 2 * perPileFixed;

  let cardW = available / (2 * CARD_ASPECT);
  cardW = Math.max(MIN_MOBILE_CARD_W, Math.min(MAX_MOBILE_CARD_W, cardW));
  applyMobileCardWidth(cardW);

  requestAnimationFrame(() => {
    tightenMobileArena(viewportH);
    requestAnimationFrame(() => tightenMobileArena(viewportH));
  });
}

function scheduleMobileFit() {
  cancelAnimationFrame(mobileFitRaf);
  mobileFitRaf = requestAnimationFrame(() => fitMobileArena());
}

function positionPlayModeTooltip() {
  const tooltip = els.playModeTooltip;
  if (!tooltip?.classList.contains('is-open')) {
    tooltip.style.removeProperty('transform');
    return;
  }

  tooltip.style.transform = 'translateX(-50%)';

  requestAnimationFrame(() => {
    const pad = 8;
    const rect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    let shiftX = 0;

    if (rect.right > vw - pad) shiftX += rect.right - (vw - pad);
    if (rect.left < pad) shiftX -= pad - rect.left;

    tooltip.style.transform = shiftX ? `translateX(calc(-50% - ${shiftX}px))` : 'translateX(-50%)';
  });
}

function setPlayModeTooltipOpen(open) {
  const tooltip = els.playModeTooltip;
  const help = els.playModeHelp;
  if (!tooltip || !help) return;

  tooltip.classList.toggle('is-open', open);
  help.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (open) positionPlayModeTooltip();
  else tooltip.style.removeProperty('transform');
}

function openHistoryOverlay() {
  if (!els.historyOverlay) return;
  els.historyOverlay.classList.remove('hidden');
  els.historyOverlay.hidden = false;
  els.historyOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => els.historyOverlay.classList.add('is-open'));
}

function closeHistoryOverlay() {
  if (!els.historyOverlay) return;
  els.historyOverlay.classList.remove('is-open');
  els.historyOverlay.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    if (els.historyOverlay.classList.contains('is-open')) return;
    els.historyOverlay.classList.add('hidden');
    els.historyOverlay.hidden = true;
  }, 180);
}

function bindHistoryBar() {
  els.historyBar?.addEventListener('click', openHistoryOverlay);
  els.historyClose?.addEventListener('click', closeHistoryOverlay);
  els.historyOverlay?.addEventListener('click', (e) => {
    if (e.target === els.historyOverlay) closeHistoryOverlay();
  });
  els.historyOverlay?.querySelector('.modal-sheet')?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

function bindPlayModeHelp() {
  const help = els.playModeHelp;
  const tooltip = els.playModeTooltip;
  if (!help || !tooltip) return;

  help.addEventListener('click', (e) => {
    e.stopPropagation();
    setPlayModeTooltipOpen(!tooltip.classList.contains('is-open'));
  });

  document.addEventListener('click', () => setPlayModeTooltipOpen(false));

  const onViewportChange = () => {
    if (tooltip.classList.contains('is-open')) positionPlayModeTooltip();
    scheduleMobileFit();
  };

  window.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
}

function setLoading(on) {
  els.loading.classList.toggle('hidden', !on);
}

/** @param {Card[]} cards */
function shuffleIds(cards) {
  const ids = cards.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}


function buildTempCards(type, texts) {
  return texts.map((text, index) => ({
    id: `temp-${type}-${index}-${text.length}-${hashText(text)}`,
    text,
  }));
}

function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function mergeCatalogWithTemp(base, tempTexts) {
  return {
    truth: [...base.truth, ...buildTempCards('truth', tempTexts.truth)],
    dare: [...base.dare, ...buildTempCards('dare', tempTexts.dare)],
  };
}

function applyCatalogToSession(session) {
  const drawn = new Set(session.history.map((h) => h.id));
  for (const type of ['truth', 'dare']) {
    const poolKey = type === 'truth' ? 'remainingTruthIds' : 'remainingDareIds';
    const validIds = (type === 'truth' ? catalog.truth : catalog.dare).map((c) => c.id);
    const validSet = new Set(validIds);
    let remaining = session[poolKey].filter((id) => validSet.has(id));
    for (const id of validIds) {
      if (!drawn.has(id) && !remaining.includes(id)) remaining.push(id);
    }
    session[poolKey] = remaining;
  }
  session.catalogVersion = catalogVersion;
  saveSession(session);
  return session;
}

window.applyTempCardsToGame = function applyTempCardsToGame() {
  const tempTexts = window.TempCards?.getTextsForApply?.() ?? { truth: [], dare: [] };
  catalog = mergeCatalogWithTemp(baseCatalog, tempTexts);
  catalogVersion = catalogFingerprint(catalog);
  const session = loadSession() || createNewSession();
  applyCatalogToSession(session);
  updateUI(session);
};


/** @param {'truth'|'dare'} type */
function findCard(type, id) {
  const list = type === 'truth' ? catalog.truth : catalog.dare;
  return list.find((c) => c.id === id);
}

function buildHistoryHtml(session) {
  return session.history.length
    ? session.history
        .slice()
        .reverse()
        .map((h) => {
          const deckLabel = h.type === 'truth' ? '真心話' : '大冒險';
          const crossNote = h.crossDeck ? ' <em style="color:#fbbf24;font-style:normal">（隔壁棚）</em>' : '';
          return `<li>[${deckLabel}]${crossNote} <span>${escapeHtml(h.text)}</span></li>`;
        })
        .join('')
    : '<li style="color:var(--muted)">尚無紀錄</li>';
}

function updateUI(session) {
  els.countTruth.textContent = String(session.remainingTruthIds.length);
  els.countDare.textContent = String(session.remainingDareIds.length);

  const truthEmpty = session.remainingTruthIds.length === 0;
  const dareEmpty = session.remainingDareIds.length === 0;

  if (els.pileRemainingTruth) els.pileRemainingTruth.classList.toggle('empty', truthEmpty);
  if (els.pileRemainingDare) els.pileRemainingDare.classList.toggle('empty', dareEmpty);

  els.truthDeck.classList.toggle('is-empty', truthEmpty);
  els.dareDeck.classList.toggle('is-empty', dareEmpty);

  els.truthDeck.querySelectorAll('.deck.face').forEach((el) => {
    el.classList.toggle('disabled', false);
  });
  els.dareDeck.querySelectorAll('.deck.face').forEach((el) => {
    el.classList.toggle('disabled', false);
  });

  const historyHtml = buildHistoryHtml(session);
  if (els.history) els.history.innerHTML = historyHtml;
  if (els.historyPopup) els.historyPopup.innerHTML = historyHtml;

  scheduleMobileFit();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

const REVEAL_CLOSE_MS = 200;

function hideReveal() {
  if (!els.revealOverlay) return;
  els.revealOverlay.classList.remove('is-open');
  els.revealOverlay.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    if (els.revealOverlay.classList.contains('is-open')) return;
    els.revealOverlay.classList.add('hidden');
    els.revealOverlay.hidden = true;
    els.result.innerHTML = '';
  }, REVEAL_CLOSE_MS);
}

/** @returns {CrossDeckMode} */
function loadCrossDeckMode() {
  const raw = localStorage.getItem(CROSS_DECK_MODE_KEY);
  if (raw === 'icebreaker' || raw === 'drunk') return raw;
  return 'peace';
}

/** @param {CrossDeckMode} mode */
function saveCrossDeckMode(mode) {
  localStorage.setItem(CROSS_DECK_MODE_KEY, mode);
}

function getCrossDeckChance() {
  return CROSS_DECK_CHANCES[loadCrossDeckMode()] ?? 0;
}

function updateCrossDeckModeUI() {
  const mode = loadCrossDeckMode();
  els.crossDeckModeBtns.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

/** @param {'truth'|'dare'} type @param {Card} card @param {{ crossDeck?: boolean }} [opts] */
function showReveal(type, card, opts = {}) {
  const label = type === 'truth' ? '真心話' : '大冒險';
  const crossDeckBanner = opts.crossDeck
    ? '<p class="cross-deck-banner">恭喜你抽到隔壁棚！</p>'
    : '';
  els.result.innerHTML = `
    <article class="card-reveal ${type}">
      ${crossDeckBanner}
      <div class="tag">${label}</div>
      <p id="revealTitle">${escapeHtml(card.text)}</p>
    </article>
  `;
  els.revealOverlay.classList.remove('hidden');
  els.revealOverlay.hidden = false;
  els.revealOverlay.setAttribute('aria-hidden', 'false');
  els.revealOverlay.classList.remove('is-open');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      els.revealOverlay.classList.add('is-open');
    });
  });
}

/** @param {'truth'|'dare'} type */
function drawCard(type) {
  const session = getOrInitSession();
  const requestedPoolKey = type === 'truth' ? 'remainingTruthIds' : 'remainingDareIds';

  if (session[requestedPoolKey].length === 0) {
    showReveal(type, { id: '', text: '此牌堆已抽完！請開啟新局或到後台新增卡牌。' });
    return;
  }

  let actualType = type;
  let isCrossDeck = false;
  const crossChance = getCrossDeckChance();

  if (crossChance > 0 && Math.random() < crossChance) {
    const otherType = type === 'truth' ? 'dare' : 'truth';
    const otherPoolKey = otherType === 'truth' ? 'remainingTruthIds' : 'remainingDareIds';
    if (session[otherPoolKey].length > 0) {
      actualType = otherType;
      isCrossDeck = true;
    }
  }

  const poolKey = actualType === 'truth' ? 'remainingTruthIds' : 'remainingDareIds';
  const pool = session[poolKey];
  const index = Math.floor(Math.random() * pool.length);
  const [cardId] = pool.splice(index, 1);
  const card = findCard(actualType, cardId);

  if (!card) {
    showError('卡牌資料不一致，請開啟新局。');
    return;
  }

  session.history.push({
    type: actualType,
    id: card.id,
    text: card.text,
    at: Date.now(),
    crossDeck: isCrossDeck,
  });
  saveSession(session);
  showReveal(actualType, card, { crossDeck: isCrossDeck });
  updateUI(session);
}

async function fetchCatalog() {
  const cfg = window.GAME_CONFIG || {};

  if (!cfg.apiBaseUrl) {
    return { ...DEMO_DECK };
  }

  if (cfg.useSupabaseRest) {
    return fetchFromSupabase(cfg);
  }

  return fetchFromCustomApi(cfg);
}

async function fetchFromSupabase(cfg) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: cfg.apiKey,
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  const base = cfg.apiBaseUrl.replace(/\/$/, '');
  const [truthRes, dareRes] = await Promise.all([
    fetch(`${base}/${cfg.truthTable}?select=id,text&enabled=eq.true&order=sort_order.asc`, { headers }),
    fetch(`${base}/${cfg.dareTable}?select=id,text&enabled=eq.true&order=sort_order.asc`, { headers }),
  ]);

  if (!truthRes.ok || !dareRes.ok) {
    throw new Error('無法從 Supabase 載入卡牌，請檢查 URL、Key 與資料表。');
  }

  const truth = await truthRes.json();
  const dare = await dareRes.json();
  return {
    truth: truth.map((row) => ({ id: String(row.id), text: row.text })),
    dare: dare.map((row) => ({ id: String(row.id), text: row.text })),
  };
}

async function fetchFromCustomApi(cfg) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const url = `${cfg.apiBaseUrl.replace(/\/$/, '')}/cards`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('無法從 API 載入卡牌 (/cards)。');

  const data = await res.json();
  return {
    truth: (data.truth || []).map((c) => ({ id: String(c.id), text: c.text })),
    dare: (data.dare || []).map((c) => ({ id: String(c.id), text: c.text })),
  };
}

function bindEvents() {
  window.TempCards?.init?.();
  bindPlayModeHelp();
  bindHistoryBar();

  if (els.revealOverlay) {
    els.revealOverlay.addEventListener('click', hideReveal);
  }

  els.btnNew.addEventListener('click', () => {
    if (!confirm('確定要開啟新局？本局已抽過的紀錄將全部清除。')) return;
    const session = createNewSession();
    saveSession(session);
    hideReveal();
    hideError();
    closeHistoryOverlay();
    updateUI(session);
  });

  els.truthDeck.addEventListener('click', (e) => {
    if (els.truthDeck.classList.contains('is-empty')) return;
    const deck = e.target.closest('.deck.face');
    if (deck) drawCard('truth');
  });

  els.dareDeck.addEventListener('click', (e) => {
    if (els.dareDeck.classList.contains('is-empty')) return;
    const deck = e.target.closest('.deck.face');
    if (deck) drawCard('dare');
  });

  els.crossDeckModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode !== 'peace' && mode !== 'icebreaker' && mode !== 'drunk') return;
      saveCrossDeckMode(mode);
      updateCrossDeckModeUI();
    });
  });
}

async function init() {
  bindEvents();
  updateCrossDeckModeUI();
  setLoading(true);
  hideError();

  try {
    baseCatalog = await fetchCatalog();
    const tempTexts = window.TempCards?.getTextsForApply?.() ?? { truth: [], dare: [] };
    catalog = mergeCatalogWithTemp(baseCatalog, tempTexts);
    catalogVersion = catalogFingerprint(catalog);

    if (!catalog.truth.length && !catalog.dare.length) {
      throw new Error('牌庫是空的，請到後端新增卡牌。');
    }

    const session = getOrInitSession();
    updateUI(session);
  } catch (err) {
    console.error(err);
    showError(err.message || '載入失敗');
    baseCatalog = { ...DEMO_DECK };
    const tempTexts = window.TempCards?.getTextsForApply?.() ?? { truth: [], dare: [] };
    catalog = mergeCatalogWithTemp(baseCatalog, tempTexts);
    catalogVersion = catalogFingerprint(catalog);
    updateUI(getOrInitSession());
  } finally {
    setLoading(false);
    scheduleMobileFit();
  }
}

init();
