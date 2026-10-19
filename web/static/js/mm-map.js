'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Mindmap-Ansicht (Canvas, Maus, Touch, Tastatur)
// ════════════════════════════════════════════════════════════════════

let canvas = null, cctx = null;
const DPR = window.devicePixelRatio || 1;
let view = { x: 0, y: 0, z: 1 };       // Bildschirm = Welt * z + (x, y)
let sel = new Set();                    // markierte Knoten
let focusId = null;                     // zuletzt markierter Knoten (Tastatur)
let selLink = null;                     // markierte Querverbindung
let hoverId = null;
let editing = null;                     // {id, fresh, ta, original}
let drag = null;
let linkMode = null;                    // {from, x, y}
let showGrid = true;
let searchHits = null;                  // Set
let findingIds = null;                  // Set (Prüfung)
let remoteSel = [];                     // [{id, color, name}] (gemeinsames Bearbeiten)
let renderQueued = false, needLayout = true;
let appClipboard = null, appClipboardText = null;
const pointers = new Map();
let pinch = null;
let lastTap = { t: 0, id: null, x: 0, y: 0 };
let longPressTimer = null;

// ── Rendern ─────────────────────────────────────────────────────────
function requestRender(relayout) {
  if (relayout) needLayout = true;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (needLayout) { layoutMap(); needLayout = false; }
    if (currentView === 'map') renderMap();
    if (presentState) renderPresentation();
  });
}

function setupMapCanvas() {
  canvas = document.getElementById('main-canvas');
  if (!canvas) return false;
  cctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); requestRender(); });
  return true;
}

function resizeCanvas() {
  if (!canvas) return;
  const box = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * DPR));
  canvas.height = Math.max(1, Math.round(box.height * DPR));
  canvas.style.width = box.width + 'px';
  canvas.style.height = box.height + 'px';
}

function cssSize() { return { w: canvas.width / DPR, h: canvas.height / DPR }; }

function renderMap() {
  if (!canvas || !cctx) return;
  if (needLayout) { layoutMap(); needLayout = false; }
  const t = T();
  const { w, h } = cssSize();
  cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cctx.fillStyle = t.bg;
  cctx.fillRect(0, 0, w, h);
  if (showGrid) drawDots(w, h);
  cctx.setTransform(DPR * view.z, 0, 0, DPR * view.z, DPR * view.x, DPR * view.y);
  drawMap(canvasPainter(cctx), {
    sel, selLink, hover: hoverId,
    drop: drag && drag.type === 'node' ? drag.drop : null,
    remoteSel, search: searchHits, findings: findingIds,
    linkPreview: linkMode && linkMode.x != null ? linkMode : null,
  });
  // gezogene Knoten als Vorschau
  if (drag && drag.type === 'node' && drag.moved) {
    const p = canvasPainter(cctx);
    for (const id of drag.ids) {
      const L = LAY[id];
      if (!L) continue;
      p.rect(L.x - L.w / 2 + drag.dx, L.y - L.h / 2 + drag.dy, L.w, L.h, 8, { fill: t.accentSoft, stroke: t.accent, lw: 1.5, dash: [4, 3] });
      p.text(L.lines[0] || '', L.x - L.w / 2 + drag.dx + L.st.padX, L.y + drag.dy, { font: L.font, color: t.text, alpha: 0.7 });
    }
  }
  cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (drag && drag.type === 'rubber') {
    const x = Math.min(drag.sx, drag.cx), y = Math.min(drag.sy, drag.cy);
    cctx.fillStyle = t.accentSoft; cctx.strokeStyle = t.accent; cctx.lineWidth = 1; cctx.setLineDash([4, 3]);
    cctx.fillRect(x, y, Math.abs(drag.cx - drag.sx), Math.abs(drag.cy - drag.sy));
    cctx.strokeRect(x, y, Math.abs(drag.cx - drag.sx), Math.abs(drag.cy - drag.sy));
    cctx.setLineDash([]);
  }
  positionEditor();
  positionNodeActions();
  updateZoomLabel();
}

function drawDots(w, h) {
  const step = 24 * view.z;
  if (step < 9) return;
  cctx.fillStyle = T().grid;
  const ox = ((view.x % step) + step) % step, oy = ((view.y % step) + step) % step;
  const r = Math.max(0.8, Math.min(1.4, view.z));
  for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) cctx.fillRect(x - r / 2, y - r / 2, r, r);
}

// ── Koordinaten ─────────────────────────────────────────────────────
function toWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z, sx: clientX - r.left, sy: clientY - r.top };
}
function toScreen(wx, wy) { return { x: wx * view.z + view.x, y: wy * view.z + view.y }; }

function nodeAt(wx, wy, exclude) {
  for (let i = LAY_ORDER.length - 1; i >= 0; i--) {
    const id = LAY_ORDER[i];
    if (exclude && exclude.has(id)) continue;
    const L = LAY[id];
    if (Math.abs(wx - L.x) <= L.w / 2 + 3 && Math.abs(wy - L.y) <= L.h / 2 + 3) return id;
  }
  return null;
}
function hitCircle(h, wx, wy) { return h && Math.hypot(wx - h.x, wy - h.y) <= h.r; }
function hitRect(h, wx, wy) { return h && wx >= h.x && wx <= h.x + h.w && wy >= h.y && wy <= h.y + h.h; }

function linkAt(wx, wy) {
  let best = null, bd = 7 / view.z;
  for (const lid in doc.links) {
    const l = doc.links[lid];
    if (!LAY[l.from] || !LAY[l.to]) continue;
    const d = distToCrossLink(l, wx, wy);
    if (d < bd) { bd = d; best = lid; }
  }
  return best;
}

// ── Ansicht: Zoom, Einpassen, Mitte ─────────────────────────────────
let viewAnim = null;
function animateView(target, ms) {
  cancelAnimationFrame(viewAnim);
  const from = { ...view };
  const t0 = performance.now();
  const dur = ms == null ? 260 : ms;
  if (!dur) { Object.assign(view, target); requestRender(); return; }
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    view.z = from.z + (target.z - from.z) * e;
    renderMap();
    if (presentState) renderPresentation();
    if (k < 1) viewAnim = requestAnimationFrame(step);
  };
  viewAnim = requestAnimationFrame(step);
}

