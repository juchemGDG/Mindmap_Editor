'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – weitere Ansichten derselben Daten:
//   Gliederung (Outline), Kanban, Zeitplan (Liste bzw. Gantt)
// ════════════════════════════════════════════════════════════════════

let currentView = 'map';
const VIEWS = ['map', 'outline', 'kanban', 'timeline'];

function switchView(v) {
  if (!VIEWS.includes(v)) v = 'map';
  if (editing) commitEdit();
  currentView = v;
  document.body.dataset.view = v;
  document.querySelectorAll('[data-view-tab]').forEach(b => b.classList.toggle('on', b.dataset.viewTab === v));
  for (const k of VIEWS) {
    const el = $(k === 'map' ? 'canvas-container' : k + '-view');
    if (el) el.style.display = k === v ? '' : 'none';
  }
  try { localStorage.setItem('mm-view', v); } catch (e) { /* egal */ }
  if (v === 'map') { resizeCanvas(); requestRender(true); }
  else renderCurrentView();
}

function renderCurrentView() {
  if (currentView === 'outline') renderOutline();
  else if (currentView === 'kanban') renderKanban();
  else if (currentView === 'timeline') renderTimeline();
}

function syncOtherViewsSelection() {
  if (currentView === 'map') return;
  document.querySelectorAll('[data-sel-id]').forEach(el => el.classList.toggle('selected', sel.has(el.dataset.selId)));
}

function chipsHtml(id, opts) {
  const n = doc.nodes[id];
  const t = T();
  let h = '';
  if (n.task && n.owner) h += `<span class="chip owner" title="${esc(n.owner)}">${esc(initials(n.owner))}</span>`;
  if (n.task && n.due && (!opts || !opts.noDue)) {
    const over = n.due < todayISO() && n.status !== 'done';
    h += `<span class="chip${over ? ' over' : ''}">${n.start && M().planMode === 'project' && n.start !== n.due ? fmtShort(n.start) + '–' : ''}${fmtShort(n.due)}</span>`;
  }
  if (n.prio) h += `<span class="chip"><i class="dot" style="background:${t.prio[n.prio]}"></i>${PRIOS[n.prio].label}</span>`;
  const v = votesOf(id);
  if (v) h += `<span class="chip votes"><i class="dot" style="background:${t.accent}"></i>${v}</span>`;
  return h;
}

function statusBox(id) {
  const s = statusOf(id);
  return `<button type="button" class="sbox ${s}" data-status-btn="${esc(id)}" title="${STATUS.find(x => x.key === s).label} – klicken zum Weiterschalten"></button>`;
}

// ════════════════════════════════════════════════════════════════════
// Gliederung
// ════════════════════════════════════════════════════════════════════
let olPendingFocus = null;   // {id, caret:'end'|number}
let olTimers = {};

function renderOutline() {
  const host = $('outline-view');
  if (!host || olBusy) return;
  // Fokus und Cursor merken
  const act = document.activeElement;
  let keep = null;
  if (act && act.classList && act.classList.contains('ol-text') && host.contains(act)) {
    keep = { id: act.dataset.id, caret: caretOffset(act), text: act.textContent };
  }
  if (olPendingFocus) keep = Object.assign({}, olPendingFocus, { text: null });
  olPendingFocus = null;

  const plan = phase() === 'plan';
  const rows = [];
  const walk = (id, d) => {
    const n = doc.nodes[id];
    const ch = kids(id);
    const caret = ch.length ? `<button type="button" class="ol-caret" data-toggle="${esc(id)}">${n.collapsed ? '▸' : '▾'}</button>` : '<span class="ol-bullet">•</span>';
    const text = keep && keep.id === id && keep.text != null ? keep.text : (n.text || '');
    const done = plan && n.task && n.status === 'done';
    rows.push(`<div class="ol-row d${Math.min(d, 3)}${sel.has(id) ? ' selected' : ''}${done ? ' done' : ''}" data-sel-id="${esc(id)}" style="padding-left:${12 + d * 24}px">
      ${caret}${plan && n.task ? statusBox(id) : ''}${n.icon ? `<span class="ol-icon">${esc(n.icon)}</span>` : ''}
      <div class="ol-text" data-id="${esc(id)}" contenteditable="${readOnly ? 'false' : 'true'}" spellcheck="true">${esc(text)}</div>
      <span class="ol-meta">${phase() !== 'collect' ? chipsHtml(id) : ''}${n.note ? '<span class="chip" title="Notiz">≡</span>' : ''}${n.collapsed ? `<span class="chip">+${descendants(id).length}</span>` : ''}</span>
    </div>`);
    if (!n.collapsed) for (const c of ch) walk(c, d + 1);
  };
  walk(index().rid, 0);
  host.innerHTML = `<div class="view-head"><h2>Gliederung</h2><p>Schreiben wie in einer Liste: <kbd>Enter</kbd> neuer Punkt · <kbd>Tab</kbd> einrücken · <kbd>Shift</kbd>+<kbd>Tab</kbd> ausrücken · <kbd>${IS_MAC ? '⌘' : 'Strg'}</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> verschieben</p></div>
    <div class="ol-list">${rows.join('')}</div>`;

  if (keep && keep.id) {
    const el = host.querySelector(`.ol-text[data-id="${CSS.escape(keep.id)}"]`);
    if (el) { el.focus({ preventScroll: false }); setCaret(el, keep.caret); }
  }
}

