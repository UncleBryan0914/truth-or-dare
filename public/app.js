/**
 * 真心話大冒險 — 前端邏輯
 * - 牌庫從後端 API 載入（或內建示範）
 * - 本局狀態存 localStorage，F5 不會重置
 * - 僅「開啟新局」會清空已抽紀錄
 */

const STORAGE_KEY = 'truth_or_dare_session_v1';

const TEMP_STORAGE_KEY = 'truth_or_dare_temp_cards_v1';

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
};

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
}

function hideError() {
  els.error.classList.remove('visible');
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

  els.history.innerHTML = session.history.length
    ? session.history
        .slice()
        .reverse()
        .map(
          (h) =>
            `<li>[${h.type === 'truth' ? '真心話' : '大冒險'}] <span>${escapeHtml(h.text)}</span></li>`
        )
        .join('')
    : '<li style="color:var(--muted)">尚無紀錄</li>';
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

/** @param {'truth'|'dare'} type @param {Card} card */
function showReveal(type, card) {
  const label = type === 'truth' ? '真心話' : '大冒險';
  els.result.innerHTML = `
    <article class="card-reveal ${type}">
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
  const poolKey = type === 'truth' ? 'remainingTruthIds' : 'remainingDareIds';
  const pool = session[poolKey];

  if (pool.length === 0) {
    showReveal(type, { id: '', text: '此牌堆已抽完！請開啟新局或到後台新增卡牌。' });
    return;
  }

  const index = Math.floor(Math.random() * pool.length);
  const [cardId] = pool.splice(index, 1);
  const card = findCard(type, cardId);

  if (!card) {
    showError('卡牌資料不一致，請開啟新局。');
    return;
  }

  session.history.push({ type, id: card.id, text: card.text, at: Date.now() });
  saveSession(session);
  showReveal(type, card);
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

  if (els.revealOverlay) {
    els.revealOverlay.addEventListener('click', hideReveal);
  }

  els.btnNew.addEventListener('click', () => {
    if (!confirm('確定要開啟新局？本局已抽過的紀錄將全部清除。')) return;
    const session = createNewSession();
    saveSession(session);
    hideReveal();
    hideError();
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
}

async function init() {
  bindEvents();
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
  }
}

init();
