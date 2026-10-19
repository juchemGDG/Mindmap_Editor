'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Oberfläche: Start, Leisten, Dialoge, Tastatur
// ════════════════════════════════════════════════════════════════════

// ── Robustes Verdrahten (wie beim PAP-Editor) ───────────────────────
// Liegt im Browser-Cache noch eine ältere index.html, fehlen Elemente, die
// das neue Skript erwartet. Dann wird nur der betroffene Knopf übersprungen
// und oben ein Hinweis eingeblendet, statt dass die Seite leer bleibt.
const missingEls = new Set();
function byId(id, required) {
  const el = document.getElementById(id);
  if (!el && required) missingEls.add(id);
  return el;
}
function on(id, event, handler, options) {
  const el = byId(id, true);
  if (el) el.addEventListener(event, handler, options);
}
function warnStalePage() {
  if (!missingEls.size) return;
  console.warn('Fehlende Elemente in index.html:', [...missingEls].join(', '));
  const box = document.createElement('div');
  box.className = 'stale-warning';
  box.textContent = 'Diese Seite wurde aus einer veralteten Zwischenspeicher-Version geladen. Bitte einmal mit Strg+F5 (Mac: ⌘+Shift+R) neu laden.';
  document.body.appendChild(box);
}

// ── Dialoge ─────────────────────────────────────────────────────────
function showModal(title, msg) {
  const box = $('modal'), t = $('modal-title'), b = $('modal-body');
  if (!box || !t || !b) { alert(`${title}\n\n${msg}`); return; }
  t.textContent = title; b.textContent = msg; box.style.display = 'flex';
  setTimeout(() => { const ok = $('modal-close'); if (ok) ok.focus(); }, 30);
}

let promptCb = null, promptEl = null;
function showPrompt(title, lbl, def, cb, multiline, big) {
  const box = $('prompt-modal'), inp = $('prompt-input'), ta = $('prompt-textarea');
  if (!box || !inp || !ta) { const v = prompt(lbl, def); cb(v); return; }
  $('prompt-title').textContent = title;
  $('prompt-label').textContent = lbl;
  promptEl = multiline ? ta : inp;
  inp.style.display = multiline ? 'none' : 'block';
  ta.style.display = multiline ? 'block' : 'none';
  ta.rows = big ? 12 : 3;
  $('prompt-hint').style.display = multiline ? 'block' : 'none';
  $('prompt-hint').textContent = big ? 'Enter = neue Zeile · Strg/⌘+Enter = OK' : 'Shift+Enter = neue Zeile · Enter = OK';
  promptEl.dataset.big = big ? '1' : '';
  promptEl.value = def || '';
  box.style.display = 'flex';
  setTimeout(() => { promptEl.focus(); promptEl.select(); }, 60);
  promptCb = cb;
}
function closePrompt(value) {
  const box = $('prompt-modal');
  if (box) box.style.display = 'none';
  if (promptCb) { const cb = promptCb; promptCb = null; cb(value); }
}

const MODALS = ['prompt-modal', 'modal', 'help-modal', 'download-modal', 'template-modal', 'plan-modal', 'share-modal', 'qr-big'];
function topModal() { return MODALS.map(id => $(id)).find(el => el && el.style.display === 'flex'); }
function closeModal(el) {
  if (!el) return;
  if (el.id === 'prompt-modal') closePrompt(null);
  else el.style.display = 'none';
}