function caretOffset(el) {
  const s = window.getSelection();
  if (!s.rangeCount) return 'end';
  const r = s.getRangeAt(0);
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}
function setCaret(el, pos) {
  const s = window.getSelection();
  const r = document.createRange();
  const text = el.firstChild;
  if (!text || pos === 'end' || pos == null) { r.selectNodeContents(el); r.collapse(false); }
  else { r.setStart(text, Math.min(pos, text.length)); r.collapse(true); }
  s.removeAllRanges(); s.addRange(r);
}

function olCommit(id, el) {
  clearTimeout(olTimers[id]);
  if (!doc.nodes[id]) return;
  const v = el.textContent.replace(/ /g, ' ');
  if (v !== (doc.nodes[id].text || '')) mutate('Text ändern', () => { doc.nodes[id].text = v; }, { merge: 'ol:' + id });
}

function bindOutline() {
  const host = $('outline-view');
  if (!host) return;
  host.addEventListener('input', e => {
    const el = e.target.closest('.ol-text');
    if (!el) return;
    const id = el.dataset.id;
    clearTimeout(olTimers[id]);
    olTimers[id] = setTimeout(() => olCommit(id, el), 450);
  });
  host.addEventListener('focusout', e => {
    const el = e.target.closest && e.target.closest('.ol-text');
    if (el) olCommit(el.dataset.id, el);
  });
  host.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('.ol-text');
    if (el && !sel.has(el.dataset.id)) { sel = new Set([el.dataset.id]); focusId = el.dataset.id; selLink = null; updateInspector(); syncOtherViewsSelection(); updateCaptureTarget(); }
  });
  host.addEventListener('paste', e => {
    const el = e.target.closest('.ol-text');
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (text.includes('\n')) {
      olCommit(el.dataset.id, el);
      const data = parseIndentedText(text);
      if (!data) return;
      const id = el.dataset.id;
      let out = [];
      mutate('Einfügen', () => { out = insertSubtrees(data, isRoot(id) ? id : parentOf(id)); });
      return;
    }
    document.execCommand('insertText', false, text);
  });
  host.addEventListener('click', e => {
    const tg = e.target.closest('[data-toggle]');
    if (tg) { const id = tg.dataset.toggle; mutate('Ein-/Ausklappen', () => { if (doc.nodes[id].collapsed) delete doc.nodes[id].collapsed; else doc.nodes[id].collapsed = true; }); return; }
    const sb = e.target.closest('[data-status-btn]');
    if (sb) { cycleStatusSimple(sb.dataset.statusBtn); return; }
  });
  host.addEventListener('keydown', e => {
    const el = e.target.closest('.ol-text');
    if (!el || e.isComposing) return;
    const id = el.dataset.id;
    const mod = e.ctrlKey || e.metaKey;
    // Position und Text VOR jeder Änderung lesen – danach wird neu gezeichnet
    const pos = caretOffset(el);
    const txt = el.textContent;
    const go = (target, caret) => { olPendingFocus = { id: target, caret: caret == null ? 'end' : caret }; };
    const batch = fn => {
      olBusy = true;
      try { olCommit(id, el); fn(); } finally { olBusy = false; }
      renderOutline();
    };
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      batch(() => {
        let nid = null;
        if (pos === 0 && txt.length && !isRoot(id)) {
          // Cursor am Anfang: neuer Punkt davor
          mutate('Neuer Punkt', () => { nid = createSibling(id, '', true); });
          go(id, 0);
        } else {
          mutate('Neuer Punkt', () => { nid = isRoot(id) || (kids(id).length && !doc.nodes[id].collapsed) ? createChild(id, '', 0) : createSibling(id, ''); });
          go(nid, 0);
        }
      });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      batch(() => { go(id, pos); if (e.shiftKey) outdent(id); else indent(id); });
    } else if (e.key === 'Backspace' && !txt && !isRoot(id) && !kids(id).length) {
      e.preventDefault();
      const order = treeOrderVisible();
      const prev = order[order.indexOf(id) - 1];
      batch(() => { mutate('Punkt löschen', () => deleteSubtree(id)); if (prev) go(prev, 'end'); });
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && mod) {
      e.preventDefault();
      batch(() => { sel = new Set([id]); focusId = id; go(id, pos); moveSibling(e.key === 'ArrowUp' ? -1 : 1); });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const order = treeOrderVisible();
      const j = order.indexOf(id) + (e.key === 'ArrowUp' ? -1 : 1);
      if (j >= 0 && j < order.length) {
        e.preventDefault();
        batch(() => go(order[j], 'end'));
      }
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      batch(() => { go(id, pos); cycleStatusSimple(id, true); });
    } else if (e.key === 'Escape') {
      el.blur();
    }
  });
}
let olBusy = false;

