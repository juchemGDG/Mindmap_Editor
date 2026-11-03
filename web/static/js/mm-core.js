'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Kern
//
// Datenmodell, Änderungen als Operationen, Undo/Redo, Baum-Hilfen.
//
// Das Dokument besteht aus Sammlungen von Objekten mit ID:
//   doc.meta.m        Einstellungen der Mindmap (Titel, Layout, Phase …)
//   doc.nodes[id]     Knoten   {id, parent, order, text, …}
//   doc.links[id]     Querverbindungen {id, from, to, label}
//   doc.votes[id]     Punkte (Dot-Voting) {id, node, voter, n}
//   doc.columns[id]   Kanban-Spalten (Prozess-Modus) {id, order, title, statusKey, …}
//   doc.members[id]   Mitglieder (Kürzel) {id, name, color}
//   doc.events[id]    Protokoll (nur anhängen) {id, t, who, type, task, …}
//
// Jede Sammlung ist ein Objekt "ID → Eintrag" und KEINE Liste. Darum gehen
// beim gemeinsamen Bearbeiten keine Einträge verloren: zwei Personen legen
// verschiedene IDs an statt sich gegenseitig eine Liste zu überschreiben.
//
// JEDE Änderung läuft über mutate(). mutate() vergleicht den Stand vorher
// und nachher und erzeugt daraus Operationen auf Feldebene:
//   {c:'nodes', id, put:{…}}   Objekt neu anlegen
//   {c:'nodes', id, del:1}     Objekt löschen
//   {c:'nodes', id, set:{f:v}} einzelne Felder ändern (null = Feld löschen)
// Dieselben Operationen werden für Undo/Redo und für das gemeinsame
// Bearbeiten (mm-collab.js) verwendet. Dadurch überschreiben sich zwei
// Personen nur dann, wenn sie GLEICHZEITIG dasselbe Feld desselben Knotens
// ändern (der letzte gewinnt).
// ════════════════════════════════════════════════════════════════════

const APP_NAME       = 'Mindmap Editor';
const FORMAT         = 'mindmap-editor';
// Schema-Version der Datei: 1 = Version 1.0.0, 2 = mit Kanban-Prozess (Spalten, Mitglieder, Protokoll).
// Dateien mit Version 1 brauchen keine Umwandlung – die neuen Sammlungen sind dann einfach leer.
const FORMAT_VERSION = 2;
const COLLECTIONS    = ['meta', 'nodes', 'links', 'votes', 'columns', 'members', 'events'];

const PHASES = [
  { key: 'collect', label: 'Sammeln', hint: 'Ideen schnell festhalten – ohne Bewertung' },
  { key: 'order',   label: 'Ordnen',  hint: 'Gruppieren, verdichten, Punkte vergeben' },
  { key: 'plan',    label: 'Planen',  hint: 'Aufgaben, Zuständige und Termine festlegen' },
];
const STATUS = [
  { key: 'todo',  label: 'Offen' },
  { key: 'doing', label: 'In Arbeit' },
  { key: 'done',  label: 'Erledigt' },
];
const PRIOS = [
  { key: 0, label: 'keine' },
  { key: 1, label: 'hoch' },
  { key: 2, label: 'mittel' },
  { key: 3, label: 'niedrig' },
];
// einfarbige Symbole – passen zur zurückhaltenden Gestaltung (keine Emoji)
const ICONS = ['★', '!', '?', '✓', '✗', '⚑', '⚠', '♥', '☺', '✎', '⏱', '€', '☎', '✉', '⌂', '⚙', '➜', '∑', 'ℹ', '♪'];

let doc = emptyDoc();