function fitRect(b, w, h, pad, maxZ) {
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const z = Math.min(maxZ || 1.4, (w - pad * 2) / bw, (h - pad * 2) / bh);
  return { z, x: w / 2 - (b.x0 + bw / 2) * z, y: h / 2 - (b.y0 + bh / 2) * z };
}

function fitView(animate) {
  if (needLayout) { layoutMap(); needLayout = false; }
  if (!LAY_BOUNDS || !canvas) return;
  const { w, h } = cssSize();
  animateView(fitRect(LAY_BOUNDS, w, h, 50, 1.25), animate === false ? 0 : 280);
}

function zoomBy(f, cx, cy) {
  const { w, h } = cssSize();
  if (cx == null) { cx = w / 2; cy = h / 2; }
  const z = Math.max(0.15, Math.min(4, view.z * f));
  const k = z / view.z;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.z = z;
  requestRender();
}

function updateZoomLabel() {
  const el = document.getElementById('zoom-label');
  if (el) el.textContent = Math.round(view.z * 100) + ' %';
}

function ensureVisible(id) {
  if (needLayout) { layoutMap(); needLayout = false; }
  const L = LAY[id];
  if (!L || !canvas) return;
  const { w, h } = cssSize();
  const s = toScreen(L.x, L.y);
  const m = 60;
  let dx = 0, dy = 0;
  const hw = L.w * view.z / 2, hh = L.h * view.z / 2;
  if (s.x - hw < m) dx = m - (s.x - hw); else if (s.x + hw > w - m) dx = (w - m) - (s.x + hw);
  if (s.y - hh < m) dy = m - (s.y - hh); else if (s.y + hh > h - m - 50) dy = (h - m - 50) - (s.y + hh);
  if (dx || dy) animateView({ x: view.x + dx, y: view.y + dy, z: view.z }, 180);
}

// ── Auswahl ─────────────────────────────────────────────────────────
function select(ids, opts) {
  sel = new Set((ids || []).filter(id => doc.nodes[id]));
  focusId = sel.size ? [...sel][sel.size - 1] : null;
  if (!opts || !opts.keepLink) selLink = null;
  selectionChanged();
}
function selectOne(id) { select(id ? [id] : []); }
function selectionChanged() {
  requestRender();
  if (typeof updateInspector === 'function') updateInspector();
  if (typeof collabSelectionChanged === 'function') collabSelectionChanged();
  if (typeof updateCaptureTarget === 'function') updateCaptureTarget();
  if (typeof syncOtherViewsSelection === 'function') syncOtherViewsSelection();
}
function cleanSelection() {
  let changed = false;
  for (const id of [...sel]) if (!doc.nodes[id]) { sel.delete(id); changed = true; }
  if (focusId && !doc.nodes[focusId]) { focusId = sel.size ? [...sel][sel.size - 1] : null; changed = true; }
  if (selLink && !doc.links[selLink]) { selLink = null; changed = true; }
  if (layoutRoot && !doc.nodes[layoutRoot]) layoutRoot = null;
  return changed;
}
function primary() { return focusId && doc.nodes[focusId] ? focusId : (sel.size ? [...sel][0] : null); }

/** Markierte Knoten ohne solche, deren Vorfahr ebenfalls markiert ist. */
function topSelected() {
  const ids = [...sel].filter(id => doc.nodes[id]);
  return ids.filter(id => !ids.some(o => o !== id && isAncestor(o, id)));
}

// ════════════════════════════════════════════════════════════════════
// Bearbeiten im Knoten (Textfeld über dem Canvas)
// ════════════════════════════════════════════════════════════════════
function startEdit(id, opts) {
  if (readOnly || !doc.nodes[id]) return;
  if (currentView !== 'map') return;
  opts = opts || {};
  if (editing) commitEdit();
  if (layoutRoot && !isAncestor(layoutRoot, id) && id !== layoutRoot) layoutRoot = null;
  // eingeklappte Vorfahren aufklappen
  for (const a of ancestors(id)) if (doc.nodes[a] && doc.nodes[a].collapsed) {
    mutate('Aufklappen', () => { delete doc.nodes[a].collapsed; }, { noUndo: true });
  }
  selectOne(id);
  const ta = document.createElement('textarea');
  ta.id = 'node-editor';
  ta.spellcheck = true;
  ta.setAttribute('autocapitalize', 'sentences');
  const original = doc.nodes[id].text || '';
  ta.value = opts.replace != null ? opts.replace : original;
  editing = { id, fresh: !!opts.fresh, ta, original };
  editOverride = { id, text: ta.value };
  document.getElementById('canvas-container').appendChild(ta);
  needLayout = true; layoutMap(); needLayout = false;
  ensureVisible(id);
  renderMap();
  ta.addEventListener('input', () => {
    editOverride = { id, text: ta.value };
    requestRender(true);
  });
  ta.addEventListener('keydown', onEditorKey);
  ta.addEventListener('blur', () => { if (editing && editing.ta === ta && !editing.keepOnBlur) commitEdit(); });
  // sofort fokussieren, damit schnell weitergetippte Zeichen nicht verloren gehen
  ta.focus({ preventScroll: true });
  if (opts.replace != null || opts.caretEnd) ta.selectionStart = ta.selectionEnd = ta.value.length;
  else ta.select();
}

function positionEditor() {
  if (!editing) return;
  const L = LAY[editing.id];
  if (!L) return;
  const ta = editing.ta;
  const t = T();
  const st = L.st;
  const z = view.z;
  const s = toScreen(L.x - L.w / 2, L.y - L.h / 2);
  const lead = L.lead * z;
  ta.style.left = (s.x + st.padX * z + lead - 3) + 'px';
  const top = s.y + (L.img ? (L.img.h + 6) * z : 0) + st.padY * z - 3;
  ta.style.top = top + 'px';
  ta.style.width = Math.max(60, (L.tw + 14) * z + 8) + 'px';
  ta.style.height = (L.lines.length * L.lineH * z + 6) + 'px';
  ta.style.font = `${st.weight} ${st.size * z}px ${FONT_STACK}`;
  ta.style.lineHeight = (L.lineH * z) + 'px';
  ta.style.color = st.shape === 'root' ? t.rootText : t.text;
  ta.style.background = st.shape === 'root' ? t.rootFill : (st.shape === 'line' ? t.bg : t.nodeFill);
}

