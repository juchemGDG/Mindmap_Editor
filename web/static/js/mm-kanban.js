'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Kanban-Prozess: Oberfläche
//
// Board mit frei konfigurierbaren Spalten, Karteneditor, Protokoll,
// Mitglieder und Datenschutz. Die Logik dazu steht in mm-kanban-model.js.
//
// Bedienung (alles auch ohne Ziehen möglich):
//   Maus/Finger   Karte ziehen = verschieben, tippen = Karte öffnen,
//                 ⠿ im Spaltenkopf ziehen = Spalte verschieben
//   ⋯ an der Karte  Menü „Verschieben nach …“, Blocker, Löschen
//   Tastatur      Pfeiltasten wandern, Shift+←/→ verschiebt die Karte,
//                 Enter öffnet, M öffnet das Menü
// ════════════════════════════════════════════════════════════════════

let kpFilter = { branch: '', owner: '', tags: [] };
let kpCompact = false;
let kpDrag = null;            // {kind:'card'|'col', id, el, sx, sy, ghost, pid}
let kpSuppressClick = false;  // nach dem Ziehen keinen Klick auslösen
let kpCardId = null;          // Karte im geöffneten Editor
let kpDialog = null;          // {kind:'col'|'log'|'members'|'privacy'|'notice'|'delcol', …}
let kpLogFilter = { who: '', task: '', from: '', to: '' };
let kpPreview = false;        // Karteneditor: Inhalt als Vorschau zeigen
try { kpCompact = localStorage.getItem('mm-kanban-compact') === '1'; } catch (e) { /* egal */ }

/** Schalter „Kanban-Modus: einfach / Prozess“ (steht in beiden Modi im Kopf). */
function kanbanModeSwitch() {
  const p = kanbanProcess();
  return `<div class="seg small" data-kmode role="group" aria-label="Kanban-Modus">
    <button type="button" data-val="simple" class="${p ? '' : 'on'}" aria-pressed="${!p}" title="Feste Spalten wie bisher">Einfach</button>
    <button type="button" data-val="process" class="${p ? 'on' : ''}" aria-pressed="${p}" title="Eigene Spalten, WIP-Limits, Protokoll">Prozess</button></div>`;
}

// ════════════════════════════════════════════════════════════════════
// Board zeichnen
// ════════════════════════════════════════════════════════════════════
function kpPass(id) {
  const n = doc.nodes[id];
  if (kpFilter.branch && branchOf(id) !== kpFilter.branch && id !== kpFilter.branch) return false;
  if (kpFilter.owner === '-' && ownersOf(n).length) return false;
  if (kpFilter.owner && kpFilter.owner !== '-' && !ownersOf(n).includes(kpFilter.owner)) return false;
  if (kpFilter.tags.length && !tagsOf(n).some(t => kpFilter.tags.includes(t))) return false;
  return true;
}