// ── Grundlagen ──────────────────────────────────────────────────────
function uid(prefix) {
  return (prefix || 'n') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 8);
}
function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
function same(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;            // null und undefined gleich behandeln
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
function M() { return doc.meta.m; }

function defaultMeta() {
  return {
    id: 'm',
    title: '',              // leer = wie das Zentralthema
    layout: 'map',          // map | right | org
    lineStyle: 'curve',     // curve | straight | elbow
    branchColors: 'muted',  // neutral | muted
    phase: 'collect',       // collect | order | plan
    planMode: 'simple',     // simple | project
    voteLimit: 3,
    disabledRules: [],
  };
}

function emptyDoc(rootText) {
  const root = { id: 'root', parent: null, order: 0, text: rootText || 'Zentralthema' };
  return { meta: { m: defaultMeta() }, nodes: { root }, links: {}, votes: {}, columns: {}, members: {}, events: {} };
}

function rootId() {
  if (doc.nodes.root) return 'root';
  for (const id in doc.nodes) if (!doc.nodes[id].parent) return id;
  return null;
}

// ── Baum-Index (wird nach jeder Änderung neu aufgebaut) ─────────────
let idx = null;
function invalidate() { idx = null; }

function index() {
  if (idx) return idx;
  const children = {}, depth = {}, parentOf = {};
  const rid = rootId();
  for (const id in doc.nodes) children[id] = [];
  for (const id in doc.nodes) {
    const n = doc.nodes[id];
    if (id === rid) continue;
    let p = n.parent;
    // verwaiste Knoten (z. B. nach gleichzeitigem Löschen) hängen am Zentralthema
    if (!p || !doc.nodes[p] || p === id) p = rid;
    parentOf[id] = p;
  }
  // Zyklen auflösen (zwei Personen verschieben gleichzeitig A unter B und B unter A)
  for (const id in parentOf) {
    const seen = new Set([id]);
    let p = parentOf[id];
    while (p && p !== rid) {
      if (seen.has(p)) { parentOf[id] = rid; break; }
      seen.add(p); p = parentOf[p];
    }
  }
  for (const id in parentOf) if (children[parentOf[id]]) children[parentOf[id]].push(id);
  for (const id in children) {
    children[id].sort((a, b) => ((doc.nodes[a].order || 0) - (doc.nodes[b].order || 0)) || (a < b ? -1 : 1));
  }
  const walk = (id, d) => { depth[id] = d; for (const c of children[id] || []) walk(c, d + 1); };
  if (rid) walk(rid, 0);
  idx = { rid, children, depth, parentOf };
  return idx;
}

function kids(id)      { return index().children[id] || []; }
function parentOf(id)  { return index().parentOf[id] || null; }
function depthOf(id)   { return index().depth[id] || 0; }
function isRoot(id)    { return id === index().rid; }

function ancestors(id) {
  const out = [];
  let p = parentOf(id);
  while (p) { out.push(p); p = parentOf(p); }
  return out;
}
function isAncestor(a, b) { return ancestors(b).includes(a); }   // a über b?

function descendants(id, includeSelf) {
  const out = includeSelf ? [id] : [];
  const stack = [...kids(id)];
  while (stack.length) { const c = stack.pop(); out.push(c); stack.push(...kids(c)); }
  return out;
}

/** Hauptast (Ebene 1), zu dem ein Knoten gehört. */
function branchOf(id) {
  const rid = index().rid;
  if (id === rid) return null;
  let cur = id;
  while (parentOf(cur) && parentOf(cur) !== rid) cur = parentOf(cur);
  return cur;
}

function pathText(id, sep) {
  return ancestors(id).reverse().slice(1).map(a => label(a)).join(sep || ' › ');
}

/** Alle Knoten in Baumreihenfolge (Tiefensuche). */
function treeOrder(start) {
  const out = [];
  const walk = id => { out.push(id); for (const c of kids(id)) walk(c); };
  walk(start || index().rid);
  return out;
}

function label(id) {
  const n = doc.nodes[id];
  if (!n) return '';
  const t = (n.text || '').trim().replace(/\s+/g, ' ');
  return t || '(leer)';
}

/** Reihenfolge-Wert zwischen zwei Geschwistern (für gleichzeitiges Einfügen). */
function orderBetween(a, b) {
  if (a == null && b == null) return 1;
  if (a == null) return b - 1;
  if (b == null) return a + 1;
  return (a + b) / 2;
}
function orderAt(parent, pos) {
  const list = kids(parent);
  const prev = pos > 0 ? doc.nodes[list[pos - 1]].order || 0 : null;
  const next = pos < list.length ? doc.nodes[list[pos]].order || 0 : null;
  return orderBetween(prev, next);
}

// ── Aufgaben-Hilfen ─────────────────────────────────────────────────
function isTask(id) { const n = doc.nodes[id]; return !!(n && n.task); }
function statusOf(id) { const n = doc.nodes[id]; return (n && n.status) || 'todo'; }

/**
 * Zuständige eines Knotens als Liste. Mehrere Personen stehen durch Komma getrennt
 * im bisherigen Feld `owner` ("AB, CD") – so lesen auch ältere Versionen die Datei.
 */
function ownersOf(id) {
  const n = typeof id === 'string' ? doc.nodes[id] : id;
  if (!n || !n.owner) return [];
  return String(n.owner).split(',').map(s => s.trim()).filter(Boolean);
}
function setOwners(n, list) {
  const clean = [...new Set(list.map(s => String(s).replace(/,/g, ' ').trim()).filter(Boolean))];
  if (clean.length) n.owner = clean.join(', '); else delete n.owner;
}
/** Kürzel aller Zuständigen, z. B. "AB·CD". */
function ownerInitials(n) { return ownersOf(n).map(initials).join('·'); }

/** Fortschritt eines Knotens: erledigte/alle Aufgaben darunter (inkl. selbst). */
function progressOf(id) {
  let all = 0, done = 0;
  for (const d of descendants(id, false)) {
    if (isTask(d)) { all++; if (statusOf(d) === 'done') done++; }
  }
  return { all, done };
}

function votesOf(id) {
  let s = 0;
  for (const k in doc.votes) if (doc.votes[k].node === id) s += doc.votes[k].n || 0;
  return s;
}

// ── Datum (YYYY-MM-DD, ohne Zeitzonen-Fallen) ───────────────────────
function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
function fmtISO(d) {
  const p = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayISO() { return fmtISO(new Date()); }
function addDays(iso, n) { const d = parseDate(iso); if (!d) return null; d.setDate(d.getDate() + n); return fmtISO(d); }
function dayDiff(a, b) {   // b - a in Tagen
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}
function fmtShort(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}
function fmtLong(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ════════════════════════════════════════════════════════════════════
// Operationen
// ════════════════════════════════════════════════════════════════════
function coll(target, c) {
  if (!target[c]) target[c] = {};
  return target[c];
}

/** Eine Operation auf ein Dokument anwenden (lokal und auf dem Server gleich). */
function applyOp(target, op) {
  const col = coll(target, op.c);
  if (op.put) { col[op.id] = clone(op.put); return; }
  if (op.del) { delete col[op.id]; return; }
  if (op.set) {
    const o = col[op.id];
    if (!o) return;                       // inzwischen gelöscht: Änderung verfällt
    for (const f in op.set) {
      const v = op.set[f];
      if (v === null || v === undefined) delete o[f]; else o[f] = clone(v);
    }
  }
}

/** Unterschiede zweier Dokumente als Vorwärts- und Rückwärts-Operationen. */
function diffDocs(before, after) {
  const fwd = [], inv = [];
  for (const c of COLLECTIONS) {
    const A = before[c] || {}, B = after[c] || {};
    const ids = new Set([...Object.keys(A), ...Object.keys(B)]);
    for (const id of ids) {
      const a = A[id], b = B[id];
      if (a && !b) { fwd.push({ c, id, del: 1 }); inv.push({ c, id, put: clone(a) }); continue; }
      if (!a && b) { fwd.push({ c, id, put: clone(b) }); inv.push({ c, id, del: 1 }); continue; }
      const sf = {}, si = {};
      let changed = false;
      for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (same(a[f], b[f])) continue;
        sf[f] = b[f] === undefined ? null : clone(b[f]);
        si[f] = a[f] === undefined ? null : clone(a[f]);
        changed = true;
      }
      if (changed) { fwd.push({ c, id, set: sf }); inv.push({ c, id, set: si }); }
    }
  }
  return { fwd, inv: inv.reverse() };
}

// ── Änderungen, Undo/Redo ───────────────────────────────────────────
let undoStack = [];
let redoStack = [];
const UNDO_MAX = 200;
const changeListeners = [];   // Ansichten melden sich hier an
const opListeners = [];       // z. B. das gemeinsame Bearbeiten
let readOnly = false;         // "Nur ansehen"-Link
let suppressOps = false;

const commitHooks = [];       // laufen nach jeder eigenen Änderung, noch im selben Schritt

function onChange(fn) { changeListeners.push(fn); }
function onLocalOps(fn) { opListeners.push(fn); }

/**
 * Commit-Haken: fn(before, info) darf `doc` noch ergänzen, bevor verglichen wird.
 * So hängen sich der Kanban-Abgleich (Spalte ↔ Status) und das Protokoll an
 * JEDE Änderung – egal ob sie aus dem Kanban, dem Eigenschaften-Feld, dem Gantt
 * oder der Gliederung kommt. Die Oberfläche muss daran nicht denken.
 */
function onCommit(fn) { commitHooks.push(fn); }
function runCommitHooks(before, info) {
  for (const fn of commitHooks) fn(before, info);
  invalidate();
}

// Das Protokoll ist nur anhängbar: Rückgängig darf keine Einträge entfernen.
// Deshalb werden Operationen auf `events` aus den Rückgängig-Schritten herausgehalten.
const notEvent = op => op.c !== 'events';

/**
 * Das Dokument ändern. fn() verändert `doc` direkt; danach wird verglichen.
 * Gibt true zurück, wenn sich etwas geändert hat.
 */
function mutate(labelText, fn, opts) {
  if (readOnly) { flashStatus('Nur ansehen – Änderungen sind hier nicht möglich'); return false; }
  const before = clone(doc);
  try { fn(); invalidate(); runCommitHooks(before, { label: labelText, opts: opts || {} }); }
  catch (err) { doc = before; invalidate(); console.error(err); flashStatus('Fehler: ' + err.message); return false; }
  invalidate();
  const all = diffDocs(before, doc);
  if (!all.fwd.length) return false;
  const fwd = all.fwd.filter(notEvent), inv = all.inv.filter(notEvent);
  if (fwd.length && (!opts || !opts.noUndo)) {
    const last = undoStack[undoStack.length - 1];
    // gleiche Feldänderung kurz hintereinander zusammenfassen (z. B. Tippen im Inspektor)
    if (opts && opts.merge && last && last.merge === opts.merge && Date.now() - last.t < 1500) {
      last.fwd = mergeOps(last.fwd, fwd); last.t = Date.now();
    } else if (opts && opts.joinLast && last) {
      // gehört zum vorigen Schritt (z. B. neuer Knoten + sein Text = ein Rückgängig-Schritt)
      last.fwd = last.fwd.concat(fwd); last.inv = inv.concat(last.inv); last.t = Date.now();
    } else {
      undoStack.push({ label: labelText, fwd, inv, t: Date.now(), merge: opts && opts.merge });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
    }
    redoStack = [];
  }
  emitLocal(all.fwd);
  notifyChange({ local: true, label: labelText });
  return true;
}
function mergeOps(a, b) { return a.concat(b); }

/** Letzten Undo-Schritt verwerfen, wenn er nur einen inzwischen wieder entfernten Knoten betraf. */
function dropEmptyUndo() {
  const last = undoStack[undoStack.length - 1];
  if (!last) return;
  const created = new Set(last.fwd.filter(o => o.put).map(o => o.c + '|' + o.id));
  const gone = o => created.has(o.c + '|' + o.id) && !(doc[o.c] && doc[o.c][o.id]);
  const onlyCollapse = o => o.set && Object.keys(o.set).every(f => f === 'collapsed');
  if (last.fwd.some(gone) && last.fwd.every(o => gone(o) || onlyCollapse(o))) undoStack.pop();
}

function emitLocal(ops) {
  if (suppressOps) return;
  for (const fn of opListeners) fn(ops);
}

function notifyChange(info) {
  invalidate();
  for (const fn of changeListeners) {
    try { fn(info || {}); } catch (err) { console.error(err); }
  }
}

/** Rückgängig/Wiederholen: Operationen anwenden; die Commit-Haken protokollieren das als NEUE Einträge. */
function applyLocal(ops, labelText) {
  const before = clone(doc);
  for (const op of ops) applyOp(doc, op);
  invalidate();
  const mid = clone(doc);
  try { runCommitHooks(before, { label: labelText, opts: {}, undo: true }); } catch (err) { console.error(err); }
  const extra = diffDocs(mid, doc).fwd;
  emitLocal(ops.concat(extra));
  notifyChange({ local: true, label: labelText });
}

function undo() {
  if (readOnly) return;
  const e = undoStack.pop();
  if (!e) { flashStatus('Nichts rückgängig zu machen'); return; }
  applyLocal(e.inv, 'Rückgängig');
  redoStack.push(e);
  if (typeof updateUndoButtons === 'function') updateUndoButtons();   // erst jetzt ist „Wiederholen“ möglich
  flashStatus('Rückgängig: ' + e.label);
}
function redo() {
  if (readOnly) return;
  const e = redoStack.pop();
  if (!e) { flashStatus('Nichts zu wiederholen'); return; }
  applyLocal(e.fwd, 'Wiederholen');
  undoStack.push(e);
  if (typeof updateUndoButtons === 'function') updateUndoButtons();
  flashStatus('Wiederholt: ' + e.label);
}

/** Komplettes Dokument ersetzen (Laden, Neu, Vorlage). */
function replaceDoc(newDoc, opts) {
  const before = doc;
  doc = normalizeDoc(newDoc);
  invalidate();
  undoStack = []; redoStack = [];
  if (opts && opts.broadcast) {
    const { fwd } = diffDocs(before, doc);
    emitLocal(fwd);
  }
  notifyChange({ replaced: true });
}

/** Geladene Daten absichern: fehlende Felder ergänzen, Müll aussortieren. */
function normalizeDoc(d) {
  const out = emptyDoc();
  if (!d || typeof d !== 'object') return out;
  const src = d.doc && d.doc.nodes ? d.doc : d;      // Datei {format, doc} oder nackt
  if (src.meta && src.meta.m) Object.assign(out.meta.m, src.meta.m);
  out.meta.m.id = 'm';
  if (src.nodes && typeof src.nodes === 'object') {
    out.nodes = {};
    for (const id in src.nodes) {
      const n = src.nodes[id];
      if (!n || typeof n !== 'object') continue;
      out.nodes[id] = Object.assign({}, n, { id, text: String(n.text == null ? '' : n.text) });
      if (typeof out.nodes[id].order !== 'number') out.nodes[id].order = 0;
    }
    if (!Object.keys(out.nodes).length) out.nodes = emptyDoc().nodes;
    // genau ein Zentralthema
    const roots = Object.keys(out.nodes).filter(id => !out.nodes[id].parent || !out.nodes[out.nodes[id].parent]);
    if (!roots.length) { const first = Object.keys(out.nodes)[0]; out.nodes[first].parent = null; }
    else {
      const keep = roots.includes('root') ? 'root' : roots[0];
      out.nodes[keep].parent = null;
      for (const r of roots) if (r !== keep) out.nodes[r].parent = keep;
    }
  }
  for (const c of COLLECTIONS.filter(c => c !== 'meta' && c !== 'nodes')) {
    out[c] = {};
    if (src[c] && typeof src[c] === 'object' && !Array.isArray(src[c])) {
      for (const id in src[c]) if (src[c][id] && typeof src[c][id] === 'object') out[c][id] = Object.assign({}, src[c][id], { id });
    }
  }
  for (const id in out.columns) {
    const col = out.columns[id];
    if (!['idea', 'todo', 'doing', 'done'].includes(col.statusKey)) col.statusKey = 'todo';
    if (typeof col.order !== 'number') col.order = 0;
    col.title = String(col.title == null ? '' : col.title);
  }
  // Sammlungen, die diese Version nicht kennt (aus einer neueren Version), nicht wegwerfen
  for (const c in src) {
    if (!COLLECTIONS.includes(c) && !(c in out) && src[c] && typeof src[c] === 'object') out[c] = clone(src[c]);
  }
  return out;
}

/**
 * Datei vor dem Öffnen prüfen. Gibt eine Liste verständlicher Meldungen zurück;
 * `fatal` = die Datei kann nicht geöffnet werden.
 */
function validateFile(p) {
  const errors = [], warnings = [];
  const src = p && p.doc && typeof p.doc === 'object' ? p.doc : p;
  if (!src || typeof src !== 'object') return { fatal: true, errors: ['Die Datei enthält keine Mindmap.'], warnings };
  if (!src.nodes || typeof src.nodes !== 'object' || Array.isArray(src.nodes)) errors.push('Der Datei fehlen die Punkte der Mindmap („nodes“).');
  if (p && typeof p.version === 'number' && p.version > FORMAT_VERSION) {
    warnings.push(`Die Datei stammt aus einer neueren Version des Mindmap Editors (Format ${p.version}). Unbekannte Teile bleiben erhalten, werden aber nicht angezeigt.`);
  }
  for (const c of ['columns', 'members', 'events']) {
    if (src[c] != null && (typeof src[c] !== 'object' || Array.isArray(src[c]))) warnings.push(`Der Teil „${c}“ hat ein falsches Format und wird ignoriert.`);
  }
  const STATUS_KEYS = ['idea', 'todo', 'doing', 'done'];
  if (src.columns && typeof src.columns === 'object') {
    for (const id in src.columns) {
      const col = src.columns[id];
      if (!col || typeof col !== 'object') { warnings.push(`Eine Kanban-Spalte (${id}) ist beschädigt und wird ignoriert.`); continue; }
      if (!STATUS_KEYS.includes(col.statusKey)) warnings.push(`Die Spalte „${col.title || id}“ hat keine gültige Status-Kategorie – sie wird als „Offen“ behandelt.`);
    }
  }
  if (src.nodes && typeof src.nodes === 'object') {
    for (const id in src.nodes) {
      const n = src.nodes[id];
      if (n && n.status && !['todo', 'doing', 'done'].includes(n.status)) warnings.push(`Der Punkt „${String(n.text || id).slice(0, 40)}“ hat einen unbekannten Status („${n.status}“) – er wird als „Offen“ angezeigt.`);
    }
  }
  return { fatal: errors.length > 0, errors, warnings };
}

function docPayload() {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    schemaVersion: FORMAT_VERSION,
    app: APP_NAME,
    savedAt: new Date().toISOString(),
    doc: clone(doc),
  };
}

// ════════════════════════════════════════════════════════════════════
// Häufige Bearbeitungsschritte (alle über mutate)
// ════════════════════════════════════════════════════════════════════
function newNodeObj(parent, order, text, extra) {
  const id = uid('n');
  doc.nodes[id] = Object.assign({ id, parent, order, text: text || '' }, extra || {});
  return id;
}

/** Kind am Ende (oder an Position pos) anlegen – innerhalb von mutate() aufrufen. */
function createChild(parent, text, pos, extra) {
  const list = kids(parent);
  const order = pos == null ? orderBetween(list.length ? doc.nodes[list[list.length - 1]].order || 0 : null, null) : orderAt(parent, pos);
  const id = newNodeObj(parent, order, text, extra);
  if (doc.nodes[parent] && doc.nodes[parent].collapsed) delete doc.nodes[parent].collapsed;
  invalidate();
  return id;
}

function createSibling(id, text, before) {
  const p = parentOf(id);
  if (!p) return createChild(id, text);
  const list = kids(p);
  const pos = list.indexOf(id) + (before ? 0 : 1);
  const extra = {};
  const n = doc.nodes[id];
  if (isRoot(p) && n.side) extra.side = n.side;
  return createChild(p, text, pos, extra);
}

/** Teilbaum löschen (inkl. Verbindungen und Punkte). */
function deleteSubtree(id) {
  if (isRoot(id)) return;
  const all = new Set(descendants(id, true));
  for (const d of all) delete doc.nodes[d];
  for (const l in doc.links) if (all.has(doc.links[l].from) || all.has(doc.links[l].to)) delete doc.links[l];
  for (const v in doc.votes) if (all.has(doc.votes[v].node)) delete doc.votes[v];
  for (const k in doc.nodes) {
    const deps = doc.nodes[k].deps;
    if (Array.isArray(deps) && deps.some(x => all.has(x))) {
      doc.nodes[k].deps = deps.filter(x => !all.has(x));
      if (!doc.nodes[k].deps.length) delete doc.nodes[k].deps;
    }
  }
  invalidate();
}

/** Knoten unter neuen Elternknoten an Position pos hängen. */
function moveNode(id, newParent, pos) {
  if (isRoot(id) || id === newParent || isAncestor(id, newParent)) return false;
  const n = doc.nodes[id];
  const list = kids(newParent).filter(x => x !== id);
  if (pos == null || pos > list.length) pos = list.length;
  const prev = pos > 0 ? doc.nodes[list[pos - 1]].order || 0 : null;
  const next = pos < list.length ? doc.nodes[list[pos]].order || 0 : null;
  n.parent = newParent;
  n.order = orderBetween(prev, next);
  delete n.dx; delete n.dy;
  if (!isRoot(newParent)) delete n.side;
  if (doc.nodes[newParent].collapsed) delete doc.nodes[newParent].collapsed;
  invalidate();
  return true;
}

/** Teilbaum (Knoten + Nachfahren + interne Verbindungen) kopieren. */
function extractSubtrees(ids) {
  const set = new Set();
  for (const id of ids) for (const d of descendants(id, true)) set.add(d);
  const top = ids.filter(id => !ids.some(o => o !== id && isAncestor(o, id)));
  const nodes = {};
  for (const id of set) nodes[id] = clone(doc.nodes[id]);
  const links = {};
  for (const l in doc.links) if (set.has(doc.links[l].from) && set.has(doc.links[l].to)) links[l] = clone(doc.links[l]);
  return { kind: 'mindmap-subtrees', top, nodes, links };
}

/** Kopierte Teilbäume unter parent einfügen; neue IDs. Gibt neue Wurzel-IDs zurück. */
function insertSubtrees(data, parent) {
  const map = {};
  for (const id in data.nodes) map[id] = uid('n');
  const out = [];
  for (const top of data.top) {
    const src = data.nodes[top];
    if (!src) continue;
    const walk = (oldId, newParent, order) => {
      const s = clone(data.nodes[oldId]);
      const nid = map[oldId];
      s.id = nid; s.parent = newParent; s.order = order;
      delete s.dx; delete s.dy;
      if (newParent !== parent || !isRoot(parent)) delete s.side;
      if (Array.isArray(s.deps)) { s.deps = s.deps.map(d => map[d]).filter(Boolean); if (!s.deps.length) delete s.deps; }
      doc.nodes[nid] = s;
      const ch = Object.keys(data.nodes).filter(k => data.nodes[k].parent === oldId)
        .sort((a, b) => (data.nodes[a].order || 0) - (data.nodes[b].order || 0));
      ch.forEach((c, i) => walk(c, nid, i + 1));
      return nid;
    };
    invalidate();
    const list = kids(parent);
    const last = list.length ? doc.nodes[list[list.length - 1]].order || 0 : 0;
    out.push(walk(top, parent, last + 1 + out.length));
  }
  for (const l in data.links) {
    const L = data.links[l];
    const id = uid('l');
    doc.links[id] = Object.assign({}, L, { id, from: map[L.from], to: map[L.to] });
  }
  invalidate();
  return out;
}

/** Eingerückten Text (Listen, Markdown-Aufzählungen) als Teilbaum-Daten lesen. */
function parseIndentedText(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const exp = raw.replace(/\t/g, '    ');
    let indent = exp.match(/^\s*/)[0].length;
    let t = exp.trim();
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    let task = null;
    if (h) { indent = (h[1].length - 1) * -100 - 1000; t = h[2]; }   // Überschriften stehen über Listen
    t = t.replace(/^([-*+•]|\d+[.)])\s+/, '');
    const cb = t.match(/^\[( |x|X|~|-)\]\s+(.*)$/);
    if (cb) { task = cb[1] === ' ' ? 'todo' : (cb[1] === '~' || cb[1] === '-') ? 'doing' : 'done'; t = cb[2]; }
    items.push({ indent, text: t, task, heading: !!h });
  }
  if (!items.length) return null;
  // Einrückung in Ebenen umrechnen
  const nodes = {}, top = [];
  const stack = [];   // {indent, id}
  let order = 0;
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].indent >= it.indent) stack.pop();
    const id = uid('t');
    const parent = stack.length ? stack[stack.length - 1].id : null;
    nodes[id] = { id, parent, order: ++order, text: it.text };
    if (it.task) { nodes[id].task = true; nodes[id].status = it.task; }
    if (!parent) top.push(id);
    stack.push({ indent: it.indent, id });
  }
  return { kind: 'mindmap-subtrees', top, nodes, links: {} };
}

// Statuszeile (wird in mm-app.js mit dem DOM verbunden)
let statusEl = null;
let statusTimer = null;
function flashStatus(msg, ms) {
  if (!statusEl) statusEl = document.getElementById('status');
  if (!statusEl) return;
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { if (typeof updateStatus === 'function') updateStatus(); }, ms || 3500);
}