function onEditorKey(e) {
  if (!editing) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
    e.preventDefault();
    commitEdit({ then: editing.fresh ? 'sibling' : null });
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const ta = editing.ta, s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + '\n' + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = s + 1;
    ta.dispatchEvent(new Event('input'));
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    commitEdit({ then: 'child' });
  } else if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
  } else if (e.key === 'Escape') {
    // Esc beendet die Eingabe und behält den Text (Rückgängig mit Strg/⌘+Z)
    e.preventDefault();
    commitEdit();
  }
  e.stopPropagation();
}

function cancelEdit() {
  if (!editing) return;
  const ed = editing;
  editing = null; editOverride = null;
  ed.ta.remove();
  requestRender(true);
  canvas.focus();
}

function commitEdit(opts) {
  if (!editing) return;
  const ed = editing;
  editing = null; editOverride = null;
  const text = ed.ta.value.replace(/\s+$/g, '').replace(/^\s+/, '');
  ed.ta.remove();
  if (!doc.nodes[ed.id]) { requestRender(true); return; }
  if (ed.fresh && !text) {
    // leerer neuer Knoten: wieder entfernen (zusammen mit dem Anlegen rückgängig)
    const p = parentOf(ed.id);
    mutate('Leeren Knoten entfernen', () => deleteSubtree(ed.id), { joinLast: true });
    dropEmptyUndo();
    selectOne(p);
    canvas.focus();
    return;
  }
  if (text !== (doc.nodes[ed.id].text || '')) {
    mutate(ed.fresh ? 'Neuer Knoten' : 'Text ändern', () => { doc.nodes[ed.id].text = text; }, ed.fresh ? { joinLast: true } : null);
  } else requestRender(true);
  canvas.focus({ preventScroll: true });
  if (opts && opts.then === 'sibling') addSibling(ed.id);
  else if (opts && opts.then === 'child') addChild(ed.id);
}

// ── Neue Knoten ─────────────────────────────────────────────────────
function addChild(parent, text) {
  parent = parent || primary() || index().rid;
  let nid = null;
  mutate('Neuer Knoten', () => { nid = createChild(parent, text || ''); });
  if (!nid) return null;
  if (!text) startEdit(nid, { fresh: true });
  else selectOne(nid);
  return nid;
}

function addSibling(id, before) {
  id = id || primary();
  if (!id) return null;
  if (isRoot(id) || (layoutRoot && id === layoutRoot)) return addChild(id);
  let nid = null;
  mutate('Neuer Knoten', () => { nid = createSibling(id, '', before); });
  if (nid) startEdit(nid, { fresh: true });
  return nid;
}

// ── Löschen, Verschieben, Gruppieren ────────────────────────────────
function deleteSelection() {
  if (selLink) {
    const lid = selLink;
    mutate('Verbindung löschen', () => { delete doc.links[lid]; });
    selLink = null; selectionChanged();
    return;
  }
  const ids = topSelected().filter(id => !isRoot(id));
  if (!ids.length) { if (sel.size) flashStatus('Das Zentralthema kann nicht gelöscht werden'); return; }
  // danach den Nachbarn oder Elternknoten markieren
  const first = ids[0];
  const p = parentOf(first);
  const sib = kids(p).filter(x => !ids.includes(x));
  const pos = kids(p).indexOf(first);
  const next = sib[Math.min(pos, sib.length - 1)] || p;
  mutate(ids.length > 1 ? `${ids.length} Knoten löschen` : 'Knoten löschen', () => { for (const id of ids) deleteSubtree(id); });
  selectOne(next);
}

function moveSibling(delta) {
  const id = primary();
  if (!id || isRoot(id)) return;
  const p = parentOf(id);
  let list = kids(p);
  if (isRoot(p) && M().layout === 'map') {
    // auf derselben Seite bleiben
    const side = LAY[id] ? LAY[id].side : null;
    list = list.filter(c => !LAY[c] || LAY[c].side === side);
  }
  const i = list.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  const all = kids(p);
  const target = list[j];
  const tpos = all.indexOf(target);
  mutate('Verschieben', () => moveNode(id, p, delta > 0 ? tpos + 1 : tpos));
  if (LAY[id] && LAY[id].side && isRoot(p)) mutate('Seite', () => { doc.nodes[id].side = LAY[id].side; }, { joinLast: true });
  selectOne(id);
}

function outdent(id) {
  id = id || primary();
  if (!id || isRoot(id)) return;
  const p = parentOf(id);
  if (isRoot(p)) return;
  const gp = parentOf(p);
  const pos = kids(gp).indexOf(p) + 1;
  mutate('Ebene höher', () => moveNode(id, gp, pos));
  selectOne(id);
}

function indent(id) {
  id = id || primary();
  if (!id || isRoot(id)) return;
  const p = parentOf(id);
  const list = kids(p);
  const i = list.indexOf(id);
  if (i <= 0) return;
  mutate('Ebene tiefer', () => moveNode(id, list[i - 1], null));
  selectOne(id);
}

function groupSelection() {
  const ids = topSelected().filter(id => !isRoot(id));
  if (!ids.length) return;
  const p = parentOf(ids[0]);
  if (!ids.every(id => parentOf(id) === p)) { flashStatus('Zum Gruppieren Knoten mit demselben Elternknoten markieren'); return; }
  const list = kids(p);
  ids.sort((a, b) => list.indexOf(a) - list.indexOf(b));
  let gid = null;
  mutate('Gruppieren', () => {
    const extra = isRoot(p) && doc.nodes[ids[0]].side ? { side: doc.nodes[ids[0]].side } : {};
    gid = createChild(p, '', list.indexOf(ids[0]), extra);
    for (const id of ids) moveNode(id, gid, null);
  });
  if (gid) startEdit(gid, { fresh: false });
}

function duplicateSelection() {
  const ids = topSelected().filter(id => !isRoot(id));
  if (!ids.length) return;
  const data = extractSubtrees(ids);
  let out = [];
  mutate('Duplizieren', () => {
    out = insertSubtrees(data, parentOf(ids[0]));
    // hinter das Original setzen
    for (const nid of out) {
      const p = parentOf(nid);
      const pos = kids(p).indexOf(ids[ids.length - 1]) + 1;
      moveNode(nid, p, pos);
      if (doc.nodes[ids[0]].side) doc.nodes[nid].side = doc.nodes[ids[0]].side;
    }
  });
  select(out);
}