function renderKanbanProcess() {
  const host = $('kanban-view');
  if (!host) return;
  // Fokus merken, damit Tastaturbedienung nach dem Neuzeichnen weitergeht
  const act = document.activeElement;
  // Wer gerade eine Retrospektive schreibt, wird nicht unterbrochen (neu gezeichnet wird beim Verlassen des Feldes)
  if (kpPane === 'retro' && act && host.contains(act) && act.matches('[data-rq], [data-rtitle]')) return;
  const keep = act && host.contains(act) ? (act.dataset.pcard ? { card: act.dataset.pcard } : act.dataset.cgrip ? { grip: act.dataset.cgrip } : null) : null;

  if (kpPane !== 'board') {
    host.innerHTML = `<div class="view-head"><h2>Kanban</h2><div class="view-tools">${kanbanModeSwitch()}${paneSwitch()}
        <button type="button" class="btn-small" data-ka="log">Protokoll</button></div></div><div class="kp-pane"></div>`;
    renderInsightPane(host.querySelector('.kp-pane'));
    maybeShowNotice();
    return;
  }

  const cols = boardColumns();
  const cards = boardCards();
  const branches = kids(index().rid);
  const members = boardMembers();
  const tags = knownTags();
  kpFilter.tags = kpFilter.tags.filter(t => tags.includes(t));
  const me = currentPerson();
  const ro = readOnly;

  const head = `<div class="view-head"><h2>Kanban</h2>
    <div class="view-tools">
      ${kanbanModeSwitch()}${paneSwitch()}
      <label>Ast <select data-kp="branch"><option value="">alle</option>${branches.map(b => `<option value="${esc(b)}"${kpFilter.branch === b ? ' selected' : ''}>${esc(label(b))}</option>`).join('')}</select></label>
      <label>Zuständig <select data-kp="owner"><option value="">alle</option><option value="-"${kpFilter.owner === '-' ? ' selected' : ''}>niemand</option>${members.map(o => `<option${kpFilter.owner === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      ${ro ? '' : `<label class="kp-me${!me && personal() ? ' missing' : ''}">Ich bin <select data-kp="me" aria-label="Wer arbeitet gerade an diesem Gerät?"><option value="">– wählen –</option>${[...new Set([...members, me].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de')).map(o => `<option${o === me ? ' selected' : ''}>${esc(o)}</option>`).join('')}<option value="__new">+ neu …</option></select></label>`}
      <button type="button" class="btn-small" data-ka="compact" aria-pressed="${kpCompact}" title="Karten kompakt oder mit allen Angaben zeigen">${kpCompact ? 'Volle Karten' : 'Kompakt'}</button>
      <button type="button" class="btn-small" data-ka="log">Protokoll</button>
      <button type="button" class="btn-small" data-ka="members">Mitglieder</button>
      <button type="button" class="btn-small" data-ka="privacy">Datenschutz</button>
      ${ro ? '' : '<button type="button" class="btn-small" data-ka="templates">Vorlage …</button><button type="button" class="btn-small" data-ka="add-col">+ Spalte</button>'}
    </div></div>
    ${tags.length ? `<div class="kp-tagbar" role="group" aria-label="Nach Tags filtern"><span>Tags:</span>${tags.map(t => `<button type="button" class="kp-tag${kpFilter.tags.includes(t) ? ' on' : ''}" data-ktag="${esc(t)}" aria-pressed="${kpFilter.tags.includes(t)}">#${esc(t)}</button>`).join('')}${kpFilter.tags.length ? '<button type="button" class="btn-link" data-ka="tags-clear">Filter aufheben</button>' : ''}</div>` : ''}
    ${!ro && !me && personal() ? '<p class="view-note kp-me-note">Bitte oben „Ich bin …“ wählen – sonst steht im Protokoll kein Name.</p>' : ''}`;

  const colHtml = col => {
    const all = cards.get(col.id) || [];
    const items = all.filter(kpPass);
    if (col.statusKey !== 'idea') items.sort((a, b) => taskSort(a, b));
    const over = col.wip && all.length > col.wip;
    const count = col.wip ? `${all.length}/${col.wip}` : `${all.length}`;
    const aria = `Spalte ${col.title}, ${all.length} Karten${col.wip ? `, Limit ${col.wip}` : ''}${over ? ', Limit überschritten' : ''}`;
    return `<section class="kcol kpcol${over ? ' wip-over' : ''}${col.statusKey === 'idea' ? ' idea' : ''}" data-colid="${esc(col.id)}" aria-label="${esc(aria)}"${col.color ? ` style="--cc:${colorValue(col.color)}"` : ''}>
      <header>
        ${ro ? '' : `<button type="button" class="kp-grip" data-cgrip="${esc(col.id)}" aria-label="Spalte ${esc(col.title)} verschieben (ziehen oder Shift+Pfeiltaste)" title="Ziehen, um die Spalte zu verschieben">⠿</button>`}
        <b class="kp-title">${esc(col.title)}</b>
        <span class="kp-count" title="${col.wip ? 'Karten / WIP-Limit' : 'Karten'}">${count}</span>
        ${ro ? '' : `<button type="button" class="kp-icon" data-ka="col-settings" data-col="${esc(col.id)}" aria-label="Einstellungen der Spalte ${esc(col.title)}" title="Spalte einstellen">⚙</button>`}
      </header>
      <div class="kp-cat">Status: ${esc(statusLabel(col.statusKey).replace(/ \(.*\)/, ''))}</div>
      ${over ? `<div class="kp-wipwarn" role="status">⚠ WIP-Limit überschritten (${count})</div>` : ''}
      <div class="kcards">${items.map(id => cardHtml(id, col)).join('') || `<div class="kempty">${all.length ? 'Keine Karte passt zum Filter.' : 'Karten hierher ziehen'}</div>`}</div>
      ${ro ? '' : `<button type="button" class="kp-addcard" data-ka="add-card" data-col="${esc(col.id)}" aria-label="Karte in ${esc(col.title)} hinzufügen">+ Karte</button>`}
    </section>`;
  };

  host.innerHTML = head + `<div class="kboard kp${kpCompact ? ' compact' : ''}">${cols.map(colHtml).join('')}</div>`;

  if (keep) {
    const el = keep.card ? host.querySelector(`[data-pcard="${CSS.escape(keep.card)}"]`) : host.querySelector(`[data-cgrip="${CSS.escape(keep.grip)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  maybeShowNotice();
}

function cardHtml(id, col) {
  const n = doc.nodes[id];
  const br = branchOf(id);
  const path = br && br !== id ? label(br) + (parentOf(id) !== br && parentOf(id) ? ' › ' + label(parentOf(id)) : '') : '';
  const blockers = blockersOf(id);
  const manual = manualBlocked(n);
  const blocked = manual || blockers.length > 0;
  const cl = checklistOf(id);
  const tags = tagsOf(n);
  let meta = chipsHtml(id);
  if (n.estimate) meta += `<span class="chip" title="Aufwand">${esc(n.estimate)}</span>`;
  if (cl.all) meta += `<span class="chip" title="Unterpunkte erledigt">☑ ${cl.done}/${cl.all}</span>`;
  if (n.note) meta += '<span class="chip" title="Karte hat Inhalt">≡</span>';
  const why = manual ? (n.blocked.reason || 'ohne Begründung') : 'wartet auf ' + blockers.map(d => `„${label(d)}“`).join(', ');
  const aria = [label(id), 'Spalte ' + col.title, blocked ? 'blockiert' : '', ownersOf(n).length ? 'zuständig ' + ownersOf(n).join(', ') : '',
    n.due ? 'fällig ' + fmtLong(n.due) : '', cl.all ? `${cl.done} von ${cl.all} Unterpunkten erledigt` : ''].filter(Boolean).join(', ');
  return `<article class="kcard kpcard${sel.has(id) ? ' selected' : ''}${blocked ? ' blocked' : ''}${col.statusKey === 'done' ? ' isdone' : ''}" data-sel-id="${esc(id)}" data-pcard="${esc(id)}"
      tabindex="0" aria-label="${esc(aria)}" style="--bc:${branchColor(id)}">
    ${path && !kpCompact ? `<div class="kpath">${esc(path)}</div>` : ''}
    <div class="ktext">${n.icon ? esc(n.icon) + ' ' : ''}${esc(label(id))}</div>
    ${blocked ? `<div class="kp-block">⛔ blockiert${kpCompact ? '' : ': ' + esc(why)}</div>` : ''}
    ${!kpCompact && tags.length ? `<div class="kp-cardtags">${tags.map(t => `<span class="kp-tag small">#${esc(t)}</span>`).join('')}</div>` : ''}
    ${!kpCompact && n.note ? `<div class="kp-note md">${renderMarkdown(n.note)}</div>` : ''}
    ${!kpCompact && meta ? `<div class="kmeta">${meta}</div>` : (kpCompact && cl.all ? `<div class="kmeta"><span class="chip">☑ ${cl.done}/${cl.all}</span></div>` : '')}
    ${readOnly ? '' : `<button type="button" class="kp-more" data-ka="card-menu" data-card="${esc(id)}" aria-label="Aktionen für ${esc(label(id))}" title="Verschieben nach …, Blocker, Löschen">⋯</button>`}
  </article>`;
}

// ── Hinweis (Toast) – nicht blockierend, wegklickbar ────────────────
let toastTimer = null;
function kanbanToast(msg) {
  let el = $('k-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(msg)}</span><button type="button" aria-label="Hinweis schließen">✕</button>`;
  el.querySelector('button').addEventListener('click', () => { el.style.display = 'none'; });
  el.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 12000);
}

// ════════════════════════════════════════════════════════════════════
// Ereignisse auf dem Board
// ════════════════════════════════════════════════════════════════════
function bindKanbanProcess() {
  const host = $('kanban-view');
  if (!host) return;

  host.addEventListener('click', e => {
    const mode = e.target.closest('[data-kmode] button');
    if (mode) { if (readOnly) return; setKanbanMode(mode.dataset.val); return; }
    if (!kanbanProcess()) return;
    if (kpSuppressClick) { kpSuppressClick = false; return; }
    const tag = e.target.closest('[data-ktag]');
    if (tag) {
      const t = tag.dataset.ktag;
      kpFilter.tags = kpFilter.tags.includes(t) ? kpFilter.tags.filter(x => x !== t) : [...kpFilter.tags, t];
      renderKanbanProcess();
      return;
    }
    const a = e.target.closest('[data-ka]');
    if (a) { kanbanAction(a.dataset.ka, a); return; }
    const c = e.target.closest('[data-pcard]');
    if (c) openCard(c.dataset.pcard);
  });

  host.addEventListener('change', e => {
    if (!kanbanProcess()) return;
    const f = e.target.dataset.kp;
    if (!f) return;
    if (f === 'me') {
      if (e.target.value === '__new') { askNewMember(name => { if (name) setCurrentPerson(name); renderKanbanProcess(); }); return; }
      setCurrentPerson(e.target.value);
      renderKanbanProcess();
      return;
    }
    kpFilter[f] = e.target.value;
    renderKanbanProcess();
  });

  host.addEventListener('keydown', e => {
    if (!kanbanProcess()) return;
    const grip = e.target.closest && e.target.closest('[data-cgrip]');
    if (grip && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const id = grip.dataset.cgrip;
      const i = boardColumns().findIndex(c => c.id === id);
      moveColumn(id, i + (e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    const card = e.target.closest && e.target.closest('[data-pcard]');
    if (!card || e.target !== card) return;
    const id = card.dataset.pcard;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(id); return; }
    if (e.key === 'm' || e.key === 'M' || e.key === 'ContextMenu') { e.preventDefault(); openCardMenu(id, card); return; }
    const arrows = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.shiftKey && arrows[e.key] && !readOnly) {
      e.preventDefault();
      const cols = boardColumns();
      const cur = cols.findIndex(c => c.id === (columnFor(doc.nodes[id]) || {}).id);
      const next = cols[cur + arrows[e.key]];
      if (next) kpMoveCard(id, next.id);
      // Fokus bleibt auf der Karte – außer es hat sich ein Dialog geöffnet (Definition of Done)
      const el = host.querySelector(`[data-pcard="${CSS.escape(id)}"]`);
      if (el && !topModal()) el.focus();
      return;
    }
    if (arrows[e.key] || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusNeighbour(card, e.key);
    }
  });

  bindInsights(host);

  // ── Ziehen (Maus, Stift und Finger über Pointer Events) ──
  host.addEventListener('pointerdown', e => {
    if (!kanbanProcess() || e.button !== 0) return;
    if (e.target.closest('button:not([data-cgrip]), select, input')) return;
    const grip = e.target.closest('[data-cgrip]');
    const card = e.target.closest('[data-pcard]');
    if (readOnly || (!grip && !card)) return;
    if (grip) kpDrag = { kind: 'col', id: grip.dataset.cgrip, el: grip.closest('.kpcol'), sx: e.clientX, sy: e.clientY, pid: e.pointerId };
    else kpDrag = { kind: 'card', id: card.dataset.pcard, el: card, sx: e.clientX, sy: e.clientY, pid: e.pointerId };
  });
  window.addEventListener('pointermove', e => {
    if (!kpDrag || e.pointerId !== kpDrag.pid) return;
    if (!kpDrag.ghost) {
      if (Math.hypot(e.clientX - kpDrag.sx, e.clientY - kpDrag.sy) < 8) return;
      const r = kpDrag.el.getBoundingClientRect();
      const g = kpDrag.el.cloneNode(true);
      g.classList.add('kghost');
      g.removeAttribute('data-colid'); g.removeAttribute('data-pcard');
      g.style.width = r.width + 'px';
      if (kpDrag.kind === 'col') g.style.maxHeight = '240px';
      document.body.appendChild(g);
      kpDrag.ghost = g; kpDrag.ox = e.clientX - r.left; kpDrag.oy = e.clientY - r.top;
      kpDrag.el.classList.add('dragging');
    }
    kpDrag.ghost.style.left = (e.clientX - kpDrag.ox) + 'px';
    kpDrag.ghost.style.top = (e.clientY - kpDrag.oy) + 'px';
    // am Rand des Boards mitscrollen, damit auch verdeckte Spalten erreichbar sind
    const board = host.querySelector('.kboard.kp');
    if (board) {
      const br = board.getBoundingClientRect();
      if (e.clientX > br.right - 48) board.scrollLeft += 14;
      else if (e.clientX < br.left + 48) board.scrollLeft -= 14;
    }
    const col = colAt(e.clientX, e.clientY);
    document.querySelectorAll('.kpcol').forEach(x => x.classList.toggle('over', x === col));
    e.preventDefault();
  });
  const end = e => {
    if (!kpDrag || e.pointerId !== kpDrag.pid) return;
    const d = kpDrag; kpDrag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    d.el.classList.remove('dragging');
    document.querySelectorAll('.kpcol').forEach(x => x.classList.remove('over'));
    kpSuppressClick = true;
    setTimeout(() => { kpSuppressClick = false; }, 0);
    if (e.type === 'pointercancel') return;
    const col = colAt(e.clientX, e.clientY);
    if (!col) return;
    if (d.kind === 'card') kpMoveCard(d.id, col.dataset.colid);
    else {
      // Spalte vor bzw. hinter die Zielspalte setzen
      const list = boardColumns().map(c => c.id).filter(x => x !== d.id);
      const r = col.getBoundingClientRect();
      let pos = list.indexOf(col.dataset.colid);
      if (pos < 0) return;
      if (e.clientX > r.left + r.width / 2) pos++;
      moveColumn(d.id, pos);
    }
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function colAt(x, y) {
  return document.elementsFromPoint(x, y).find(el => el.classList && el.classList.contains('kpcol') && el.dataset.colid) || null;
}

/** Tastatur: zur Nachbarkarte (↑/↓) oder in die Nachbarspalte (←/→) springen. */
function focusNeighbour(card, key) {
  const col = card.closest('.kpcol');
  const list = [...col.querySelectorAll('[data-pcard]')];
  const i = list.indexOf(card);
  if (key === 'ArrowUp' && list[i - 1]) { list[i - 1].focus(); return; }
  if (key === 'ArrowDown' && list[i + 1]) { list[i + 1].focus(); return; }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    let other = key === 'ArrowLeft' ? col.previousElementSibling : col.nextElementSibling;
    while (other && !other.querySelector('[data-pcard]')) other = key === 'ArrowLeft' ? other.previousElementSibling : other.nextElementSibling;
    if (!other) return;
    const ol = [...other.querySelectorAll('[data-pcard]')];
    (ol[Math.min(i, ol.length - 1)] || ol[0]).focus();
  }
}

function kanbanAction(act, el) {
  switch (act) {
    case 'compact':
      kpCompact = !kpCompact;
      try { localStorage.setItem('mm-kanban-compact', kpCompact ? '1' : '0'); } catch (e) { /* egal */ }
      renderKanbanProcess();
      break;
    case 'tags-clear': kpFilter.tags = []; renderKanbanProcess(); break;
    case 'add-col': {
      const id = addColumn('Neue Spalte', 'todo');
      if (id) openKDialog({ kind: 'col', id });
      break;
    }
    case 'col-settings': openKDialog({ kind: 'col', id: el.dataset.col }); break;
    case 'add-card': addCardPrompt(el.dataset.col); break;
    case 'card-menu': openCardMenu(el.dataset.card, el); break;
    case 'log': openKDialog({ kind: 'log' }); break;
    case 'members': openKDialog({ kind: 'members' }); break;
    case 'privacy': openKDialog({ kind: 'privacy' }); break;
    case 'templates': openKDialog({ kind: 'templates' }); break;
  }
}

/**
 * Verschieben aus der Oberfläche: Hat die Zielspalte eine Definition of Done,
 * erscheint zuerst der Bestätigungsdialog (abbrechbar, kein hartes Sperren).
 */
function kpMoveCard(id, colId) {
  if (needsDod(id, colId)) { openKDialog({ kind: 'dod', id, col: colId }); return; }
  moveCard(id, colId);
}

/** Neue Karte: Ast = Filter, sonst markierter Ast, sonst Zentralthema. Aktive Tags werden übernommen. */
function addCardPrompt(colId) {
  const p = primary();
  const parent = kpFilter.branch || (p && doc.nodes[p] && !isTask(p) ? p : index().rid);
  const col = doc.columns[colId];
  if (!col) return;
  showPrompt('Neue Karte', `Karte in „${col.title}“ – als Aufgabe unter „${label(parent)}“${kpFilter.tags.length ? ` mit ${kpFilter.tags.map(t => '#' + t).join(' ')}` : ''}`, '', v => {
    if (!v || !v.trim()) return;
    const id = createCard(colId, v, parent, kpFilter.tags);
    if (id) { selectOne(id); const el = document.querySelector(`[data-pcard="${CSS.escape(id)}"]`); if (el) el.focus(); }
  });
}

function openCardMenu(id, anchor) {
  const n = doc.nodes[id];
  if (!n) return;
  const r = anchor.getBoundingClientRect();
  const cur = columnFor(n);
  const items = [
    { label: 'Karte öffnen', act: () => openCard(id), safe: true },
    { head: 'Verschieben nach' },
    ...boardColumns().map(c => ({ label: (cur && cur.id === c.id ? '✓ ' : '') + c.title, disabled: cur && cur.id === c.id, act: () => kpMoveCard(id, c.id) })),
    { sep: true },
    manualBlocked(n) ? { label: 'Blocker lösen', act: () => setBlocked(id, false) }
      : { label: 'Als blockiert markieren …', act: () => showPrompt('Blockiert', 'Woran hängt es? (kurze Begründung)', '', v => { if (v !== null) setBlocked(id, true, v); }) },
    { label: 'In der Mindmap zeigen', act: () => { selectOne(id); switchView('map'); setTimeout(() => ensureVisible(id), 40); }, safe: true },
    { label: 'Karte löschen', danger: true, act: () => deleteCard(id) },
  ];
  showMenu(r.left, r.bottom + 4, items);
}

function deleteCard(id) {
  if (!doc.nodes[id]) return;
  const sub = descendants(id).length;
  if (sub && !confirm(`„${label(id)}“ hat ${sub} Unterpunkt(e). Alles löschen?`)) return;
  mutate('Karte löschen', () => deleteSubtree(id));
  if (kpCardId === id) closeCard();
}

// ════════════════════════════════════════════════════════════════════
// Karteneditor (Dialog)
// ════════════════════════════════════════════════════════════════════
function openCard(id) {
  if (!doc.nodes[id]) return;
  kpCardId = id;
  kpPreview = readOnly;
  if (!sel.has(id) || sel.size > 1) { sel = new Set([id]); focusId = id; selLink = null; updateInspector(); syncOtherViewsSelection(); }
  renderCard();
  $('card-modal').style.display = 'flex';
  const t = $('card-box').querySelector('[data-cf="text"]');
  if (t && !readOnly) t.focus();
}
function closeCard() {
  flushAudit();
  const id = kpCardId;
  kpCardId = null;
  const m = $('card-modal');
  if (m) m.style.display = 'none';
  const el = id && document.querySelector(`[data-pcard="${CSS.escape(id)}"]`);
  if (el) el.focus();
}

function renderCard() {
  const box = $('card-box');
  const id = kpCardId;
  const n = id && doc.nodes[id];
  if (!box || !n) { closeCard(); return; }
  const ro = readOnly ? ' disabled' : '';
  const cur = columnFor(n);
  const owners = ownersOf(n);
  const members = [...new Set([...boardMembers(), ...owners])].sort((a, b) => a.localeCompare(b, 'de'));
  const tags = tagsOf(n);
  const cl = checklistOf(id);
  const blockers = blockersOf(id);
  const pm = M().planMode === 'project';
  const seg = (name, list, val) => `<div class="seg" data-cseg="${name}" role="group">${list.map(o => `<button type="button" data-val="${esc(o.key)}" class="${String(o.key) === String(val) ? 'on' : ''}" aria-pressed="${String(o.key) === String(val)}" title="${esc(o.title || o.label)}"${ro}>${o.dot ? `<i style="background:${o.dot}"></i>` : ''}${esc(o.label)}</button>`).join('')}</div>`;
  box.innerHTML = `
    <div class="modal-head"><h2 id="card-title">Karte</h2><button type="button" class="x" data-cd="close" aria-label="Schließen">✕</button></div>
    <div class="kp-dlg-path">${esc(pathText(id) || 'Hauptast')}</div>
    ${field('Titel', `<input data-cf="text" value="${esc(n.text || '')}" aria-label="Titel"${ro}>`)}
    <div class="kp-grid">
      ${field('Spalte', `<select data-cf="column" aria-label="Spalte"${ro}>${boardColumns().map(c => `<option value="${esc(c.id)}"${cur && cur.id === c.id ? ' selected' : ''}>${esc(c.title)}</option>`).join('')}</select>`)}
      ${field('Fällig', `<input type="date" data-cf="due" value="${esc(n.due || '')}" aria-label="Fällig"${ro}>`)}
      ${pm ? field('Start', `<input type="date" data-cf="start" value="${esc(n.start || '')}" aria-label="Start"${ro}>`) : ''}
    </div>
    <div class="kp-grid">
      ${field('Aufwand', seg('estimate', [{ key: '', label: '—', title: 'kein Aufwand' }, ...ESTIMATES], n.estimate || ''))}
      ${field('Priorität', seg('prio', PRIOS.map(p => ({ key: p.key, label: p.key ? p.label : '—', dot: p.key ? T().prio[p.key] : null })), n.prio || 0))}
    </div>
    ${field('Zuständige', `<div class="kp-chips" role="group" aria-label="Zuständige">${members.map(m => `<button type="button" class="kp-person${owners.includes(m) ? ' on' : ''}" data-cowner="${esc(m)}" aria-pressed="${owners.includes(m)}"${ro}>${owners.includes(m) ? '✓ ' : ''}${esc(m)}</button>`).join('')}
      ${readOnly ? '' : '<button type="button" class="btn-small" data-cd="add-member">+ Person</button>'}</div>`)}
    ${field('Tags', `<div class="kp-chips">${tags.map(t => `<span class="kp-tag">#${esc(t)}${readOnly ? '' : `<button type="button" data-ctag-del="${esc(t)}" aria-label="Tag ${esc(t)} entfernen">×</button>`}</span>`).join('')}
      ${readOnly ? '' : `<input class="kp-taginput" data-cf="tag-new" list="kp-taglist" placeholder="Tag + Enter" aria-label="Neuer Tag"><datalist id="kp-taglist">${knownTags().filter(t => !tags.includes(t)).map(t => `<option value="${esc(t)}">`).join('')}</datalist>`}</div>`)}
    ${field('Farbe', `<div class="swatches" role="group" aria-label="Farbe"><button type="button" data-ccolor="" title="automatisch (Astfarbe)" aria-label="automatisch"${ro}>—</button>${NODE_COLORS.map((c, i) => `<button type="button" data-ccolor="${c}" class="${n.color === c ? 'on' : ''}" style="background:${colorValue(c)}" aria-label="Farbe ${i + 1}" aria-pressed="${n.color === c}"${ro}></button>`).join('')}</div>`)}
    <div class="insp-field"><label>Inhalt <span class="kp-hint">(Markdown: **fett**, *kursiv*, - Liste, [Link](https://…))</span></label>
      <div class="seg small" role="group" aria-label="Inhalt"><button type="button" data-cd="edit" class="${kpPreview ? '' : 'on'}"${ro}>Bearbeiten</button><button type="button" data-cd="preview" class="${kpPreview ? 'on' : ''}">Vorschau</button></div>
      ${kpPreview ? `<div class="kp-note md full">${renderMarkdown(n.note || '') || '<p class="kp-hint">kein Inhalt</p>'}</div>`
        : `<textarea data-cf="note" rows="5" aria-label="Inhalt (Markdown)" placeholder="Was ist zu tun? Worauf achten?"${ro}>${esc(n.note || '')}</textarea>`}</div>
    <div class="insp-field"><label>Checkliste (Unterpunkte in der Mindmap) ${cl.all ? `– ${cl.done} von ${cl.all} erledigt` : ''}</label>
      ${cl.all ? `<div class="insp-progress"><span><i style="width:${Math.round(cl.done / cl.all * 100)}%"></i></span></div>` : ''}
      <ul class="kp-check">${kids(id).map(k => `<li><label><input type="checkbox" data-ccheck="${esc(k)}"${isTask(k) && statusOf(k) === 'done' ? ' checked' : ''}${ro}> <span>${esc(label(k))}</span></label></li>`).join('')}</ul>
      ${readOnly ? '' : '<input data-cf="check-new" placeholder="+ Unterpunkt, Enter" aria-label="Neuer Unterpunkt">'}</div>
    <div class="insp-field"><label>Blocker</label>
      ${blockers.length ? `<p class="kp-block">⛔ wartet auf ${blockers.map(d => `„${esc(label(d))}“`).join(', ')} (noch nicht erledigt)</p>` : ''}
      <div class="insp-row"><label class="switch"><input type="checkbox" data-cf="blocked"${manualBlocked(n) ? ' checked' : ''} aria-label="Manuell als blockiert markieren"${ro}><i></i></label>
        <span>${manualBlocked(n) ? 'blockiert' : 'nicht blockiert'}</span>
        ${manualBlocked(n) ? `<input data-cf="reason" value="${esc(n.blocked.reason || '')}" placeholder="Woran hängt es?" aria-label="Begründung"${ro}>` : ''}</div></div>
    <div class="modal-buttons">
      <button type="button" class="btn-secondary" data-cd="map">In der Mindmap zeigen</button>
      ${readOnly ? '' : '<button type="button" class="btn-secondary danger" data-cd="delete">Löschen</button>'}
      <button type="button" class="btn-primary" data-cd="close">Fertig</button>
    </div>`;
}

/** Nach jeder Änderung: offenen Editor auffrischen, ohne das Feld mit dem Cursor zu stören. */
function refreshCardDialog() {
  if (!kpCardId) return;
  if (!doc.nodes[kpCardId]) { closeCard(); return; }
  const box = $('card-box');
  const act = document.activeElement;
  if (box && box.contains(act) && (act.tagName === 'TEXTAREA' || (act.tagName === 'INPUT' && act.type !== 'checkbox'))) {
    // Nur die übrigen Felder angleichen
    box.querySelectorAll('[data-cf="text"], [data-cf="note"], [data-cf="reason"]').forEach(el => {
      if (el === act) return;
      const n = doc.nodes[kpCardId];
      el.value = el.dataset.cf === 'reason' ? ((n.blocked && n.blocked.reason) || '') : (n[el.dataset.cf] || '');
    });
    return;
  }
  const focusKey = act && box && box.contains(act) ? [...box.querySelectorAll('button, input, select, textarea')].indexOf(act) : -1;
  renderCard();
  if (focusKey >= 0) { const el = box.querySelectorAll('button, input, select, textarea')[focusKey]; if (el) el.focus(); }
}

function bindCardDialog() {
  const modal = $('card-modal'), box = $('card-box');
  if (!modal || !box) return;
  const nodeSet = (labelText, fn, merge) => {
    const id = kpCardId;
    if (!id || !doc.nodes[id]) return;
    mutate(labelText, () => fn(doc.nodes[id]), merge ? { merge: 'card:' + id + ':' + merge } : undefined);
  };
  box.addEventListener('input', e => {
    const f = e.target.dataset.cf;
    if (f === 'text') nodeSet('Titel', n => { n.text = e.target.value; }, 'text');
    else if (f === 'note') nodeSet('Inhalt', n => { if (e.target.value.trim()) n.note = e.target.value; else delete n.note; }, 'note');
    else if (f === 'reason') nodeSet('Begründung', n => { if (n.blocked) n.blocked.reason = e.target.value.slice(0, 200); }, 'reason');
  });
  box.addEventListener('change', e => {
    const f = e.target.dataset.cf, id = kpCardId;
    if (!id) return;
    if (f === 'column') kpMoveCard(id, e.target.value);
    else if (f === 'due' || f === 'start') nodeSet('Termin', n => { if (e.target.value) n[f] = e.target.value; else delete n[f]; if (n.ms && n.due) n.start = n.due; });
    else if (f === 'blocked') {
      if (e.target.checked) setBlocked(id, true, '');
      else setBlocked(id, false);
    }
    const ch = e.target.dataset.ccheck;
    if (ch) {
      const on = e.target.checked;
      mutate(on ? 'Unterpunkt erledigt' : 'Unterpunkt offen', () => { const k = doc.nodes[ch]; k.task = true; k.status = on ? 'done' : 'todo'; });
    }
  });
  box.addEventListener('keydown', e => {
    const f = e.target.dataset.cf;
    if (e.key !== 'Enter' || e.isComposing) return;
    // Nach dem Hinzufügen neu zeichnen und im selben Feld weiterschreiben lassen
    const again = name => { renderCard(); const el = box.querySelector(`[data-cf="${name}"]`); if (el) el.focus(); };
    if (f === 'tag-new') {
      e.preventDefault();
      const t = cleanTag(e.target.value);
      if (t) nodeSet('Tag', n => { n.tags = [...new Set([...tagsOf(n), t])]; });
      again('tag-new');
    } else if (f === 'check-new') {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) { const id = kpCardId; mutate('Unterpunkt', () => { createChild(id, v, null, { task: true, status: 'todo' }); }); }
      again('check-new');
    } else if (f === 'text') { e.preventDefault(); closeCard(); }
  });
  box.addEventListener('click', e => {
    const id = kpCardId;
    if (!id) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cowner != null) {
      const m = b.dataset.cowner;
      nodeSet('Zuständig', n => { const o = ownersOf(n); setOwners(n, o.includes(m) ? o.filter(x => x !== m) : [...o, m]); });
      return;
    }
    if (b.dataset.ctagDel != null) { const t = b.dataset.ctagDel; nodeSet('Tag entfernen', n => { n.tags = tagsOf(n).filter(x => x !== t); if (!n.tags.length) delete n.tags; }); return; }
    if (b.dataset.ccolor != null) { const c = b.dataset.ccolor; nodeSet('Farbe', n => { if (c) n.color = c; else delete n.color; }); return; }
    const seg = b.closest('[data-cseg]');
    if (seg) {
      const v = b.dataset.val;
      if (seg.dataset.cseg === 'estimate') nodeSet('Aufwand', n => { if (v) n.estimate = v; else delete n.estimate; });
      if (seg.dataset.cseg === 'prio') nodeSet('Priorität', n => { if (Number(v)) n.prio = Number(v); else delete n.prio; });
      return;
    }
    switch (b.dataset.cd) {
      case 'close': closeCard(); break;
      case 'delete': deleteCard(id); break;
      case 'map': closeCard(); selectOne(id); switchView('map'); setTimeout(() => ensureVisible(id), 40); break;
      case 'edit': kpPreview = false; renderCard(); break;
      case 'preview': kpPreview = true; renderCard(); break;
      case 'add-member': askNewMember(name => { if (name) nodeSet('Zuständig', n => { setOwners(n, [...ownersOf(n), name]); }); }); break;
    }
  });
  modal.addEventListener('click', e => { if (e.target === modal) closeCard(); });
}

function askNewMember(cb) {
  showPrompt('Neue Person', 'Kürzel oder Spitzname genügt (bitte keine vollständigen Namen, keine E-Mail):', '', v => {
    const name = cleanName(v);
    if (!name) { cb(null); return; }
    mutate('Mitglied', () => { ensureMember(name); });
    cb(name);
  });
}

// ════════════════════════════════════════════════════════════════════
// Weitere Dialoge: Spalte, Protokoll, Mitglieder, Datenschutz, Hinweis
// ════════════════════════════════════════════════════════════════════
function openKDialog(d) {
  kpDialog = d;
  renderKDialog();
  $('kanban-modal').style.display = 'flex';
  const el = $('kanban-box').querySelector('input, select, textarea, button.btn-primary');
  if (el) el.focus();
}
function closeKDialog() {
  flushAudit();
  kpDialog = null;
  const m = $('kanban-modal');
  if (m) m.style.display = 'none';
  if (kpCardId) refreshCardDialog();     // z. B. abgebrochene DoD: Spaltenauswahl im Editor zurücksetzen
}

function renderKDialog() {
  const box = $('kanban-box');
  if (!box || !kpDialog) return;
  const d = kpDialog;
  const x = '<button type="button" class="x" data-kd="close" aria-label="Schließen">✕</button>';
  if (d.kind === 'col') {
    const c = doc.columns[d.id];
    if (!c) { closeKDialog(); return; }
    const cols = boardColumns();
    const i = cols.findIndex(k => k.id === c.id);
    const n = (boardCards().get(c.id) || []).length;
    box.innerHTML = `<div class="modal-head"><h2>Spalte einstellen</h2>${x}</div>
      ${field('Name', `<input data-kc="title" value="${esc(c.title)}">`)}
      ${field('Gehört zum Status', `<select data-kc="statusKey">${KANBAN_STATUS.map(s => `<option value="${s.key}"${c.statusKey === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <p class="kp-hint">Zeitplan, Gantt, Exporte und Prüfregeln sehen nur den Status. Beispiel: „Review“ gehört zu „In Arbeit“.</p>`)}
      ${field('WIP-Limit (höchstens so viele Karten gleichzeitig, 0 = kein Limit)', `<input type="number" min="0" max="99" data-kc="wip" value="${c.wip || 0}">`)}
      ${field('Definition of Done – wann darf eine Karte hierher? (ein Punkt pro Zeile)', `<textarea data-kc="dod" rows="3" placeholder="z. B. Funktion getestet&#10;In der Doku festgehalten">${esc((c.dod || []).join('\n'))}</textarea>
        <p class="kp-hint">Beim Verschieben in diese Spalte erscheinen die Punkte zum Abhaken. Es wird nichts gesperrt; das Protokoll hält fest, wie viele bestätigt wurden.</p>`)}
      ${field('Farbe', `<div class="swatches" role="group" aria-label="Farbe der Spalte"><button type="button" data-kccolor="" aria-label="keine Farbe" class="${c.color ? '' : 'on'}">—</button>${NODE_COLORS.map((k, j) => `<button type="button" data-kccolor="${k}" class="${c.color === k ? 'on' : ''}" style="background:${colorValue(k)}" aria-label="Farbe ${j + 1}"></button>`).join('')}</div>`)}
      ${field('Position', `<div class="insp-row"><button type="button" class="btn-small" data-kd="left"${i <= 0 ? ' disabled' : ''}>← nach links</button><button type="button" class="btn-small" data-kd="right"${i >= cols.length - 1 ? ' disabled' : ''}>nach rechts →</button></div>`)}
      <p class="kp-msg" role="alert"></p>
      <div class="modal-buttons"><button type="button" class="btn-secondary danger" data-kd="delete">Spalte löschen …</button><button type="button" class="btn-primary" data-kd="close">Fertig</button></div>`;
    return;
  }
  if (d.kind === 'dod') {
    const c = doc.columns[d.col], n = doc.nodes[d.id];
    if (!c || !n) { closeKDialog(); return; }
    box.innerHTML = `<div class="modal-head"><h2>Definition of Done: „${esc(c.title)}“</h2>${x}</div>
      <p class="modal-intro">Die Karte <b>„${esc(label(d.id))}“</b> soll nach „${esc(c.title)}“. Was davon ist erfüllt?</p>
      <ul class="kp-check kp-dod">${c.dod.map((t, i) => `<li><label><input type="checkbox" data-dodi="${i}"> <span>${esc(t)}</span></label></li>`).join('')}</ul>
      <p class="kp-hint">Kein Muss: Verschieben geht auch, wenn noch nicht alles erfüllt ist. Im Protokoll steht, wie viele Punkte bestätigt wurden.</p>
      <div class="modal-buttons"><button type="button" class="btn-secondary" data-kd="close">Abbrechen</button><button type="button" class="btn-primary" data-kd="dod-ok">Verschieben</button></div>`;
    return;
  }
  if (d.kind === 'templates') {
    const own = ownBoardTemplates();
    const item = (t, own) => `<label class="kp-tpl"><input type="radio" name="kp-tpl" value="${esc(t.key)}"> <span><b>${esc(t.title)}</b><small>${esc(t.desc || t.columns.map(c => c.title).join(' / '))}${t.milestones ? ` · ${t.milestones.length} Meilensteine` : ''}</small></span>
      ${own ? `<button type="button" class="kp-icon" data-tpldel="${esc(t.key)}" aria-label="Vorlage ${esc(t.title)} löschen" title="Vorlage löschen">×</button>` : ''}</label>`;
    box.innerHTML = `<div class="modal-head"><h2>Board-Vorlage</h2>${x}</div>
      <p class="modal-intro">Eine Vorlage ersetzt die Spalten (mit WIP-Limits und Definition of Done). Die Karten bleiben erhalten und kommen in die erste Spalte ihres Status.</p>
      <div class="kp-tpls" role="radiogroup" aria-label="Vorlagen">${BOARD_TEMPLATES.map(t => item(t, false)).join('')}
        ${own.length ? `<div class="ctx-head">Eigene Vorlagen (auf diesem Gerät)</div>${own.map(t => item(t, true)).join('')}` : ''}</div>
      <label class="kp-radio"><input type="checkbox" data-kv="milestones" checked> Meilensteine der Vorlage als Aufgaben ergänzen (ab dieser Woche)</label>
      <p class="kp-msg" role="alert"></p>
      <div class="modal-buttons"><button type="button" class="btn-secondary" data-kd="tpl-save">Aktuelles Board als Vorlage speichern …</button><button type="button" class="btn-primary" data-kd="tpl-apply">Übernehmen</button></div>`;
    return;
  }
  if (d.kind === 'delcol') {
    const c = doc.columns[d.id];
    if (!c) { closeKDialog(); return; }
    const n = (boardCards().get(c.id) || []).length;
    const others = boardColumns().filter(k => k.id !== c.id);
    box.innerHTML = `<div class="modal-head"><h2>Spalte „${esc(c.title)}“ löschen</h2>${x}</div>
      ${n ? `<p class="modal-intro">In der Spalte ${n === 1 ? 'steht eine Karte' : `stehen ${n} Karten`}. Wohin sollen ${n === 1 ? 'sie' : 'diese'}? Keine Karte geht verloren.</p>
        ${field('Zielspalte', `<select data-kc="target">${others.map(k => `<option value="${esc(k.id)}">${esc(k.title)} (${esc(statusLabel(k.statusKey))})</option>`).join('')}</select>`)}`
        : '<p class="modal-intro">Die Spalte ist leer.</p>'}
      <p class="kp-msg" role="alert"></p>
      <div class="modal-buttons"><button type="button" class="btn-secondary" data-kd="back">Abbrechen</button><button type="button" class="btn-primary" data-kd="delete-ok">Löschen</button></div>`;
    return;
  }
  if (d.kind === 'log') {
    const f = kpLogFilter;
    const list = auditList(f);
    const persons = [...new Set(Object.values(doc.events).map(e => e.who).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    const taskIds = [...new Set(Object.values(doc.events).map(e => e.task).filter(Boolean))];
    const taskName = t => doc.nodes[t] ? label(t) : (Object.values(doc.events).find(e => e.task === t && e.title) || {}).title || '(gelöscht)';
    box.innerHTML = `<div class="modal-head"><h2>Protokoll</h2>${x}</div>
      <p class="modal-intro">Wer hat wann was getan? Das Protokoll ist ein <b>Arbeitsnachweis, kein Beweis</b>: Es entsteht ohne Anmeldung und ist nicht fälschungssicher.${personal() ? '' : ' Es wird ohne Personen geführt.'}</p>
      <div class="kp-logfilter">
        <label>Person <select data-kl="who"><option value="">alle</option><option value="-"${f.who === '-' ? ' selected' : ''}>ohne Namen</option>${persons.map(p => `<option${f.who === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label>Karte <select data-kl="task"><option value="">alle</option>${taskIds.map(t => `<option value="${esc(t)}"${f.task === t ? ' selected' : ''}>${esc(taskName(t).slice(0, 40))}</option>`).join('')}</select></label>
        <label>von <input type="date" data-kl="from" value="${esc(f.from)}"></label>
        <label>bis <input type="date" data-kl="to" value="${esc(f.to)}"></label>
      </div>
      <p class="kp-hint">${list.length} Einträge</p>
      <div class="kp-logwrap"><table class="kp-log"><thead><tr><th>Zeit</th><th>Person</th><th>Was</th><th>Karte</th></tr></thead><tbody>
      ${list.slice().reverse().map(e => `<tr><td>${esc(new Date(e.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(e.who || '–')}</td><td>${esc(eventText(e))}</td><td>${esc(e.title || '')}</td></tr>`).join('') || '<tr><td colspan="4">Noch keine Einträge.</td></tr>'}
      </tbody></table></div>
      <div class="modal-buttons"><button type="button" class="btn-primary" data-kd="close">Schließen</button></div>`;
    return;
  }
  if (d.kind === 'members') {
    const list = boardMembers();
    box.innerHTML = `<div class="modal-head"><h2>Mitglieder</h2>${x}</div>
      <p class="modal-intro">Die Mitgliederliste entsteht aus den Zuständigen. <b>Kürzel oder Spitzname genügt</b> – bitte keine vollständigen Namen und keine E-Mail-Adressen.</p>
      <ul class="kp-members">${list.map(m => `<li><span class="chip owner">${esc(initials(m))}</span> ${esc(m)} <small>${treeOrder().filter(id => isTask(id) && ownersOf(id).includes(m)).length} Karten</small></li>`).join('') || '<li class="kp-hint">Noch niemand eingetragen.</li>'}</ul>
      ${readOnly ? '' : '<div class="insp-row"><input data-km="name" placeholder="Kürzel, z. B. AB" aria-label="Neues Mitglied"><button type="button" class="btn-small" data-kd="member-add">Hinzufügen</button></div>'}
      <div class="modal-buttons"><button type="button" class="btn-primary" data-kd="close">Fertig</button></div>`;
    return;
  }
  if (d.kind === 'privacy') {
    const inRoom = typeof collab !== 'undefined' && !!collab;
    const persons = allPersons();
    box.innerHTML = `<div class="modal-head"><h2>Datenschutz</h2>${x}</div>
      <p class="modal-intro">Im Prozess-Modus führt die App ein Protokoll: <b>wer</b> (Kürzel) <b>wann</b> welche Karte angelegt, verschoben oder geändert hat. Es steht in dieser Datei und ist für alle sichtbar, die die Datei oder die gemeinsame Sitzung öffnen. Die App ist datenschutzfreundlich konzipiert; ob und wie sie eingesetzt wird, entscheidet die Schule. Mehr in <b>DATENSCHUTZ.md</b>.</p>
      ${field('Zweck des Protokolls (trägt die Lehrkraft ein, wird mit der Datei weitergegeben)', `<textarea data-kv="purpose" rows="2" placeholder="z. B. Unterstützung der Reflexion und der Bewertung der Gruppenarbeit"${readOnly ? ' disabled' : ''}>${esc(M().kanbanPurpose || '')}</textarea>`)}
      <div class="insp-field"><div class="insp-row"><label class="switch"><input type="checkbox" data-kv="personal"${personal() ? ' checked' : ''}${readOnly ? ' disabled' : ''}><i></i></label><span><b>Protokoll personenbezogen führen</b> – aus: Einträge nur mit Zeit und Art, ohne Person (keine Einzelbewertung möglich).</span></div></div>
      <div class="insp-section"><div class="insp-section-head"><span>Auskunft: alles zu einer Person</span></div>
        <div class="insp-row"><select data-kv="person">${persons.map(p => `<option>${esc(p)}</option>`).join('') || '<option value="">(niemand)</option>'}</select><button type="button" class="btn-small" data-kd="person-export"${persons.length ? '' : ' disabled'}>Als JSON exportieren</button></div></div>
      <div class="insp-section"><div class="insp-section-head"><span>Projekt abschließen</span></div>
        <label class="kp-radio"><input type="radio" name="kp-close" value="keep" checked> Protokoll behalten</label>
        <label class="kp-radio"><input type="radio" name="kp-close" value="anon"> anonymisieren (Personen werden zu „Person 1, 2 …“, auch bei den Zuständigen)</label>
        <label class="kp-radio"><input type="radio" name="kp-close" value="delete"> Protokoll löschen</label>
        ${inRoom ? '<p class="kp-hint">Während einer gemeinsamen Sitzung nicht möglich – bitte zuerst die Sitzung verlassen.</p>' : ''}
        <button type="button" class="btn-small" data-kd="close-project"${inRoom || readOnly ? ' disabled' : ''}>Ausführen</button></div>
      <div class="insp-section"><div class="insp-section-head"><span>Dieses Gerät</span></div>
        <p class="kp-hint">Der Browser speichert nur das zuletzt geöffnete Dokument und Einstellungen (keine Cookies).</p>
        <button type="button" class="btn-small danger" data-kd="clear-local">Alle lokalen Daten dieser App löschen</button></div>
      <p class="kp-msg" role="alert"></p>
      <div class="modal-buttons"><button type="button" class="btn-primary" data-kd="close">Fertig</button></div>`;
    return;
  }
  if (d.kind === 'notice') {
    const purpose = (M().kanbanPurpose || '').trim();
    box.innerHTML = `<div class="modal-head"><h2>Hinweis: Protokoll</h2></div>
      <p class="modal-intro">In diesem Board wird ${personal() ? '<b>mit Kürzel</b> festgehalten, wer' : 'ohne Personen festgehalten,'} wann Karten anlegt, verschiebt oder ändert. Das Protokoll gehört zur Datei und ist für alle sichtbar, die die Datei oder die gemeinsame Sitzung öffnen.</p>
      <p class="modal-intro"><b>Zweck:</b> ${purpose ? esc(purpose) : 'noch nicht eingetragen – bitte bei der Lehrkraft nachfragen (Knopf „Datenschutz“).'}</p>
      <p class="modal-intro">Das Protokoll ist ein <b>Arbeitsnachweis, kein Beweis</b>. Als Name genügt ein Kürzel.</p>
      <div class="modal-buttons"><button type="button" class="btn-primary" data-kd="notice-ok">Verstanden</button></div>`;
  }
}

function bindKDialog() {
  const modal = $('kanban-modal'), box = $('kanban-box');
  if (!modal || !box) return;
  const msg = t => { const el = box.querySelector('.kp-msg'); if (el) el.textContent = t || ''; else if (t) showModal('Kanban', t); };
  box.addEventListener('input', e => {
    const d = kpDialog;
    if (!d) return;
    if (d.kind === 'col' && e.target.dataset.kc === 'title') msg(updateColumn(d.id, { title: e.target.value.slice(0, 40) || 'Spalte' }, 'title'));
    if (d.kind === 'col' && e.target.dataset.kc === 'dod') {
      const list = e.target.value.split('\n').map(t => t.trim().slice(0, 120)).filter(Boolean).slice(0, 12);
      msg(updateColumn(d.id, { dod: list.length ? list : null }, 'dod'));
    }
    if (d.kind === 'privacy' && e.target.dataset.kv === 'purpose') mutate('Zweck', () => { M().kanbanPurpose = e.target.value.slice(0, 300); if (!M().kanbanPurpose) delete M().kanbanPurpose; }, { merge: 'purpose' });
  });
  box.addEventListener('change', e => {
    const d = kpDialog;
    if (!d) return;
    if (d.kind === 'col' && e.target.dataset.kc === 'statusKey') { msg(updateColumn(d.id, { statusKey: e.target.value })); renderKDialog(); }
    if (d.kind === 'col' && e.target.dataset.kc === 'wip') msg(updateColumn(d.id, { wip: Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0)) }));
    if (d.kind === 'privacy' && e.target.dataset.kv === 'personal') { const on = e.target.checked; mutate('Protokoll personenbezogen', () => { if (on) delete M().kanbanPersonal; else M().kanbanPersonal = false; }); }
    if (d.kind === 'log' && e.target.dataset.kl) { kpLogFilter[e.target.dataset.kl] = e.target.value; renderKDialog(); }
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.km === 'name') { e.preventDefault(); box.querySelector('[data-kd="member-add"]').click(); }
  });
  box.addEventListener('click', e => {
    const d = kpDialog;
    if (!d) return;
    const del = e.target.closest('[data-tpldel]');
    if (del && d.kind === 'templates') {
      e.preventDefault();
      if (confirm('Diese eigene Vorlage löschen?')) { saveOwnBoardTemplates(ownBoardTemplates().filter(t => t.key !== del.dataset.tpldel)); renderKDialog(); }
      return;
    }
    const cc = e.target.closest('[data-kccolor]');
    if (cc && d.kind === 'col') { msg(updateColumn(d.id, { color: cc.dataset.kccolor || null })); renderKDialog(); return; }
    const b = e.target.closest('[data-kd]');
    if (!b) return;
    const i = d.id ? boardColumns().findIndex(k => k.id === d.id) : -1;
    switch (b.dataset.kd) {
      case 'close': closeKDialog(); break;
      case 'left': moveColumn(d.id, i - 1); renderKDialog(); break;
      case 'right': moveColumn(d.id, i + 1); renderKDialog(); break;
      case 'delete': kpDialog = { kind: 'delcol', id: d.id }; renderKDialog(); break;
      case 'back': kpDialog = { kind: 'col', id: d.id }; renderKDialog(); break;
      case 'delete-ok': {
        const t = box.querySelector('[data-kc="target"]');
        const err = deleteColumn(d.id, t ? t.value : null);
        if (err) msg(err); else closeKDialog();
        break;
      }
      case 'member-add': {
        const inp = box.querySelector('[data-km="name"]');
        const name = cleanName(inp && inp.value);
        if (name) { mutate('Mitglied', () => { ensureMember(name); }); renderKDialog(); }
        break;
      }
      case 'person-export': {
        const p = box.querySelector('[data-kv="person"]').value;
        if (p) deliverFile(JSON.stringify(personExport(p), null, 1), baseName() + '_auskunft_' + p.replace(/[^\wäöüÄÖÜß-]+/g, '_') + '.json', 'application/json');
        break;
      }
      case 'close-project': {
        const how = (box.querySelector('input[name="kp-close"]:checked') || {}).value || 'keep';
        if (how === 'keep') { msg('Das Protokoll bleibt erhalten.'); break; }
        if (!confirm(how === 'delete' ? 'Das Protokoll wird endgültig gelöscht (nicht rückgängig zu machen). Fortfahren?' : 'Alle Personen werden durch „Person 1, 2 …“ ersetzt (nicht rückgängig zu machen). Fortfahren?')) break;
        const err = closeProject(how);
        msg(err || (how === 'delete' ? 'Protokoll gelöscht. Jetzt speichern, damit es auch in der Datei fehlt.' : 'Anonymisiert. Jetzt speichern, damit es auch in der Datei gilt.'));
        if (!err) renderKDialog();
        break;
      }
      case 'clear-local':
        if (!confirm('Alle Daten dieser App in diesem Browser löschen (zuletzt geöffnete Mindmap, Name, Einstellungen)? Gespeicherte Dateien bleiben erhalten.')) break;
        clearLocalData();
        dirty = false;
        location.replace(location.pathname);
        break;
      case 'notice-ok': markNoticeSeen(); closeKDialog(); break;
      case 'dod-ok': {
        const total = box.querySelectorAll('[data-dodi]').length;
        const checked = box.querySelectorAll('[data-dodi]:checked').length;
        const { id, col } = d;
        closeKDialog();
        moveCard(id, col, { dod: { checked, total } });
        const el = document.querySelector(`[data-pcard="${CSS.escape(id)}"]`);
        if (el && !kpCardId) el.focus();
        break;
      }
      case 'tpl-apply': {
        const sel = box.querySelector('input[name="kp-tpl"]:checked');
        if (!sel) { msg('Bitte eine Vorlage wählen.'); break; }
        if (boardColumns().length && !confirm('Die bisherigen Spalten werden ersetzt. Karten gehen nicht verloren. Fortfahren?')) break;
        const ms = box.querySelector('[data-kv="milestones"]');
        applyBoardTemplate(sel.value, !!(ms && ms.checked));
        closeKDialog();
        break;
      }
      case 'tpl-save':
        showPrompt('Board als Vorlage speichern', 'Name der Vorlage (sie wird in diesem Browser gespeichert):', M().title || 'Meine Vorlage', v => {
          if (!v || !v.trim()) return;
          const ok = saveOwnBoardTemplates(ownBoardTemplates().concat([boardFromCurrent(v.trim())]));
          if (kpDialog && kpDialog.kind === 'templates') { renderKDialog(); msg(ok ? 'Vorlage gespeichert.' : 'Speichern im Browser nicht möglich.'); }
        });
        break;
    }
  });
  modal.addEventListener('click', e => { if (e.target === modal && kpDialog && kpDialog.kind !== 'notice') closeKDialog(); });
}

// ── Hinweis beim ersten Öffnen im Prozess-Modus (je Gerät und Board) ─
function noticeKey() { return M().kanbanId || 'x'; }
function noticeSeen() {
  try { return (JSON.parse(localStorage.getItem('mm-kanban-notice') || '[]') || []).includes(noticeKey()); } catch (e) { return false; }
}
function markNoticeSeen() {
  try {
    const list = JSON.parse(localStorage.getItem('mm-kanban-notice') || '[]') || [];
    if (!list.includes(noticeKey())) list.push(noticeKey());
    localStorage.setItem('mm-kanban-notice', JSON.stringify(list.slice(-50)));
  } catch (e) { /* egal */ }
}
function maybeShowNotice() {
  if (!kanbanProcess() || currentView !== 'kanban' || noticeSeen() || kpDialog) return;
  if (typeof topModal === 'function' && topModal()) return;
  openKDialog({ kind: 'notice' });
}

// Offene Dialoge bei Änderungen (auch von anderen) auffrischen
onChange(() => {
  if (kpCardId) refreshCardDialog();
  if (kpDialog && $('kanban-modal') && $('kanban-modal').style.display === 'flex') {
    const box = $('kanban-box');
    const act = document.activeElement;
    if (!(box && box.contains(act) && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA' || act.tagName === 'SELECT'))) renderKDialog();
  }
});
