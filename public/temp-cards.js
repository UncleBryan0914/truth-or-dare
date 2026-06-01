/**
 * 本局臨時題目（sessionStorage，關閉分頁即清除）
 */
(function () {
  const TEMP_STORAGE_KEY = 'truth_or_dare_temp_cards_v1';
  const TYPE_LABEL = { truth: '真心話', dare: '大冒險' };

  /** @type {{ truth: string[], dare: string[] }} */
  let draft = { truth: [''], dare: [''] };
  /** @type {'truth'|'dare'|null} */
  let editingType = null;

  const $ = (sel) => document.querySelector(sel);

  const els = {
    manageBtn: $('#btnManageTemp'),
    menuOverlay: $('#tempMenuOverlay'),
    editorOverlay: $('#tempEditorOverlay'),
    editorTitle: $('#tempEditorTitle'),
    editorRows: $('#tempEditorRows'),
    btnAddRow: $('#btnAddTempRow'),
    btnDone: $('#btnTempDone'),
  };

  function loadStored() {
    try {
      const raw = sessionStorage.getItem(TEMP_STORAGE_KEY);
      if (!raw) return { truth: [''], dare: [''] };
      const data = JSON.parse(raw);
      return {
        truth: Array.isArray(data.truth) && data.truth.length ? data.truth.map(String) : [''],
        dare: Array.isArray(data.dare) && data.dare.length ? data.dare.map(String) : [''],
      };
    } catch {
      return { truth: [''], dare: [''] };
    }
  }

  function saveStored() {
    sessionStorage.setItem(TEMP_STORAGE_KEY, JSON.stringify(draft));
  }

  function openOverlay(el) {
    if (!el) return;
    el.classList.remove('hidden');
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    el.classList.remove('is-open');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('is-open'));
    });
  }

  function closeOverlay(el) {
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (el.classList.contains('is-open')) return;
      el.classList.add('hidden');
      el.hidden = true;
    }, 200);
  }

  function openMenu() {
    draft = loadStored();
    openOverlay(els.menuOverlay);
  }

  function closeMenu() {
    closeOverlay(els.menuOverlay);
  }

  function readRowsFromEditor() {
    if (!editingType || !els.editorRows) return [];
    return [...els.editorRows.querySelectorAll('.temp-row-input')].map((input) => input.value);
  }

  function persistCurrentEditorToDraft() {
    if (!editingType) return;
    draft[editingType] = readRowsFromEditor();
    saveStored();
  }

  function renderEditorRows() {
    if (!editingType || !els.editorRows) return;
    const rows = draft[editingType].length ? draft[editingType] : [''];
    els.editorRows.innerHTML = rows
      .map(
        (text, i) => `
      <div class="temp-editor-row" data-index="${i}">
        <input type="text" class="temp-row-input" value="${escapeAttr(text)}" placeholder="輸入題目內容…" maxlength="500" />
        <button type="button" class="temp-row-remove" aria-label="刪除此列" title="刪除">×</button>
      </div>`,
      )
      .join('');
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function openEditor(type) {
    editingType = type;
    draft = loadStored();
    if (!draft[type].length) draft[type] = [''];
    if (els.editorTitle) {
      els.editorTitle.textContent = `新增的 ${TYPE_LABEL[type]} 題目`;
    }
    renderEditorRows();
    closeMenu();
    openOverlay(els.editorOverlay);
  }

  function closeEditor() {
    persistCurrentEditorToDraft();
    editingType = null;
    closeOverlay(els.editorOverlay);
  }

  function addRow() {
    if (!editingType) return;
    draft[editingType] = readRowsFromEditor();
    draft[editingType].push('');
    renderEditorRows();
    const inputs = els.editorRows.querySelectorAll('.temp-row-input');
    inputs[inputs.length - 1]?.focus();
  }

  function removeRow(index) {
    if (!editingType) return;
    const rows = readRowsFromEditor();
    if (rows.length <= 1) {
      rows[0] = '';
    } else {
      rows.splice(index, 1);
    }
    draft[editingType] = rows;
    renderEditorRows();
  }

  function getTextsForApply() {
    const stored = loadStored();
    return {
      truth: stored.truth.map((t) => t.trim()).filter(Boolean),
      dare: stored.dare.map((t) => t.trim()).filter(Boolean),
    };
  }

  function bindEvents() {
    els.manageBtn?.addEventListener('click', openMenu);

    els.menuOverlay?.querySelector('.modal-sheet')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    els.menuOverlay?.addEventListener('click', (e) => {
      if (e.target === els.menuOverlay) closeMenu();
    });
    els.menuOverlay?.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => openEditor(/** @type {'truth'|'dare'} */ (btn.dataset.pick)));
    });
    $('#tempMenuCancel')?.addEventListener('click', closeMenu);

    els.editorOverlay?.querySelector('.modal-sheet')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    els.editorOverlay?.addEventListener('click', (e) => {
      if (e.target === els.editorOverlay) {
        persistCurrentEditorToDraft();
        closeEditor();
      }
    });

    els.editorRows?.addEventListener('click', (e) => {
      const btn = e.target.closest('.temp-row-remove');
      if (!btn) return;
      const row = btn.closest('.temp-editor-row');
      const index = Number(row?.dataset.index);
      if (!Number.isNaN(index)) removeRow(index);
    });

    els.btnAddRow?.addEventListener('click', (e) => {
      e.stopPropagation();
      addRow();
    });

    els.btnDone?.addEventListener('click', (e) => {
      e.stopPropagation();
      persistCurrentEditorToDraft();
      closeEditor();
      if (window.applyTempCardsToGame) window.applyTempCardsToGame();
    });
  }

  window.TempCards = {
    init() {
      draft = loadStored();
      bindEvents();
    },
    getTextsForApply,
    loadStored,
  };
})();