function toggleCollapse(id, force) {
  id = id || primary();
  if (!id || !kids(id).length || isRoot(id)) return;
  const n = doc.nodes[id];
  const v = force == null ? !n.collapsed : force;
  mutate(v ? 'Einklappen' : 'Aufklappen', () => { if (v) doc.nodes[id].collapsed = true; else delete doc.nodes[id].collapsed; }, { merge: 'collapse' });
}

function expandAll() {
  mutate('Alles aufklappen', () => { for (const id in doc.nodes) delete doc.nodes[id].collapsed; });
}
function collapseToLevel(level) {
  mutate('Einklappen', () => {
    for (const id in doc.nodes) {
      const d = depthOf(id);
      if (d >= level && kids(id).length) doc.nodes[id].collapsed = true; else delete doc.nodes[id].collapsed;
    }
  });
  fitView();
}

function resetPositions() {
  mutate('Neu anordnen', () => {
    for (const id in doc.nodes) { delete doc.nodes[id].dx; delete doc.nodes[id].dy; }
  });
  fitView();
}

// ── Aufgaben-Schnellbefehle ─────────────────────────────────────────
function cycleStatus(id) {
  const ids = id ? [id] : [...sel];
  if (!ids.length) return;
  mutate('Status', () => {
    for (const k of ids) {
      const n = doc.nodes[k];
      if (!n) continue;
      if (!n.task) { n.task = true; n.status = 'todo'; continue; }
      n.status = n.status === 'todo' || !n.status ? 'doing' : n.status === 'doing' ? 'done' : 'todo';
    }
  });
  if (phase() !== 'plan') flashStatus('Aufgabe markiert – sichtbar in der Phase „Planen“ und im Kanban');
}

function setPrio(p) {
  const ids = [...sel];
  if (!ids.length) return;
  const same = ids.every(k => (doc.nodes[k].prio || 0) === p);
  mutate('Priorität', () => {
    for (const k of ids) { if (same || !p) delete doc.nodes[k].prio; else doc.nodes[k].prio = p; }
  });
  if (phase() === 'collect') flashStatus('Priorität gesetzt – sichtbar in den Phasen „Ordnen“ und „Planen“');
}

// ── Navigation mit Pfeiltasten (räumlich) ───────────────────────────
function navigate(dir) {
  const cur = primary();
  if (!cur || !LAY[cur]) { selectOne(index().rid); return; }
  const A = LAY[cur];
  let best = null, bs = Infinity;
  for (const id of LAY_ORDER) {
    if (id === cur) continue;
    const B = LAY[id];
    const dx = B.x - A.x, dy = B.y - A.y;
    let main, cross;
    if (dir === 'left') { main = -dx; cross = dy; }
    else if (dir === 'right') { main = dx; cross = dy; }
    else if (dir === 'up') { main = -dy; cross = dx; }
    else { main = dy; cross = dx; }
    if (main <= 4) continue;
    let score = main + Math.abs(cross) * 2.2;
    // Eltern/Kind bevorzugen, damit man dem Ast folgt
    if (parentOf(id) === cur || parentOf(cur) === id) score *= 0.6;
    if (parentOf(id) === parentOf(cur)) score *= 0.8;
    if (score < bs) { bs = score; best = id; }
  }
  if (best) { selectOne(best); ensureVisible(best); }
}

// ── Querverbindungen ────────────────────────────────────────────────
function startLinkMode(from) {
  from = from || primary();
  if (!from) return;
  linkMode = { from };
  flashStatus('Querverbindung: Zielknoten anklicken (Esc bricht ab)', 8000);
  canvas.style.cursor = 'crosshair';
}
function finishLink(to) {
  const from = linkMode.from;
  linkMode = null;
  canvas.style.cursor = '';
  if (!to || to === from) { requestRender(); return; }
  const exists = Object.values(doc.links).some(l => l.from === from && l.to === to);
  if (exists) { flashStatus('Diese Verbindung gibt es schon'); return; }
  let lid = null;
  mutate('Querverbindung', () => { lid = uid('l'); doc.links[lid] = { id: lid, from, to, label: '' }; });
  selLink = lid; sel = new Set(); focusId = null;
  selectionChanged();
}
function editLinkLabel(lid) {
  const l = doc.links[lid];
  if (!l) return;
  showPrompt('Querverbindung beschriften', 'Beschriftung (z. B. „führt zu“, „braucht“)', l.label || '', v => {
    if (v === null) return;
    mutate('Beschriftung', () => { doc.links[lid].label = v.trim(); });
  });
}

// ════════════════════════════════════════════════════════════════════
// Zeiger (Maus, Stift, Finger)
// ════════════════════════════════════════════════════════════════════
function bindMapEvents() {
  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => { if (!drag && hoverId) { hoverId = null; requestRender(); } });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    openMapMenu(w, e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode ? 30 : 1;
      view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      requestRender();
    }
  }, { passive: false });
}