// ── Menüs (Kontextmenü, Export-Menü) ────────────────────────────────
let menuEl = null;
function closeMenus() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showMenu(x, y, items) {
  closeMenus();
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  for (const it of items) {
    if (it.sep) { m.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    if (it.head) { m.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-head', textContent: it.head })); continue; }
    if (it.row) {
      const r = document.createElement('div');
      r.className = 'ctx-row';
      r.innerHTML = `<span>${esc(it.row)}</span>`;
      const box = document.createElement('div');
      box.className = 'ctx-chips';
      for (const c of it.chips) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ctx-chip' + (c.on ? ' on' : '') + (c.swatch ? ' swatch' : '');
        if (c.swatch) b.style.background = c.swatch;
        else b.innerHTML = (c.dot ? `<i style="background:${c.dot}"></i>` : '') + esc(c.label);
        if (c.title) b.title = c.title;
        b.addEventListener('click', () => { closeMenus(); c.act(); });
        box.appendChild(b);
      }
      r.appendChild(box);
      m.appendChild(r);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.innerHTML = `<span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}`;
    b.disabled = !!it.disabled || (readOnly && !it.safe);
    b.addEventListener('click', () => { closeMenus(); it.act(); });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  menuEl = m;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(window.innerWidth - r.width - 6, x)) + 'px';
  m.style.top = Math.max(6, Math.min(window.innerHeight - r.height - 6, y)) + 'px';
}

function showExportMenu(btn) {
  const r = btn.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { head: 'Importieren' },
    { label: 'Datei unter dem markierten Punkt einfügen …', act: importIntoMap },
    { head: 'Bild' },
    { label: 'PNG-Bild', act: () => exportAs('png'), safe: true },
    { label: 'JPG-Bild', act: () => exportAs('jpg'), safe: true },
    { label: 'SVG (Vektor)', act: () => exportAs('svg'), safe: true },
    { label: 'Drucken / PDF …', act: () => exportAs('print'), safe: true, disabled: DESKTOP },
    { head: 'Text' },
    { label: 'Gliederung (Markdown)', act: () => exportAs('md'), safe: true },
    { label: 'OPML (für andere Mindmap-Programme)', act: () => exportAs('opml'), safe: true },
    { head: 'Plan' },
    { label: 'Aufgabenliste (Markdown)', act: () => exportAs('tasks-md'), safe: true },
    { label: 'Aufgaben als Tabelle (CSV)', act: () => exportAs('csv'), safe: true },
    { label: 'Termine für den Kalender (ICS)', act: () => exportAs('ics'), safe: true },
  ]);
}

// ── Phase, Darstellung ──────────────────────────────────────────────
function setPhase(p) {
  if (phase() === p) return;
  mutate('Phase', () => { M().phase = p; });
  const ph = PHASES.find(x => x.key === p);
  flashStatus(`Phase „${ph.label}“: ${ph.hint}`);
}

function applyMetaUi() {
  const m = M();
  document.body.dataset.phase = m.phase || 'collect';
  document.querySelectorAll('[data-phase]').forEach(b => {
    const i = PHASES.findIndex(p => p.key === b.dataset.phase);
    const cur = PHASES.findIndex(p => p.key === (m.phase || 'collect'));
    b.classList.toggle('on', i === cur);
    b.classList.toggle('past', i < cur);
  });
  const setv = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  setv('set-layout', m.layout || 'map');
  setv('set-lines', m.lineStyle || 'curve');
  setv('set-colors', m.branchColors || 'muted');
  setv('map-title', m.title || '');
  const ti = $('map-title');
  if (ti) ti.placeholder = label(index().rid) || 'Titel';
  const lines = $('set-lines');
  if (lines) lines.disabled = m.layout === 'org';
  document.title = (m.title || label(index().rid)) + ' – ' + APP_NAME;
  updateTimer();
  updateVoteBox();
}

function setTheme(k) {
  themeKey = THEMES[k] ? k : 'light';
  document.body.dataset.theme = themeKey;
  try { localStorage.setItem('mm-theme', themeKey); } catch (e) { /* egal */ }
  const el = $('set-theme');
  if (el) el.value = themeKey;
  inspectorKey = '';
  updateInspector();
  requestRender(true);
  if (currentView !== 'map') renderCurrentView();
}