function treeOrderVisible() {
  const out = [];
  const walk = id => { out.push(id); if (!doc.nodes[id].collapsed) for (const c of kids(id)) walk(c); };
  walk(index().rid);
  return out;
}

function cycleStatusSimple(id, makeTask) {
  mutate('Status', () => {
    const n = doc.nodes[id];
    if (!n.task) { if (makeTask !== false) { n.task = true; n.status = 'todo'; } return; }
    n.status = !n.status || n.status === 'todo' ? 'doing' : n.status === 'doing' ? 'done' : 'todo';
  });
}

// ════════════════════════════════════════════════════════════════════
// Kanban
// ════════════════════════════════════════════════════════════════════
let kanbanFilter = { branch: '', owner: '', ideas: true };
let kdrag = null;

function taskSort(a, b) {
  const na = doc.nodes[a], nb = doc.nodes[b];
  const pa = na.prio || 9, pb = nb.prio || 9;
  if (pa !== pb) return pa - pb;
  const da = na.due || '9999', db = nb.due || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return 0;
}

function renderKanban() {
  const host = $('kanban-view');
  if (!host) return;
  const order = treeOrder();
  const branches = kids(index().rid);
  const owners = knownOwners();
  const pass = id => {
    if (kanbanFilter.branch && branchOf(id) !== kanbanFilter.branch && id !== kanbanFilter.branch) return false;
    if (kanbanFilter.owner === '-') return !doc.nodes[id].owner;
    if (kanbanFilter.owner && (doc.nodes[id].owner || '') !== kanbanFilter.owner) return false;
    return true;
  };
  const tasks = order.filter(id => isTask(id) && pass(id));
  const cols = [];
  if (kanbanFilter.ideas) {
    const ideas = order.filter(id => !isRoot(id) && !isTask(id) && !kids(id).length && pass(id))
      .sort((a, b) => votesOf(b) - votesOf(a) || order.indexOf(a) - order.indexOf(b));
    cols.push({ key: 'idea', label: 'Ideen', hint: 'noch keine Aufgabe', items: ideas });
  }
  for (const s of STATUS) {
    const items = tasks.filter(id => statusOf(id) === s.key);
    items.sort((a, b) => taskSort(a, b) || order.indexOf(a) - order.indexOf(b));
    cols.push({ key: s.key, label: s.label, items });
  }
  const card = id => {
    const n = doc.nodes[id];
    const br = branchOf(id);
    const path = br && br !== id ? label(br) : '';
    const col = branchColor(id);
    return `<div class="kcard${sel.has(id) ? ' selected' : ''}" data-sel-id="${esc(id)}" data-card="${esc(id)}" style="--bc:${col}">
      ${path ? `<div class="kpath">${esc(path)}${parentOf(id) !== br && parentOf(id) ? ' › ' + esc(label(parentOf(id))) : ''}</div>` : ''}
      <div class="ktext">${n.icon ? esc(n.icon) + ' ' : ''}${esc(label(id))}</div>
      <div class="kmeta">${chipsHtml(id)}</div></div>`;
  };
  host.innerHTML = `<div class="view-head"><h2>Kanban</h2>
    <div class="view-tools">
      <label>Ast <select data-kf="branch"><option value="">alle</option>${branches.map(b => `<option value="${esc(b)}"${kanbanFilter.branch === b ? ' selected' : ''}>${esc(label(b))}</option>`).join('')}</select></label>
      <label>Zuständig <select data-kf="owner"><option value="">alle</option><option value="-"${kanbanFilter.owner === '-' ? ' selected' : ''}>niemand</option>${owners.map(o => `<option${kanbanFilter.owner === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" data-kf="ideas"${kanbanFilter.ideas ? ' checked' : ''}> Ideen-Spalte</label>
    </div></div>
    <div class="kboard">${cols.map(c => `<section class="kcol" data-col="${c.key}">
      <header><b>${c.label}</b><span>${c.items.length}</span>${c.hint ? `<em>${c.hint}</em>` : ''}${c.key !== 'idea' && !readOnly ? `<button type="button" class="kadd" data-kadd="${c.key}" title="Aufgabe hinzufügen">+</button>` : ''}</header>
      <div class="kcards">${c.items.map(card).join('') || `<div class="kempty">${c.key === 'idea' ? 'Alle Ideen sind schon Aufgaben.' : 'Karten hierher ziehen'}</div>`}</div>
    </section>`).join('')}</div>`;
}

function bindKanban() {
  const host = $('kanban-view');
  if (!host) return;
  host.addEventListener('change', e => {
    const f = e.target.dataset.kf;
    if (!f) return;
    kanbanFilter[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    renderKanban();
  });
  host.addEventListener('click', e => {
    const add = e.target.closest('[data-kadd]');
    if (add) {
      const status = add.dataset.kadd;
      const parent = kanbanFilter.branch || (primary() && !isTask(primary()) ? primary() : index().rid);
      showPrompt('Neue Aufgabe', `Aufgabe unter „${label(parent)}“`, '', v => {
        if (!v || !v.trim()) return;
        let nid;
        mutate('Neue Aufgabe', () => { nid = createChild(parent, v.trim(), null, { task: true, status }); });
        selectOne(nid);
      });
    }
  });
  host.addEventListener('dblclick', e => {
    const c = e.target.closest('[data-card]');
    if (!c || readOnly) return;
    const id = c.dataset.card;
    showPrompt('Text ändern', '', doc.nodes[id].text || '', v => {
      if (v === null) return;
      mutate('Text ändern', () => { doc.nodes[id].text = v; });
    }, true);
  });
  host.addEventListener('pointerdown', e => {
    const c = e.target.closest('[data-card]');
    if (!c || e.button !== 0) return;
    const id = c.dataset.card;
    if (!sel.has(id) || sel.size > 1) { sel = new Set([id]); focusId = id; selLink = null; updateInspector(); syncOtherViewsSelection(); updateCaptureTarget(); }
    if (readOnly) return;
    kdrag = { id, el: c, sx: e.clientX, sy: e.clientY, ghost: null, pid: e.pointerId };
  });
  window.addEventListener('pointermove', e => {
    if (!kdrag || e.pointerId !== kdrag.pid) return;
    if (!kdrag.ghost) {
      if (Math.hypot(e.clientX - kdrag.sx, e.clientY - kdrag.sy) < 6) return;
      const r = kdrag.el.getBoundingClientRect();
      const g = kdrag.el.cloneNode(true);
      g.classList.add('kghost');
      g.style.width = r.width + 'px';
      document.body.appendChild(g);
      kdrag.ghost = g; kdrag.ox = e.clientX - r.left; kdrag.oy = e.clientY - r.top;
      kdrag.el.classList.add('dragging');
    }
    kdrag.ghost.style.left = (e.clientX - kdrag.ox) + 'px';
    kdrag.ghost.style.top = (e.clientY - kdrag.oy) + 'px';
    const col = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains('kcol'));
    document.querySelectorAll('.kcol').forEach(x => x.classList.toggle('over', x === col));
    e.preventDefault();
  });
  window.addEventListener('pointerup', e => {
    if (!kdrag || e.pointerId !== kdrag.pid) return;
    const d = kdrag; kdrag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    d.el.classList.remove('dragging');
    const col = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains('kcol'));
    document.querySelectorAll('.kcol').forEach(x => x.classList.remove('over'));
    if (!col) return;
    const key = col.dataset.col;
    mutate(key === 'idea' ? 'Keine Aufgabe' : 'Status', () => {
      const n = doc.nodes[d.id];
      if (key === 'idea') { delete n.task; delete n.status; }
      else { n.task = true; n.status = key; }
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// Zeitplan
// ════════════════════════════════════════════════════════════════════
let ganttScale = 'day';    // day | week
let gdrag = null;

function renderTimeline() {
  const host = $('timeline-view');
  if (!host) return;
  if (M().planMode === 'project') renderGantt(host);
  else renderDueList(host);
}

function modeSwitch() {
  const pm = M().planMode;
  return `<div class="seg small" data-planmode>
    <button type="button" data-val="simple" class="${pm !== 'project' ? 'on' : ''}" title="Status, Zuständige, Fälligkeit">Einfach</button>
    <button type="button" data-val="project" class="${pm === 'project' ? 'on' : ''}" title="Start/Ende, Dauer, Abhängigkeiten, Gantt">Projekt</button></div>`;
}

function renderDueList(host) {
  const tasks = treeOrder().filter(isTask);
  const today = todayISO();
  const d = parseDate(today);
  const dow = (d.getDay() + 6) % 7;            // Montag = 0
  const endWeek = addDays(today, 6 - dow), endNext = addDays(today, 13 - dow);
  const groups = [
    { key: 'over', label: 'Überfällig', items: [] },
    { key: 'week', label: 'Diese Woche', items: [] },
    { key: 'next', label: 'Nächste Woche', items: [] },
    { key: 'later', label: 'Später', items: [] },
    { key: 'none', label: 'Ohne Termin', items: [] },
    { key: 'done', label: 'Erledigt', items: [] },
  ];
  const g = k => groups.find(x => x.key === k).items;
  for (const id of tasks) {
    const n = doc.nodes[id];
    if (n.status === 'done') g('done').push(id);
    else if (!n.due) g('none').push(id);
    else if (n.due < today) g('over').push(id);
    else if (n.due <= endWeek) g('week').push(id);
    else if (n.due <= endNext) g('next').push(id);
    else g('later').push(id);
  }
  for (const gr of groups) gr.items.sort((a, b) => ((doc.nodes[a].due || '9') < (doc.nodes[b].due || '9') ? -1 : (doc.nodes[a].due || '9') > (doc.nodes[b].due || '9') ? 1 : taskSort(a, b)));
  const ro = readOnly ? ' disabled' : '';
  const row = id => {
    const n = doc.nodes[id];
    return `<div class="tl-row${sel.has(id) ? ' selected' : ''}${n.status === 'done' ? ' done' : ''}" data-sel-id="${esc(id)}" data-row="${esc(id)}">
      ${statusBox(id)}
      <div class="tl-text"><b>${esc(label(id))}</b><small>${esc(pathText(id))}</small></div>
      <input class="tl-owner" data-tf="owner" list="owner-list-tl" value="${esc(n.owner || '')}" placeholder="zuständig"${ro}>
      <input type="date" data-tf="due" value="${esc(n.due || '')}"${ro}>
      <select data-tf="prio"${ro}>${PRIOS.map(p => `<option value="${p.key}"${(n.prio || 0) === p.key ? ' selected' : ''}>${p.key ? p.label : 'Priorität …'}</option>`).join('')}</select>
    </div>`;
  };
  host.innerHTML = `<div class="view-head"><h2>Zeitplan</h2><div class="view-tools">${modeSwitch()}</div></div>
    <datalist id="owner-list-tl">${knownOwners().map(o => `<option value="${esc(o)}">`).join('')}</datalist>
    ${tasks.length ? '' : `<div class="view-empty">Noch keine Aufgaben. Markiere Punkte als Aufgabe (<kbd>${IS_MAC ? '⌘' : 'Strg'}</kbd>+<kbd>Enter</kbd>) oder nutze <b>„Zum Plan machen“</b>.</div>`}
    ${groups.filter(gr => gr.items.length).map(gr => `<section class="tl-group ${gr.key}"><h3>${gr.label}<span>${gr.items.length}</span></h3>${gr.items.map(row).join('')}</section>`).join('')}`;
}

function bindTimeline() {
  const host = $('timeline-view');
  if (!host) return;
  host.addEventListener('click', e => {
    const pm = e.target.closest('[data-planmode] button');
    if (pm) { mutate('Planungsart', () => { M().planMode = pm.dataset.val; }); return; }
    const sb = e.target.closest('[data-status-btn]');
    if (sb) { cycleStatusSimple(sb.dataset.statusBtn); return; }
    const act = e.target.closest('[data-gact]');
    if (act) {
      const a = act.dataset.gact;
      if (a === 'auto') autoSchedule();
      else if (a === 'today') { const sc = host.querySelector('.g-scroll'); const tl = host.querySelector('.g-today'); if (sc && tl) sc.scrollLeft = Math.max(0, parseFloat(tl.getAttribute('x1')) - 120); }
      else if (a === 'day' || a === 'week') { ganttScale = a; renderTimeline(); }
      return;
    }
    const r = e.target.closest('[data-row]');
    if (r && !e.target.closest('input,select,button')) { sel = new Set([r.dataset.row]); focusId = r.dataset.row; selLink = null; updateInspector(); syncOtherViewsSelection(); updateCaptureTarget(); }
  });
  host.addEventListener('change', e => {
    const f = e.target.dataset.tf;
    if (!f) return;
    const r = e.target.closest('[data-row]');
    const id = r && r.dataset.row;
    if (!id) return;
    const v = e.target.value;
    mutate('Ändern', () => {
      const n = doc.nodes[id];
      if (f === 'prio') { if (Number(v)) n.prio = Number(v); else delete n.prio; }
      else if (v && v.trim()) n[f] = v.trim(); else delete n[f];
    });
  });
  // Gantt: Balken ziehen
  host.addEventListener('pointerdown', e => {
    const bar = e.target.closest('[data-bar]');
    if (!bar || readOnly) {
      const lane = e.target.closest('[data-lane]');
      if (lane && !readOnly && e.button === 0) {
        // Klick in eine leere Zeile: Aufgabe an diesem Tag einplanen
        const id = lane.dataset.lane;
        const n = doc.nodes[id];
        if (!n.start && !n.due) {
          const svg = lane.ownerSVGElement;
          const pt = svg.getBoundingClientRect();
          const day = Math.floor((e.clientX - pt.left) / gantt.dayW);
          const iso = addDays(gantt.start, day);
          mutate('Einplanen', () => { n.start = iso; n.due = iso; });
        }
      }
      return;
    }
    const id = bar.dataset.bar;
    const r = bar.getBoundingClientRect();
    const mode = e.clientX - r.left < 8 ? 'l' : r.right - e.clientX < 8 ? 'r' : 'm';
    gdrag = { id, mode, sx: e.clientX, el: bar, pid: e.pointerId, days: 0 };
    sel = new Set([id]); focusId = id; updateInspector();
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  host.addEventListener('pointermove', e => {
    if (gdrag && e.pointerId === gdrag.pid) {
      const days = Math.round((e.clientX - gdrag.sx) / gantt.dayW);
      if (days !== gdrag.days) {
        gdrag.days = days;
        const px = days * gantt.dayW;
        const g = gdrag.el;
        if (gdrag.mode === 'm') g.setAttribute('transform', `translate(${px},0)`);
        else {
          const rect = g.querySelector('rect');
          const x0 = parseFloat(rect.dataset.x), w0 = parseFloat(rect.dataset.w);
          if (gdrag.mode === 'r') rect.setAttribute('width', Math.max(gantt.dayW * 0.6, w0 + px));
          else { rect.setAttribute('x', Math.min(x0 + w0 - gantt.dayW * 0.6, x0 + px)); rect.setAttribute('width', Math.max(gantt.dayW * 0.6, w0 - px)); }
        }
      }
      return;
    }
    const bar = e.target.closest && e.target.closest('[data-bar]');
    if (bar) {
      const r = bar.getBoundingClientRect();
      bar.style.cursor = (e.clientX - r.left < 8 || r.right - e.clientX < 8) ? 'ew-resize' : 'grab';
    }
  });
  host.addEventListener('pointerup', e => {
    if (!gdrag || e.pointerId !== gdrag.pid) return;
    const d = gdrag; gdrag = null;
    if (!d.days) return;
    mutate('Termin verschieben', () => {
      const n = doc.nodes[d.id];
      const s = n.start || n.due, en = n.due || n.start;
      if (d.mode === 'm') { n.start = addDays(s, d.days); n.due = addDays(en, d.days); }
      else if (d.mode === 'r') { n.start = s; n.due = addDays(en, d.days); if (n.due < n.start) n.due = n.start; }
      else { n.due = en; n.start = addDays(s, d.days); if (n.start > n.due) n.start = n.due; }
      if (n.ms) n.start = n.due;
    });
  });
}

// ── Gantt ───────────────────────────────────────────────────────────
let gantt = { dayW: 28, start: todayISO() };

function taskRange(id) {
  const n = doc.nodes[id];
  const s = n.start || n.due || null, e = n.due || n.start || null;
  return s ? { s, e: e < s ? s : e } : null;
}

function renderGantt(host) {
  const t = T();
  const ids = treeOrder().filter(isTask);
  const ranges = {};
  let min = null, max = null;
  for (const id of ids) {
    const r = taskRange(id);
    ranges[id] = r;
    if (r) { if (!min || r.s < min) min = r.s; if (!max || r.e > max) max = r.e; }
  }
  const today = todayISO();
  if (!min || today < min) min = min && dayDiff(today, min) > 60 ? min : today;
  if (!max || today > max) max = today;
  let start = addDays(min, -3);
  // auf Montag ausrichten
  const sd = parseDate(start); start = addDays(start, -((sd.getDay() + 6) % 7));
  let days = Math.max(35, dayDiff(start, max) + 14);
  const dayW = ganttScale === 'week' ? 10 : 28;
  gantt = { dayW, start };

  // Zeilen: Hauptast-Überschrift, darunter seine Aufgaben
  const rows = [];
  const byBranch = new Map();
  for (const id of ids) {
    const b = branchOf(id) || id;
    if (!byBranch.has(b)) byBranch.set(b, []);
    byBranch.get(b).push(id);
  }
  for (const [b, list] of byBranch) {
    // ein Hauptast, der selbst die einzige Aufgabe ist, braucht keine Überschrift
    if (!(list.length === 1 && list[0] === b)) rows.push({ head: true, id: b, list });
    for (const id of list) rows.push({ id });
  }
  const RH = 32, HEAD = 46;
  const W = days * dayW, H = HEAD + rows.length * RH + 8;
  const rowY = {};
  rows.forEach((r, i) => { if (!r.head) rowY[r.id] = HEAD + i * RH; });

  let svg = `<svg class="g-svg" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  // Kopf: Monate und Tage, Wochenenden
  for (let i = 0; i < days; i++) {
    const iso = addDays(start, i), d = parseDate(iso);
    const x = i * dayW;
    const we = d.getDay() === 0 || d.getDay() === 6;
    if (we) svg += `<rect x="${x}" y="${HEAD - 16}" width="${dayW}" height="${H - HEAD + 16}" fill="${t.chip}" opacity="0.7"/>`;
    if (d.getDate() === 1 || i === 0) svg += `<text x="${x + 4}" y="14" class="g-month">${d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</text>`;
    if (ganttScale === 'day') svg += `<text x="${x + dayW / 2}" y="${HEAD - 4}" class="g-day${we ? ' we' : ''}" text-anchor="middle">${d.getDate()}</text>`;
    else if (d.getDay() === 1) svg += `<text x="${x + 2}" y="${HEAD - 4}" class="g-day">KW ${isoWeek(d)}</text>`;
    if (d.getDay() === 1) svg += `<line x1="${x}" y1="${HEAD - 16}" x2="${x}" y2="${H}" stroke="${t.nodeBorder}" stroke-width="1"/>`;
  }
  svg += `<line x1="0" y1="${HEAD}" x2="${W}" y2="${HEAD}" stroke="${t.nodeBorder}"/>`;
  // Zeilen
  rows.forEach((r, i) => {
    const y = HEAD + i * RH;
    if (r.head) {
      svg += `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="${t.chip}" opacity="0.45"/>`;
      // Sammelbalken über alle Aufgaben des Astes
      const rs = r.list.map(id => ranges[id]).filter(Boolean);
      if (rs.length) {
        const s = rs.reduce((a, b) => a.s < b.s ? a : b).s, e = rs.reduce((a, b) => a.e > b.e ? a : b).e;
        const x = dayDiff(start, s) * dayW, w = (dayDiff(s, e) + 1) * dayW;
        svg += `<path d="M${x} ${y + 12} h${w} v8 l-5 -4 h${-(w - 10)} l-5 4 Z" fill="${branchColor(r.list[0])}" opacity="0.85"/>`;
      }
    } else {
      svg += `<rect data-lane="${esc(r.id)}" x="0" y="${y}" width="${W}" height="${RH}" fill="transparent"/>`;
      svg += `<line x1="0" y1="${y + RH}" x2="${W}" y2="${y + RH}" stroke="${t.nodeBorder}" opacity="0.5"/>`;
    }
  });
  // Abhängigkeiten
  for (const id of ids) {
    const n = doc.nodes[id];
    for (const dep of n.deps || []) {
      const a = ranges[dep], b = ranges[id];
      if (!a || !b || rowY[dep] == null) continue;
      const x1 = (dayDiff(start, a.e) + 1) * dayW, y1 = rowY[dep] + RH / 2;
      const x2 = dayDiff(start, b.s) * dayW, y2 = rowY[id] + RH / 2;
      const bad = b.s <= a.e;
      const col = bad ? t.prio[1] : t.muted;
      const mx = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
      svg += `<path d="M${x1} ${y1} H${mx} V${y2} H${x2 - 2}" fill="none" stroke="${col}" stroke-width="1.4"${bad ? ' stroke-dasharray="4 3"' : ''}/>`;
      svg += `<path d="M${x2 - 1} ${y2} l-6 -4 v8 Z" fill="${col}"/>`;
    }
  }
  // Balken
  for (const id of ids) {
    const r = ranges[id];
    if (!r) continue;
    const n = doc.nodes[id];
    const y = rowY[id];
    const x = dayDiff(start, r.s) * dayW, w = (dayDiff(r.s, r.e) + 1) * dayW;
    const col = branchColor(id);
    const selc = sel.has(id) ? ` stroke="${t.accent}" stroke-width="2"` : ` stroke="${col}" stroke-width="1"`;
    if (n.ms) {
      const cx = x + dayW / 2, cy = y + RH / 2;
      svg += `<g data-bar="${esc(id)}" class="g-bar"><rect data-x="${x}" data-w="${dayW}" x="${x}" y="${y}" width="${dayW}" height="${RH}" fill="transparent"/>
        <path d="M${cx} ${cy - 9} L${cx + 9} ${cy} L${cx} ${cy + 9} L${cx - 9} ${cy} Z" fill="${n.status === 'done' ? t.done : col}"${selc}/></g>`;
    } else {
      const fr = n.status === 'done' ? 1 : n.status === 'doing' ? 0.5 : 0;
      svg += `<g data-bar="${esc(id)}" class="g-bar"><rect data-x="${x + 2}" data-w="${w - 4}" x="${x + 2}" y="${y + 7}" width="${w - 4}" height="${RH - 14}" rx="5" fill="${hexAlpha(col, 0.22)}"${selc}/>`;
      if (fr) svg += `<rect x="${x + 2}" y="${y + 7}" width="${Math.max(6, (w - 4) * fr)}" height="${RH - 14}" rx="5" fill="${n.status === 'done' ? t.done : col}" opacity="0.75" pointer-events="none"/>`;
      if (n.owner && w > 40) svg += `<text x="${x + 8}" y="${y + RH / 2 + 4}" class="g-owner" pointer-events="none">${esc(initials(n.owner))}</text>`;
      svg += `</g>`;
    }
  }
  // Heute
  const tx = (dayDiff(start, today) + 0.5) * dayW;
  svg += `<line class="g-today" x1="${tx}" y1="${HEAD - 18}" x2="${tx}" y2="${H}" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="3 3" pointer-events="none"/>`;
  svg += `</svg>`;

  const labels = rows.map(r => r.head
    ? `<div class="g-label head" style="height:${RH}px">${esc(label(r.id))}</div>`
    : `<div class="g-label${sel.has(r.id) ? ' selected' : ''}" data-sel-id="${esc(r.id)}" data-row="${esc(r.id)}" style="height:${RH}px">${statusBox(r.id)}<span>${esc(label(r.id))}</span>${ranges[r.id] ? '' : '<em>ohne Termin</em>'}</div>`).join('');

  const unscheduled = ids.filter(id => !ranges[id]).length;
  host.innerHTML = `<div class="view-head"><h2>Zeitplan</h2><div class="view-tools">${modeSwitch()}
      <div class="seg small"><button type="button" data-gact="day" class="${ganttScale === 'day' ? 'on' : ''}">Tage</button><button type="button" data-gact="week" class="${ganttScale === 'week' ? 'on' : ''}">Wochen</button></div>
      <button type="button" class="btn-small" data-gact="today">Heute</button>
      ${readOnly ? '' : '<button type="button" class="btn-small accent" data-gact="auto" title="Aufgaben ohne Termin einplanen und Abhängigkeiten einhalten">Automatisch planen</button>'}
    </div></div>
    ${ids.length ? `<p class="view-note">Balken ziehen verschiebt, Ränder ziehen ändert Start/Ende. ${unscheduled ? `${unscheduled} Aufgabe(n) ohne Termin – in die Zeile klicken oder „Automatisch planen“.` : ''} Abhängigkeiten im Eigenschaften-Feld rechts.</p>` : ''}
    ${ids.length ? `<div class="g-wrap"><div class="g-labels" style="padding-top:${HEAD}px">${labels}</div><div class="g-scroll">${svg}</div></div>`
      : `<div class="view-empty">Noch keine Aufgaben. Markiere Punkte als Aufgabe oder nutze <b>„Zum Plan machen“</b>.</div>`}`;
  const sc = host.querySelector('.g-scroll');
  if (sc && !host.dataset.scrolled) { sc.scrollLeft = Math.max(0, tx - 160); host.dataset.scrolled = '1'; }
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/**
 * Automatisch planen: Aufgaben ohne Termin bekommen Start/Ende, Abhängigkeiten
 * werden eingehalten (Nachfolger beginnt nach dem Ende des Vorgängers).
 * Erledigte Aufgaben bleiben unverändert.
 */
function autoSchedule() {
  const ids = treeOrder().filter(isTask);
  const startDay = M().projectStart || todayISO();
  let moved = 0;
  mutate('Automatisch planen', () => {
    const doneSet = new Set();
    const visiting = new Set();
    const end = id => {
      const n = doc.nodes[id];
      if (doneSet.has(id)) return n.due || n.start;
      if (visiting.has(id)) return null;           // Zyklus: nicht weiter verfolgen
      visiting.add(id);
      let earliest = startDay;
      for (const d of n.deps || []) {
        if (!doc.nodes[d] || !isTask(d)) continue;
        const e = end(d);
        if (e && addDays(e, 1) > earliest) earliest = addDays(e, 1);
      }
      if (n.status !== 'done') {
        const r = taskRange(id);
        const dur = r ? dayDiff(r.s, r.e) + 1 : 1;
        if (!r) { n.start = skipWeekend(earliest); n.due = addDays(n.start, dur - 1); moved++; }
        else if ((n.deps || []).length && r.s < earliest) {
          n.start = skipWeekend(earliest); n.due = addDays(n.start, dur - 1); moved++;
        }
        if (n.ms) n.start = n.due;
      }
      visiting.delete(id);
      doneSet.add(id);
      return n.due || n.start;
    };
    for (const id of ids) end(id);
  });
  flashStatus(moved ? `${moved} Aufgabe(n) eingeplant` : 'Alles ist schon eingeplant');
}
function skipWeekend(iso) {
  const d = parseDate(iso);
  if (d.getDay() === 6) return addDays(iso, 2);
  if (d.getDay() === 0) return addDays(iso, 1);
  return iso;
}