function onPointerDown(e) {
  if (e.button === 2) return;                 // Rechtsklick: contextmenu
  closeMenus();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    // Zwei Finger: zoomen und verschieben
    clearTimeout(longPressTimer);
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...view } };
    drag = null;
    return;
  }
  if (pointers.size > 2) return;
  if (editing) commitEdit();
  const w = toWorld(e.clientX, e.clientY);

  if (linkMode) { finishLink(nodeAt(w.x, w.y)); return; }

  // kleine Schaltflächen am Knoten
  for (let i = LAY_ORDER.length - 1; i >= 0; i--) {
    const id = LAY_ORDER[i], L = LAY[id];
    if (hitCircle(L.toggleHit, w.x, w.y)) { toggleCollapse(id); return; }
    if (hitCircle(L.checkHit, w.x, w.y)) { selectOne(id); cycleStatus(id); return; }
    if (hitRect(L.voteHit, w.x, w.y) && phase() === 'order') { selectOne(id); castVote(id, e.altKey || e.shiftKey ? -1 : 1); return; }
  }

  const id = nodeAt(w.x, w.y);
  if (id) {
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (multi) {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      focusId = sel.has(id) ? id : (sel.size ? [...sel][sel.size - 1] : null);
      selLink = null;
      selectionChanged();
    } else if (!sel.has(id)) selectOne(id);
    else { focusId = id; selectionChanged(); }
    // Ctrl/⌘-Klick auf einen Knoten mit Link öffnet den Link
    if ((e.ctrlKey || e.metaKey) && doc.nodes[id].link) openNodeLink(id);
    drag = { type: 'pending', id, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, pointerType: e.pointerType };
    if (e.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => {
        if (drag && drag.type === 'pending') { drag = null; openMapMenu(w, e.clientX, e.clientY); }
      }, 550);
    }
    return;
  }
  const lid = linkAt(w.x, w.y);
  if (lid) {
    selLink = lid; sel = new Set(); focusId = null;
    selectionChanged();
    if (e.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => openMapMenu(w, e.clientX, e.clientY), 550);
    }
    return;
  }
  if (e.shiftKey) {
    drag = { type: 'rubber', sx: w.sx, sy: w.sy, cx: w.sx, cy: w.sy, add: true };
  } else {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, w, pointerType: e.pointerType };
    if (e.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => {
        if (drag && drag.type === 'pan' && !drag.moved) { drag = null; openMapMenu(w, e.clientX, e.clientY); }
      }, 600);
    }
  }
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const r = canvas.getBoundingClientRect();
    const z = Math.max(0.15, Math.min(4, pinch.view.z * d / pinch.d));
    const k = z / pinch.view.z;
    const cx = pinch.mx - r.left, cy = pinch.my - r.top;
    view.z = z;
    view.x = cx - (cx - pinch.view.x) * k + (mx - pinch.mx);
    view.y = cy - (cy - pinch.view.y) * k + (my - pinch.my);
    requestRender();
    return;
  }
  const w = toWorld(e.clientX, e.clientY);
  if (!drag) {
    if (linkMode) { linkMode.x = w.x; linkMode.y = w.y; requestRender(); return; }
    if (e.pointerType === 'mouse') {
      const h = nodeAt(w.x, w.y);
      let overToggle = false;
      for (const id of LAY_ORDER) if (hitCircle(LAY[id].toggleHit, w.x, w.y) || hitRect(LAY[id].voteHit, w.x, w.y)) { overToggle = id; break; }
      const nh = overToggle || h || null;
      if (nh !== hoverId) { hoverId = nh; requestRender(); }
      canvas.style.cursor = overToggle ? 'pointer' : h ? 'default' : (linkAt(w.x, w.y) ? 'pointer' : 'grab');
      if (h && doc.nodes[h] && doc.nodes[h].note) showNoteTip(h, e.clientX, e.clientY); else hideNoteTip();
    }
    return;
  }
  hideNoteTip();
  const mdist = Math.hypot(e.clientX - (drag.sx || 0), e.clientY - (drag.sy || 0));
  if (drag.type === 'pending' && mdist > 6) {
    clearTimeout(longPressTimer);
    const ids = topSelected().filter(id => !isRoot(id) && id !== layoutRoot);
    if (!ids.length) {
      // Zentralthema ziehen = Fläche verschieben
      drag = { type: 'pan', sx: drag.sx, sy: drag.sy, vx: view.x, vy: view.y, moved: true };
    } else {
      if (readOnly) { drag = null; return; }
      const ex = new Set();
      for (const id of ids) for (const d of descendants(id, true)) ex.add(d);
      drag = { type: 'node', ids, ex, wx: drag.wx, wy: drag.wy, dx: 0, dy: 0, moved: true, drop: null };
    }
  }
  if (drag.type === 'node') {
    drag.dx = w.x - drag.wx; drag.dy = w.y - drag.wy;
    const t = nodeAt(w.x, w.y, drag.ex);
    if (t) {
      const L = LAY[t];
      const rel = (w.y - (L.y - L.h / 2)) / L.h;
      let mode = 'child';
      if (!isRoot(t) && !L.orgHead && rel < 0.28) mode = 'before';
      else if (!isRoot(t) && !L.orgHead && rel > 0.72) mode = 'after';
      drag.drop = { id: t, mode };
    } else drag.drop = { id: null, mode: 'free' };
    requestRender();
  } else if (drag.type === 'pan') {
    if (mdist > 4) { drag.moved = true; clearTimeout(longPressTimer); }
    view.x = drag.vx + (e.clientX - drag.sx);
    view.y = drag.vy + (e.clientY - drag.sy);
    canvas.style.cursor = 'grabbing';
    requestRender();
  } else if (drag.type === 'rubber') {
    drag.cx = w.sx; drag.cy = w.sy;
    requestRender();
  }
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
  const d = drag;
  drag = null;
  if (!d) return;
  const w = toWorld(e.clientX, e.clientY);
  if (d.type === 'pending') {
    // Doppeltippen (Touch) = bearbeiten
    if (d.pointerType !== 'mouse') {
      const now = Date.now();
      if (lastTap.id === d.id && now - lastTap.t < 380) { lastTap = { t: 0 }; startEdit(d.id, { caretEnd: true }); return; }
      lastTap = { t: now, id: d.id };
    }
    requestRender();
    return;
  }
  if (d.type === 'node') { dropNodes(d, w); return; }
  if (d.type === 'pan') {
    canvas.style.cursor = 'grab';
    if (!d.moved) {
      if (d.pointerType !== 'mouse') {
        const now = Date.now();
        if (lastTap.id === '__bg' && now - lastTap.t < 380) { lastTap = { t: 0 }; newBranchAt(); return; }
        lastTap = { t: now, id: '__bg' };
      }
      if (sel.size || selLink) select([]);
    }
    return;
  }
  if (d.type === 'rubber') {
    const a = toWorld(0, 0);
    const r = canvas.getBoundingClientRect();
    const x0 = (Math.min(d.sx, d.cx) - view.x) / view.z, x1 = (Math.max(d.sx, d.cx) - view.x) / view.z;
    const y0 = (Math.min(d.sy, d.cy) - view.y) / view.z, y1 = (Math.max(d.sy, d.cy) - view.y) / view.z;
    void a; void r;
    const hit = LAY_ORDER.filter(id => {
      const L = LAY[id];
      return L.x + L.w / 2 >= x0 && L.x - L.w / 2 <= x1 && L.y + L.h / 2 >= y0 && L.y - L.h / 2 <= y1;
    });
    select([...sel, ...hit]);
  }
}