function updateStatus() {
  const el = $('status');
  if (!el) return;
  const all = Object.keys(doc.nodes).length;
  let tasks = 0, done = 0;
  for (const id in doc.nodes) if (doc.nodes[id].task) { tasks++; if (doc.nodes[id].status === 'done') done++; }
  let s = `${all} ${all === 1 ? 'Punkt' : 'Punkte'}`;
  if (tasks) s += ` · ${done}/${tasks} erledigt`;
  if (readOnly) s += ' · nur ansehen';
  el.textContent = s;
}

function updateUndoButtons() {
  const u = $('btn-undo'), r = $('btn-redo');
  if (u) u.disabled = !undoStack.length || readOnly;
  if (r) r.disabled = !redoStack.length || readOnly;
}

// ── Hilfe ───────────────────────────────────────────────────────────
function showHelp() {
  const sb = $('sidebar'); if (sb) sb.classList.remove('open');
  const m = $('help-modal'); if (m) m.style.display = 'flex';
}

// ── Reaktion auf jede Änderung ──────────────────────────────────────
let checkTimer = null;
function onDocChanged(info) {
  if (cleanSelection()) { updateInspector(); }
  requestRender(true);
  if (currentView !== 'map') renderCurrentView();
  updateInspector();
  updateStatus();
  updateUndoButtons();
  updateCaptureTarget();
  applyMetaUi();
  updateFocusBar();
  if (info.local || info.replaced) { if (!info.replaced) setDirty(true); scheduleAutosave(); }
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => runCheck(), 300);
  checkLive();
  if (collab) updatePeers();
}

function isTyping(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

// ── Tastatur ────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (presentState) { if (presentKey(e)) e.preventDefault(); return; }
  const modal = topModal();
  if (modal) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(modal); }
    return;
  }
  if (menuEl && e.key === 'Escape') { closeMenus(); return; }
  const typing = isTyping(e.target);
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z' && !e.shiftKey) { if (!typing) { e.preventDefault(); undo(); } return; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { if (!typing) { e.preventDefault(); redo(); } return; }
    if (k === 's') { e.preventDefault(); saveMap(); return; }
    if (k === 'o') { e.preventDefault(); openMap(); return; }
    if (k === 'f') { e.preventDefault(); openSearch(); return; }
    if (k === 'i' && !typing) { e.preventDefault(); toggleInspector(); return; }
  }
  if (typing) return;
  if (e.key === 'F1') { e.preventDefault(); showHelp(); return; }
  if (currentView === 'map' && mapKeyDown(e)) { e.preventDefault(); return; }
  if (currentView !== 'map' && e.key === 'Escape' && sel.size) { select([]); }
}