function onPointerCancel(e) {
  clearTimeout(longPressTimer);
  pointers.delete(e.pointerId);
  pinch = null; drag = null;
  requestRender();
}

function dropNodes(d, w) {
  const drop = d.drop || { mode: 'free' };
  const ids = d.ids;
  if (drop.id && drop.mode === 'child') {
    mutate('Verschieben', () => { for (const id of ids) moveNode(id, drop.id, null); });
  } else if (drop.id && (drop.mode === 'before' || drop.mode === 'after')) {
    const p = parentOf(drop.id);
    mutate('Verschieben', () => {
      let pos = kids(p).filter(x => !ids.includes(x)).indexOf(drop.id) + (drop.mode === 'after' ? 1 : 0);
      for (const id of ids) {
        moveNode(id, p, pos++);
        if (isRoot(p) && LAY[drop.id] && LAY[drop.id].side && M().layout === 'map') doc.nodes[id].side = LAY[drop.id].side;
      }
    });
  } else if (Math.hypot(d.dx, d.dy) > 3) {
    // frei verschieben
    const rid = index().rid;
    mutate('Position', () => {
      for (const id of ids) {
        const n = doc.nodes[id];
        if (M().layout === 'map' && parentOf(id) === rid && !layoutRoot) {
          const side = w.x < (LAY[rid] ? LAY[rid].x : 0) ? 'L' : 'R';
          const cur = LAY[id] ? LAY[id].side : null;
          if (side !== cur) { n.side = side; delete n.dx; delete n.dy; continue; }
        }
        n.dx = Math.round((n.dx || 0) + d.dx);
        n.dy = Math.round((n.dy || 0) + d.dy);
      }
    });
  }
  requestRender(true);
}

function onDblClick(e) {
  const w = toWorld(e.clientX, e.clientY);
  const id = nodeAt(w.x, w.y);
  if (id) { startEdit(id, { caretEnd: true }); return; }
  const lid = linkAt(w.x, w.y);
  if (lid) { editLinkLabel(lid); return; }
  newBranchAt();
}

function newBranchAt() {
  if (readOnly) return;
  const root = layoutRoot || index().rid;
  let nid = null;
  mutate('Neuer Hauptast', () => { nid = createChild(root, ''); });
  if (nid) startEdit(nid, { fresh: true });
}

// ── Notiz-Tooltip ───────────────────────────────────────────────────
let noteTipEl = null, noteTipId = null;
function showNoteTip(id, cx, cy) {
  if (!noteTipEl) noteTipEl = document.getElementById('note-tip');
  if (!noteTipEl) return;
  if (noteTipId !== id) { noteTipEl.textContent = doc.nodes[id].note; noteTipId = id; }
  noteTipEl.style.display = 'block';
  noteTipEl.style.left = Math.min(window.innerWidth - 300, cx + 14) + 'px';
  noteTipEl.style.top = (cy + 16) + 'px';
}
function hideNoteTip() { if (noteTipEl) noteTipEl.style.display = 'none'; noteTipId = null; }

function openNodeLink(id) {
  const href = doc.nodes[id] && doc.nodes[id].link;
  if (!href) return;
  const url = /^[a-z]+:/i.test(href) ? href : 'https://' + href;
  if (!/^(https?|mailto):/i.test(url)) { flashStatus('Nur http(s)- und mailto-Links werden geöffnet'); return; }
  window.open(url, '_blank', 'noopener');
}

// ════════════════════════════════════════════════════════════════════
// Kontextmenü
// ════════════════════════════════════════════════════════════════════
function openMapMenu(w, cx, cy) {
  if (editing) commitEdit();
  const id = nodeAt(w.x, w.y);
  const lid = id ? null : linkAt(w.x, w.y);
  if (id) {
    if (!sel.has(id)) selectOne(id);
    showMenu(cx, cy, nodeMenuItems(id));
  } else if (lid) {
    selLink = lid; sel = new Set(); focusId = null; selectionChanged();
    showMenu(cx, cy, [
      { label: 'Beschriften …', act: () => editLinkLabel(lid) },
      { label: 'Richtung umkehren', act: () => mutate('Richtung', () => { const l = doc.links[lid]; [l.from, l.to] = [l.to, l.from]; }) },
      { label: 'Stärker gebogen', act: () => mutate('Biegung', () => { const l = doc.links[lid]; l.bend = Math.min(0.8, (l.bend == null ? 0.22 : l.bend) + 0.15); }) },
      { label: 'Weniger gebogen', act: () => mutate('Biegung', () => { const l = doc.links[lid]; l.bend = Math.max(-0.8, (l.bend == null ? 0.22 : l.bend) - 0.15); }) },
      { sep: true },
      { label: 'Verbindung löschen', danger: true, act: () => { selLink = lid; deleteSelection(); } },
    ]);
  } else {
    showMenu(cx, cy, [
      { label: 'Neuer Hauptast', key: 'Doppelklick', act: newBranchAt },
      { label: 'Einfügen', key: kbd('V'), act: pasteFromApp },
      { sep: true },
      { label: 'Alles einpassen', key: kbd('0'), act: () => fitView() },
      { label: 'Alles aufklappen', act: expandAll },
      { label: 'Nur Hauptäste zeigen', act: () => collapseToLevel(1) },
      { label: 'Positionen zurücksetzen', act: resetPositions },
    ]);
  }
}