// ════════════════════════════════════════════════════════════════════
// Start
// ════════════════════════════════════════════════════════════════════
function init() {
  if (!setupMapCanvas()) { warnStalePage(); return; }
  try { themeKey = localStorage.getItem('mm-theme') || 'light'; } catch (e) { /* egal */ }
  if (DESKTOP) document.body.classList.add('desktop');
  setTheme(themeKey);
  try { inspectorOpen = localStorage.getItem('mm-inspector') !== '0' && window.innerWidth > 1280; } catch (e) { /* egal */ }
  document.body.classList.toggle('inspector-closed', !inspectorOpen);

  onChange(onDocChanged);
  bindMapEvents();
  bindOutline();
  bindKanban();
  bindTimeline();
  bindCheckPanel();
  bindPlanWizard();
  bindPresentation();

  // ── obere Leiste ──
  document.querySelectorAll('[data-view-tab]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.viewTab)));
  document.querySelectorAll('[data-phase]').forEach(b => b.addEventListener('click', () => setPhase(b.dataset.phase)));
  on('map-title', 'input', e => mutate('Titel', () => { M().title = e.target.value; }, { merge: 'title' }));
  on('btn-new', 'click', showTemplates);
  on('btn-open', 'click', openMap);
  on('btn-save', 'click', saveMap);
  on('btn-export', 'click', e => { e.stopPropagation(); showExportMenu(e.currentTarget); });
  on('btn-check', 'click', () => { if (checkOpen) closeCheck(); else runCheck(true); });
  on('check-close', 'click', closeCheck);
  on('btn-plan', 'click', openPlanWizard);
  on('btn-present', 'click', () => startPresentation());
  on('btn-share', 'click', () => showShare());
  on('btn-desktop', 'click', showDownloads);
  on('btn-undo', 'click', undo);
  on('btn-redo', 'click', redo);
  on('btn-inspector', 'click', () => toggleInspector());
  on('inspector-close', 'click', () => toggleInspector(false));
  on('sidebar-toggle', 'click', () => { const sb = $('sidebar'); if (sb) sb.classList.toggle('open'); });
  on('menu-toggle', 'click', () => { const mb = $('menubar'); if (mb) mb.classList.toggle('open'); });
  on('menubar', 'click', e => { if (e.target.closest('button') && !e.target.closest('#btn-export')) { const mb = $('menubar'); if (mb) mb.classList.remove('open'); } });

  // ── linke Leiste ──
  on('capture-input', 'keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCapture(); }
    if (e.key === 'Escape') { e.target.blur(); }
  });
  on('capture-input', 'input', e => { e.target.style.height = ''; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; });
  on('capture-add', 'click', submitCapture);
  document.querySelectorAll('[data-timer]').forEach(b => b.addEventListener('click', () => startTimer(Number(b.dataset.timer))));
  on('timer-stop', 'click', stopTimer);
  on('vote-limit', 'change', e => { const v = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 3)); mutate('Punkte pro Person', () => { M().voteLimit = v; }); });
  on('vote-reset-mine', 'click', () => resetVotes(false));
  on('vote-reset-all', 'click', () => { if (confirm('Alle Punkte aller Personen löschen?')) resetVotes(true); });
  on('vote-sort', 'click', () => { for (const id of treeOrder()) if (kids(id).length > 1) sortChildren(id, 'votes'); flashStatus('Nach Punkten sortiert'); });
  on('set-layout', 'change', e => { mutate('Layout', () => { M().layout = e.target.value; }); setTimeout(() => fitView(), 30); });
  on('set-lines', 'change', e => mutate('Linien', () => { M().lineStyle = e.target.value; }));
  on('set-colors', 'change', e => mutate('Astfarben', () => { M().branchColors = e.target.value; }));
  on('set-theme', 'change', e => setTheme(e.target.value));
  on('toggle-grid', 'change', e => { showGrid = e.target.checked; try { localStorage.setItem('mm-grid', showGrid ? '1' : '0'); } catch (x) { /* egal */ } requestRender(); });
  on('btn-fit', 'click', () => { if (currentView !== 'map') switchView('map'); fitView(); });
  on('btn-level1', 'click', () => { if (currentView !== 'map') switchView('map'); collapseToLevel(1); });
  on('btn-expand', 'click', expandAll);
  on('btn-reset-pos', 'click', resetPositions);
  on('btn-help-side', 'click', showHelp);
  try { showGrid = localStorage.getItem('mm-grid') !== '0'; } catch (e) { /* egal */ }
  const grid = $('toggle-grid'); if (grid) grid.checked = showGrid;

  // ── Leinwand-Werkzeuge ──
  on('zoom-in', 'click', () => zoomBy(1.2));
  on('zoom-out', 'click', () => zoomBy(1 / 1.2));
  on('zoom-fit', 'click', () => fitView());
  on('focus-exit', 'click', () => toggleFocusMode(null));
  on('search-input', 'input', e => runSearch(e.target.value));
  on('search-input', 'keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); searchNext(e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  on('search-close', 'click', closeSearch);
  on('node-actions', 'click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = primary();
    const a = b.dataset.act;
    if (a === 'child') addChild(id);
    else if (a === 'sibling') addSibling(id);
    else if (a === 'edit') startEdit(id, { caretEnd: true });
    else if (a === 'task') cycleStatus();
    else if (a === 'more') { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, nodeMenuItems(id)); }
  });
  on('node-actions', 'pointerdown', e => e.stopPropagation());
  on('live-follow', 'click', followLive);
  on('live-dismiss', 'click', () => { liveDismissed = M().live ? M().live.t : null; hideLiveBanner(); });

  // ── Dialoge ──
  on('modal-close', 'click', () => closeModal($('modal')));
  on('prompt-ok', 'click', () => closePrompt(promptEl ? promptEl.value : ''));
  on('prompt-cancel', 'click', () => closePrompt(null));
  on('prompt-input', 'keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); closePrompt(promptEl.value); }
  });
  on('prompt-textarea', 'keydown', e => {
    if (e.key !== 'Enter') return;
    const big = e.target.dataset.big === '1';
    if (big ? (e.ctrlKey || e.metaKey) : (!e.shiftKey && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); closePrompt(promptEl.value); }
  });
  on('help-close', 'click', () => closeModal($('help-modal')));
  on('download-close', 'click', () => closeModal($('download-modal')));
  on('template-close', 'click', () => closeModal($('template-modal')));
  on('template-list', 'click', e => { const b = e.target.closest('[data-tpl]'); if (b) chooseTemplate(b.dataset.tpl); });
  on('share-close', 'click', hideShare);
  on('share-start', 'click', startCollab);
  on('share-leave', 'click', () => leaveRoom(true));
  on('share-copy-edit', 'click', () => copyField('share-edit-url'));
  on('share-copy-view', 'click', () => copyField('share-view-url'));
  on('share-big-edit', 'click', () => showQrBig($('share-edit-url').value));
  on('share-big-view', 'click', () => showQrBig($('share-view-url').value));
  on('share-rename', 'click', () => askName(() => scheduleSync(0)));
  on('qr-big', 'click', () => closeModal($('qr-big')));
  // Klick auf den abgedunkelten Hintergrund schließt den Dialog
  for (const id of MODALS) {
    const el = $(id);
    if (el && id !== 'qr-big') el.addEventListener('click', e => { if (e.target === el) closeModal(el); });
  }

  // ── global ──
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenus(); }, true);
  document.addEventListener('copy', e => { if (!isTyping(e.target) && currentView === 'map' && !topModal()) copySelection(e); });
  document.addEventListener('cut', e => { if (!isTyping(e.target) && currentView === 'map' && !topModal() && !readOnly) { copySelection(e); deleteSelection(); } });
  document.addEventListener('paste', e => {
    if (isTyping(e.target) || currentView !== 'map' || topModal() || readOnly) return;
    e.preventDefault();
    pasteText((e.clipboardData || window.clipboardData).getData('text/plain'));
  });
  // Desktop-Version: sobald die Brücke bereit ist, den Zustand melden
  window.addEventListener('pywebviewready', () => { document.body.classList.add('desktop'); const d = dirty; dirty = !d; setDirty(d); });
  const sideOv = $('sidebar-overlay');
  if (sideOv) sideOv.addEventListener('click', () => $('sidebar').classList.remove('open'));

  // ── Inhalt laden ──
  let restored = false;
  if (!EMBED && !joinFromUrl()) restored = restoreAutosave();
  if (!restored && !collab && !EMBED) replaceDoc(templateDoc(TEMPLATES[0]));
  setDirty(false);
  let v = 'map';
  try { v = localStorage.getItem('mm-view') || 'map'; } catch (e) { /* egal */ }
  switchView(collab ? 'map' : v);
  afterDocLoaded();
  if (restored) flashStatus('Letzter Stand wiederhergestellt');
  else if (!collab && !EMBED) { selectOne(index().rid); }
  updateStatus();
  updateUndoButtons();
  initEmbed();
  warnStalePage();
  setTimeout(() => canvas.focus({ preventScroll: true }), 50);
}

window.addEventListener('DOMContentLoaded', init);