function kbd(k) { return (IS_MAC ? '⌘' : 'Strg+') + k; }
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function nodeMenuItems(id) {
  const n = doc.nodes[id];
  const root = isRoot(id);
  const items = [
    { label: 'Bearbeiten', key: 'F2', act: () => startEdit(id, { caretEnd: true }) },
    { label: 'Unterpunkt hinzufügen', key: 'Tab', act: () => addChild(id) },
  ];
  if (!root) items.push({ label: 'Nachbar hinzufügen', key: 'Enter', act: () => addSibling(id) });
  items.push({ sep: true });
  items.push({
    row: 'Status', chips: [
      { label: '—', title: 'keine Aufgabe', on: !n.task, act: () => mutate('Aufgabe', () => { for (const k of sel) { delete doc.nodes[k].task; delete doc.nodes[k].status; } }) },
      ...STATUS.map(s => ({ label: s.label, on: n.task && (n.status || 'todo') === s.key, act: () => mutate('Status', () => { for (const k of sel) { doc.nodes[k].task = true; doc.nodes[k].status = s.key; } }) })),
    ],
  });
  items.push({
    row: 'Priorität', chips: PRIOS.map(p => ({
      label: p.key ? p.label : '—', dot: p.key ? T().prio[p.key] : null, on: (n.prio || 0) === p.key,
      act: () => mutate('Priorität', () => { for (const k of sel) { if (p.key) doc.nodes[k].prio = p.key; else delete doc.nodes[k].prio; } }),
    })),
  });
  items.push({
    row: 'Farbe', chips: [{ label: '—', on: !n.color, act: () => mutate('Farbe', () => { for (const k of sel) delete doc.nodes[k].color; }) },
      ...NODE_COLORS.map(c => ({ swatch: colorValue(c), on: n.color === c, act: () => mutate('Farbe', () => { for (const k of sel) doc.nodes[k].color = c; }) }))],
  });
  items.push({ sep: true });
  if (kids(id).length && !root) items.push({ label: n.collapsed ? 'Aufklappen' : 'Einklappen', key: 'Leertaste', act: () => toggleCollapse(id) });
  items.push({ label: layoutRoot === id ? 'Fokus beenden' : 'Fokus auf diesen Ast', key: kbd('E'), act: () => toggleFocusMode(id), safe: true });
  items.push({ label: 'Querverbindung zu …', act: () => startLinkMode(id) });
  items.push({ label: n.boundary != null ? 'Rahmen entfernen' : 'Rahmen um Ast', act: () => toggleBoundary(id) });
  if (sel.size > 1) items.push({ label: 'Markierte gruppieren', key: kbd('G'), act: groupSelection });
  if (kids(id).length > 1) {
    items.push({ label: 'Unterpunkte sortieren: A–Z', act: () => sortChildren(id, 'alpha') });
    if (phase() !== 'collect') items.push({ label: 'Unterpunkte sortieren: nach Punkten', act: () => sortChildren(id, 'votes') });
  }
  if (!root && (n.dx || n.dy)) items.push({ label: 'Position zurücksetzen', act: () => mutate('Position', () => { delete doc.nodes[id].dx; delete doc.nodes[id].dy; }) });
  if (!root) {
    items.push({ label: 'Duplizieren', key: kbd('D'), act: duplicateSelection });
    items.push({ sep: true });
    items.push({ label: 'Löschen', key: 'Entf', danger: true, act: deleteSelection });
  }
  return items;
}

function toggleBoundary(id) {
  const n = doc.nodes[id];
  if (n.boundary != null) { mutate('Rahmen entfernen', () => { delete doc.nodes[id].boundary; }); return; }
  showPrompt('Rahmen um den Ast', 'Beschriftung (darf leer bleiben)', '', v => {
    if (v === null) return;
    mutate('Rahmen', () => { doc.nodes[id].boundary = v.trim(); });
  });
}

function sortChildren(id, how) {
  const list = kids(id);
  const key = c => how === 'votes' ? -votesOf(c) : how === 'prio' ? (doc.nodes[c].prio || 9) : label(c).toLowerCase();
  const sorted = [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka < kb) return -1; if (ka > kb) return 1;
    return list.indexOf(a) - list.indexOf(b);
  });
  mutate('Sortieren', () => { sorted.forEach((c, i) => { doc.nodes[c].order = i + 1; }); });
}

function toggleFocusMode(id) {
  id = id || primary();
  if (layoutRoot && (!id || id === layoutRoot)) { layoutRoot = null; }
  else if (id && !isRoot(id)) { layoutRoot = id; selectOne(id); }
  else layoutRoot = null;
  updateFocusBar();
  needLayout = true;
  layoutMap(); needLayout = false;
  fitView();
}

function updateFocusBar() {
  const bar = document.getElementById('focus-bar');
  if (!bar) return;
  if (layoutRoot && doc.nodes[layoutRoot]) {
    bar.style.display = 'flex';
    const path = [...ancestors(layoutRoot).reverse(), layoutRoot].map(a => label(a)).join(' › ');
    bar.querySelector('span').textContent = 'Fokus: ' + path;
  } else bar.style.display = 'none';
}

// ── Schwebende Knopfleiste am markierten Knoten (v. a. für Touch) ────
function positionNodeActions() {
  const bar = document.getElementById('node-actions');
  if (!bar) return;
  const id = primary();
  const show = id && sel.size === 1 && !editing && !(drag && drag.type === 'node') && LAY[id] && !readOnly && currentView === 'map' && !presentState;
  if (!show) { bar.style.display = 'none'; return; }
  // feste Leiste unten in der Mitte: verdeckt keine Nachbarknoten
  bar.style.display = 'flex';
  const lab = bar.querySelector('.na-label');
  if (lab) lab.textContent = label(id);
  const sib = bar.querySelector('[data-act="sibling"]');
  if (sib) sib.style.display = isRoot(id) ? 'none' : '';
  const task = bar.querySelector('[data-act="task"]');
  if (task) {
    const n = doc.nodes[id];
    task.textContent = !n.task ? '☐ Aufgabe' : n.status === 'done' ? '☑ erledigt' : n.status === 'doing' ? '◐ in Arbeit' : '○ offen';
  }
}

// ── Zwischenablage ──────────────────────────────────────────────────
function subtreeText(ids) {
  const lines = [];
  const walk = (id, d) => {
    const n = doc.nodes[id];
    const box = n.task ? (n.status === 'done' ? '[x] ' : n.status === 'doing' ? '[~] ' : '[ ] ') : '';
    lines.push('  '.repeat(d) + '- ' + box + (n.text || '').replace(/\n/g, ' '));
    for (const c of kids(id)) walk(c, d + 1);
  };
  for (const id of ids) walk(id, 0);
  return lines.join('\n');
}

function copySelection(e, cut) {
  const ids = topSelected();
  if (!ids.length) return false;
  appClipboard = extractSubtrees(ids.filter(id => !isRoot(id)).length ? ids.filter(id => !isRoot(id)) : ids);
  if (ids.length === 1 && isRoot(ids[0])) appClipboard = extractSubtrees(kids(ids[0]));
  appClipboardText = subtreeText(ids);
  if (e && e.clipboardData) { e.clipboardData.setData('text/plain', appClipboardText); e.preventDefault(); }
  else if (navigator.clipboard) navigator.clipboard.writeText(appClipboardText).catch(() => {});
  if (cut) deleteSelection();
  flashStatus(cut ? 'Ausgeschnitten' : 'Kopiert');
  return true;
}

function pasteText(text) {
  const target = primary() || layoutRoot || index().rid;
  let data = null;
  if (appClipboard && text != null && text.trim() === (appClipboardText || '').trim()) data = appClipboard;
  else if (text && text.trim()) data = parseIndentedText(text);
  else if (appClipboard && text == null) data = appClipboard;
  if (!data) return;
  let out = [];
  mutate('Einfügen', () => { out = insertSubtrees(data, target); });
  select(out);
  flashStatus(out.length === 1 ? 'Eingefügt' : `${out.length} Punkte eingefügt`);
}
function pasteFromApp() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(pasteText, () => pasteText(null));
  } else pasteText(null);
}

// ════════════════════════════════════════════════════════════════════
// Tastatur in der Mindmap
// ════════════════════════════════════════════════════════════════════
function mapKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const id = primary();

  if (k === 'Escape') {
    if (linkMode) { linkMode = null; canvas.style.cursor = ''; requestRender(); flashStatus('Abgebrochen'); return true; }
    if (searchHits) { closeSearch(); return true; }
    if (layoutRoot) { toggleFocusMode(null); return true; }
    if (sel.size || selLink) { select([]); return true; }
    return false;
  }
  if (mod && (k === '0' || e.code === 'Digit0')) { fitView(); return true; }
  if (mod && (k === '+' || k === '=')) { zoomBy(1.2); return true; }
  if (mod && k === '-') { zoomBy(1 / 1.2); return true; }
  if (mod && (k === 'e' || k === 'E')) { toggleFocusMode(id); return true; }
  if (mod && (k === 'g' || k === 'G')) { groupSelection(); return true; }
  if (mod && (k === 'd' || k === 'D')) { duplicateSelection(); return true; }
  if (mod && (k === 'a' || k === 'A')) { select(LAY_ORDER.slice()); return true; }
  if (mod && k === 'Enter') { cycleStatus(); return true; }
  if (mod && ['1', '2', '3'].includes(k)) { setPrio(Number(k)); return true; }
  if (mod && k === 'ArrowUp') { moveSibling(-1); return true; }
  if (mod && k === 'ArrowDown') { moveSibling(1); return true; }
  if (mod || e.altKey) return false;

  if (!id && !selLink) {
    if (k.startsWith('Arrow') || k === 'Enter' || k === 'Tab') { selectOne(layoutRoot || index().rid); return true; }
    // nichts markiert und losgetippt: bei leerer Mindmap das Zentralthema, sonst ein neuer Hauptast
    if ((k.length === 1 || k === 'Dead') && !readOnly) {
      const root = layoutRoot || index().rid;
      const fresh = !kids(root).length && ['Zentralthema', 'Thema', ''].includes((doc.nodes[root].text || '').trim());
      if (fresh) { startEdit(root, { replace: k === 'Dead' ? '' : k }); return true; }
      let nid = null;
      mutate('Neuer Hauptast', () => { nid = createChild(root, ''); });
      if (nid) startEdit(nid, { fresh: true, replace: k === 'Dead' ? '' : k });
      return true;
    }
    return false;
  }
  switch (k) {
    case 'Tab':
      if (e.shiftKey) outdent(); else addChild(id);
      return true;
    case 'Enter':
      if (selLink) { editLinkLabel(selLink); return true; }
      if (e.shiftKey) addSibling(id, true); else addSibling(id);
      return true;
    case 'Insert': addChild(id); return true;
    case 'F2': if (id) startEdit(id, { caretEnd: true }); return true;
    case 'Delete': case 'Backspace': deleteSelection(); return true;
    case ' ': if (id) toggleCollapse(id); return true;
    case 'ArrowLeft': navigate('left'); return true;
    case 'ArrowRight': navigate('right'); return true;
    case 'ArrowUp': navigate('up'); return true;
    case 'ArrowDown': navigate('down'); return true;
  }
  // Losschreiben überschreibt den Text des markierten Knotens
  if (id && sel.size === 1 && (k.length === 1 || k === 'Dead') && !readOnly) {
    startEdit(id, { replace: k === 'Dead' ? '' : k });
    return true;
  }
  return false;
}

// ── Suche ───────────────────────────────────────────────────────────
let searchIdx = 0;
function openSearch() {
  if (currentView !== 'map') switchView('map');
  const bar = document.getElementById('search-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  const inp = document.getElementById('search-input');
  inp.focus(); inp.select();
  runSearch(inp.value);
}
function runSearch(q) {
  q = (q || '').trim().toLowerCase();
  const info = document.getElementById('search-info');
  if (!q) { searchHits = new Set(); if (info) info.textContent = ''; requestRender(); return; }
  const hits = treeOrder().filter(id => {
    const n = doc.nodes[id];
    return (n.text || '').toLowerCase().includes(q) || (n.note || '').toLowerCase().includes(q) || (n.owner || '').toLowerCase().includes(q);
  });
  // eingeklappte Treffer sichtbar machen
  const hidden = hits.filter(id => ancestors(id).some(a => doc.nodes[a].collapsed));
  if (hidden.length) {
    mutate('Aufklappen', () => { for (const h of hidden) for (const a of ancestors(h)) delete doc.nodes[a].collapsed; }, { noUndo: true });
  }
  searchHits = new Set(hits);
  searchIdx = 0;
  if (info) info.textContent = hits.length ? `${hits.length} Treffer` : 'kein Treffer';
  if (hits.length) { layoutMap(); needLayout = false; ensureVisible(hits[0]); }
  requestRender(true);
}
function searchNext(back) {
  if (!searchHits || !searchHits.size) return;
  const list = treeOrder().filter(id => searchHits.has(id));
  searchIdx = (searchIdx + (back ? -1 : 1) + list.length) % list.length;
  const id = list[searchIdx];
  selectOne(id); ensureVisible(id);
  const info = document.getElementById('search-info');
  if (info) info.textContent = `${searchIdx + 1} / ${list.length}`;
}
function closeSearch() {
  searchHits = null;
  const bar = document.getElementById('search-bar');
  if (bar) bar.style.display = 'none';
  requestRender();
  if (canvas) canvas.focus();
}
