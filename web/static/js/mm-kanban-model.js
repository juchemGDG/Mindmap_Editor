'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Kanban-Prozess: Datenmodell und Protokoll
// (die Oberfläche dazu steht in mm-kanban.js)
//
// Alles hier gilt nur im Kanban-Modus „Prozess“. Im Modus „einfach“
// verhält sich das Kanban wie in Version 1.0.0 (mm-views.js).
//
// GRUNDREGEL Spalte ↔ Status
//   Jede Spalte gehört zu einer Status-Kategorie (statusKey):
//     idea  = noch keine Aufgabe (wie die alte Spalte „Ideen“)
//     todo  = Offen,  doing = In Arbeit,  done = Erledigt
//   • Die Spalte (node.columnId) ist die Wahrheit für die Darstellung im Kanban.
//   • Der Status (node.status) bleibt die Wahrheit für alle anderen Ansichten
//     (Zeitplan, Gantt, Exporte, Prüfregeln, Automatisch planen).
//   • Wird eine Karte verschoben, setzt der Abgleich den Status passend zur Spalte.
//   • Ändert sich der Status woanders (Eigenschaften-Feld, Gantt, Gliederung),
//     wählt der Abgleich eine Spalte dieser Kategorie – bei mehreren die zuletzt
//     benutzte (laut Protokoll), sonst die erste.
//   Beides passiert in kanbanReconcile(), das sich an JEDE Änderung hängt
//   (onCommit in mm-core.js) – darum ist es auch Teil desselben Rückgängig-Schritts.
//
// PROTOKOLL (doc.events)
//   auditHook() vergleicht vorher/nachher und schreibt Einträge für alle
//   AUFGABENBEZOGENEN Änderungen – unabhängig davon, in welcher Ansicht sie
//   gemacht wurden. Reine Mindmap-Arbeit (Ideen, Layout, Farben von Ideen)
//   wird nicht protokolliert (Datensparsamkeit). Einträge werden nie geändert
//   oder gelöscht (außer bewusst über „Projekt abschließen“).
// ════════════════════════════════════════════════════════════════════

const KANBAN_STATUS = [
  { key: 'idea',  label: 'Ideen (noch keine Aufgabe)' },
  { key: 'todo',  label: 'Offen' },
  { key: 'doing', label: 'In Arbeit' },
  { key: 'done',  label: 'Erledigt' },
];
const DEFAULT_COLUMNS = [
  { title: 'Backlog',   statusKey: 'todo' },
  { title: 'Geplant',   statusKey: 'todo' },
  { title: 'In Arbeit', statusKey: 'doing', wip: 3 },
  { title: 'Review',    statusKey: 'doing', wip: 2 },
  { title: 'Erledigt',  statusKey: 'done' },
];
const ESTIMATES = [
  { key: 'S', label: 'S', title: 'klein (bis 1 Stunde)' },
  { key: 'M', label: 'M', title: 'mittel (eine Doppelstunde)' },
  { key: 'L', label: 'L', title: 'groß (mehrere Stunden)' },
];
const WIP_QUESTION = 'Was hindert euch, etwas abzuschließen, bevor ihr Neues beginnt?';
const BLOCK_DAYS = 3;      // K03: ab so vielen Tagen gilt eine Karte als „lange blockiert“

function kanbanProcess() { return M().kanbanMode === 'process'; }

// ── Spalten ─────────────────────────────────────────────────────────
function boardColumns() {
  return Object.values(doc.columns || {}).sort((a, b) => ((a.order || 0) - (b.order || 0)) || (a.id < b.id ? -1 : 1));
}
function columnsOfStatus(key) { return boardColumns().filter(c => c.statusKey === key); }
function statusLabel(key) { const s = KANBAN_STATUS.find(x => x.key === key); return s ? s.label : key; }

/** Status-Kategorie eines Knotens: idea, todo, doing oder done. */
function cardCategory(n) {
  if (!n || !n.task) return 'idea';
  return ['todo', 'doing', 'done'].includes(n.status) ? n.status : 'todo';
}

/** Zuletzt benutzte Spalte einer Kategorie (aus dem Protokoll), sonst null. */
function lastUsedColumnId(statusKey) {
  let best = null, bestT = -1;
  for (const id in doc.events || {}) {
    const e = doc.events[id];
    if (!e.toCol || (e.type !== 'task.moved' && e.type !== 'task.created')) continue;
    const c = doc.columns[e.toCol];
    if (c && c.statusKey === statusKey && (e.t || 0) > bestT) { best = e.toCol; bestT = e.t || 0; }
  }
  return best;
}

/** Spalte, in die eine Karte dieser Kategorie kommt, wenn sie keine (passende) hat. */
function defaultColumnFor(statusKey) {
  const list = columnsOfStatus(statusKey);
  if (list.length <= 1) return list[0] || null;
  const last = lastUsedColumnId(statusKey);
  return list.find(c => c.id === last) || list[0];
}

/** In welcher Spalte steht diese Karte? (nur lesen – ändert nichts) */
function columnFor(n) {
  const cat = cardCategory(n);
  const c = n.columnId && doc.columns[n.columnId];
  if (c && c.statusKey === cat) return c;
  return defaultColumnFor(cat);
}

/** Karten je Spalte: Map Spalten-ID → Knoten-IDs (in Baumreihenfolge). */
function boardCards() {
  const cols = boardColumns();
  const map = new Map(cols.map(c => [c.id, []]));
  const ideaCols = cols.filter(c => c.statusKey === 'idea');
  for (const id of treeOrder()) {
    if (isRoot(id)) continue;
    const n = doc.nodes[id];
    if (n.task) {
      const c = columnFor(n) || cols[0];
      if (c) map.get(c.id).push(id);
    } else if (ideaCols.length && (!kids(id).length || (n.columnId && doc.columns[n.columnId]))) {
      // wie in 1.0.0: Ideen sind Endpunkte, die noch keine Aufgabe sind
      const c = ideaCols.find(x => x.id === n.columnId) || ideaCols[0];
      map.get(c.id).push(id);
    }
  }
  return map;
}

function colTitle(cols, id) { return id && cols && cols[id] ? cols[id].title : ''; }

/**
 * Spalte einer Karte in einem beliebigen Stand (vorher/nachher) – vereinfacht:
 * passende columnId, sonst die erste Spalte der Kategorie. Nur für den Vergleich im Protokoll.
 */
function shownColumnId(cols, n) {
  const cat = cardCategory(n);
  if (n.columnId && cols[n.columnId] && cols[n.columnId].statusKey === cat) return n.columnId;
  const list = Object.values(cols).filter(c => c.statusKey === cat).sort((x, y) => (x.order || 0) - (y.order || 0));
  return list.length ? list[0].id : null;
}

// ── Abgleich Spalte ↔ Status (läuft nach jeder eigenen Änderung) ────
function applyColumnStatus(n, col) {
  if (col.statusKey === 'idea') { delete n.task; delete n.status; }
  else { n.task = true; n.status = col.statusKey; }
}

function kanbanReconcile(before) {
  if (!doc.columns || !Object.keys(doc.columns).length) return;
  const B = before.nodes || {};
  for (const id in doc.nodes) {
    const n = doc.nodes[id], b = B[id];
    if (b && b.columnId === n.columnId && b.task === n.task && b.status === n.status) continue;   // unberührt
    const col = n.columnId ? doc.columns[n.columnId] : null;
    const columnChanged = col && (!b || b.columnId !== n.columnId);
    if (columnChanged) {
      applyColumnStatus(n, col);                 // die Spalte bestimmt den Status
    } else if (!col || col.statusKey !== cardCategory(n)) {
      if (!n.task) { delete n.columnId; continue; }
      const c = defaultColumnFor(cardCategory(n));   // Status wurde woanders geändert
      if (c) n.columnId = c.id; else delete n.columnId;
    }
  }
}

// ── Personen ────────────────────────────────────────────────────────
/** Wer gerade handelt: der Name aus „Ich bin …“ bzw. der gemeinsamen Sitzung. */
function currentPerson() { return myName() || ''; }
function setCurrentPerson(name) {
  try { if (name) localStorage.setItem('mm-name', cleanName(name)); else localStorage.removeItem('mm-name'); } catch (e) { /* egal */ }
  if (typeof collab !== 'undefined' && collab) scheduleSync(0);
}
/** Kürzel säubern: kein Komma (trennt mehrere Zuständige), höchstens 40 Zeichen. */
function cleanName(s) { return String(s || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); }

function boardMembers() {
  const s = new Set(knownOwners());
  return [...s].sort((a, b) => a.localeCompare(b, 'de'));
}
function memberByName(name) { return Object.values(doc.members || {}).find(m => m.name === name) || null; }
/** Mitglied anlegen (innerhalb von mutate aufrufen). */
function ensureMember(name) {
  name = cleanName(name);
  if (!name || memberByName(name)) return name;
  const id = uid('p');
  doc.members[id] = { id, name };
  return name;
}

// ── Tags, Blocker ───────────────────────────────────────────────────
function tagsOf(n) { return Array.isArray(n && n.tags) ? n.tags.filter(t => typeof t === 'string' && t) : []; }
function knownTags() {
  const s = new Set();
  for (const id in doc.nodes) for (const t of tagsOf(doc.nodes[id])) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b, 'de'));
}
function cleanTag(s) { return String(s || '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 30); }

/** Vorgänger, die noch nicht erledigt sind (vorhandenes Abhängigkeitsmodell). */
function blockersOf(id) {
  const n = doc.nodes[id];
  return (n && n.deps || []).filter(d => doc.nodes[d] && isTask(d) && statusOf(d) !== 'done');
}
function manualBlocked(n) { return !!(n && n.blocked && n.blocked.flag); }
function isBlocked(id) { return manualBlocked(doc.nodes[id]) || blockersOf(id).length > 0; }

/** Fortschritt der Unterpunkte (Checkliste): erledigt/alle direkten Unterpunkte. */
function checklistOf(id) {
  const ch = kids(id);
  return { all: ch.length, done: ch.filter(c => isTask(c) && statusOf(c) === 'done').length };
}

// ── WIP ─────────────────────────────────────────────────────────────
function wipCount(colId, cards) { return ((cards || boardCards()).get(colId) || []).length; }
function wipOver(col, cards) { return !!(col.wip && wipCount(col.id, cards) > col.wip); }

// ════════════════════════════════════════════════════════════════════
// Benannte Aktionen – alle laufen über mutate() und damit über Abgleich,
// Protokoll und Rückgängig.
// ════════════════════════════════════════════════════════════════════

/** Kanban-Modus umschalten; beim ersten Mal das Standard-Board anlegen. */
function setKanbanMode(mode) {
  const on = mode === 'process';
  if (on === kanbanProcess()) return;
  if (!on) { mutate('Kanban-Modus: einfach', () => { delete M().kanbanMode; }); return; }
  mutate('Kanban-Modus: Prozess', () => {
    M().kanbanMode = 'process';
    if (!M().kanbanId) M().kanbanId = uid('b');
    if (!boardColumns().length) createBoard(DEFAULT_COLUMNS);
    for (const name of knownOwners()) ensureMember(name);
  }, { noDerive: true, events: [{ type: 'board.process' }] });
}

/**
 * Spalten anlegen und vorhandene Aufgaben einsortieren (Migration aus 1.0.0):
 * jede Aufgabe kommt in die erste Spalte ihres Status. Innerhalb von mutate aufrufen.
 */
function createBoard(cols) {
  cols.forEach((c, i) => {
    const id = uid('k');
    doc.columns[id] = Object.assign({ id, order: i + 1, title: c.title, statusKey: c.statusKey }, c.wip ? { wip: c.wip } : {},
      c.color ? { color: c.color } : {}, Array.isArray(c.dod) && c.dod.length ? { dod: c.dod.slice() } : {});
  });
  for (const id in doc.nodes) {
    const n = doc.nodes[id];
    if (!n.task) continue;
    const c = columnsOfStatus(cardCategory(n))[0];
    if (c) n.columnId = c.id;
  }
}

/**
 * Karte in eine Spalte verschieben. opts.dod = {checked, total}: die Definition of Done
 * der Zielspalte wurde im Dialog bestätigt (wird protokolliert).
 */
function moveCard(id, colId, opts) {
  const n = doc.nodes[id], col = doc.columns[colId];
  if (!n || !col) return false;
  const was = columnFor(n);
  if (was && was.id === colId && (col.statusKey !== 'idea' || !n.task)) return false;
  const events = [];
  if (opts && opts.dod) {
    events.push({ type: 'dod.confirmed', task: id, title: label(id), col: colId,
      to: `${col.title}: ${opts.dod.checked} von ${opts.dod.total} Kriterien bestätigt` });
  }
  const ok = mutate(`Karte nach „${col.title}“`, () => { doc.nodes[id].columnId = colId; }, events.length ? { events } : undefined);
  if (ok) wipWarn(col);
  return ok;
}

/** Braucht das Verschieben dieser Karte in diese Spalte eine Bestätigung der Definition of Done? */
function needsDod(id, colId) {
  const n = doc.nodes[id], col = doc.columns[colId];
  if (!n || !col || !Array.isArray(col.dod) || !col.dod.length) return false;
  const was = columnFor(n);
  return !(was && was.id === colId);
}

/** Neue Karte: legt wie bisher einen Aufgaben-Knoten im gewählten Ast an. */
function createCard(colId, text, parent, tags) {
  const col = doc.columns[colId];
  if (!col || !text || !text.trim()) return null;
  let nid = null;
  mutate('Neue Karte', () => {
    const extra = { columnId: colId };
    if (col.statusKey !== 'idea') { extra.task = true; extra.status = col.statusKey; }
    if (tags && tags.length) extra.tags = tags.slice();
    nid = createChild(parent, text.trim(), null, extra);
  });
  wipWarn(col);
  return nid;
}

function addColumn(title, statusKey) {
  const last = boardColumns().slice(-1)[0];
  let id = null;
  mutate('Spalte anlegen', () => {
    id = uid('k');
    doc.columns[id] = { id, order: (last ? last.order || 0 : 0) + 1, title: title || 'Neue Spalte', statusKey: statusKey || 'todo' };
  });
  return id;
}

/** Felder einer Spalte ändern. Gibt eine Fehlermeldung zurück oder ''. */
function updateColumn(id, fields, mergeKey) {
  const col = doc.columns[id];
  if (!col) return 'Diese Spalte gibt es nicht mehr.';
  if (fields.statusKey && fields.statusKey !== col.statusKey && col.statusKey !== 'idea' && columnsOfStatus(col.statusKey).length === 1) {
    return `Für „${statusLabel(col.statusKey)}“ muss es mindestens eine Spalte geben. Lege zuerst eine weitere an.`;
  }
  mutate('Spalte ändern', () => {
    const c = doc.columns[id];
    for (const f in fields) {
      const v = fields[f];
      if (v === null || v === '' || v === undefined || (f === 'wip' && !v)) delete c[f]; else c[f] = v;
    }
    // Karten folgen der neuen Kategorie: ihr Status ändert sich mit
    if (fields.statusKey) for (const nid in doc.nodes) if (doc.nodes[nid].columnId === id) applyColumnStatus(doc.nodes[nid], c);
  }, mergeKey ? { merge: 'col:' + id + ':' + mergeKey } : undefined);
  return '';
}

/** Spalte an Position pos (0 = ganz links) setzen. */
function moveColumn(id, pos) {
  const list = boardColumns().filter(c => c.id !== id);
  pos = Math.max(0, Math.min(list.length, pos));
  const prev = pos > 0 ? list[pos - 1].order || 0 : null;
  const next = pos < list.length ? list[pos].order || 0 : null;
  const cur = boardColumns().findIndex(c => c.id === id);
  if (cur === pos) return false;
  return mutate('Spalte verschieben', () => { doc.columns[id].order = orderBetween(prev, next); });
}

/** Spalte löschen; ihre Karten kommen in die Zielspalte (sie gehen nie verloren). */
function deleteColumn(id, targetId) {
  const col = doc.columns[id], target = doc.columns[targetId];
  if (!col) return 'Diese Spalte gibt es nicht mehr.';
  if (col.statusKey !== 'idea' && columnsOfStatus(col.statusKey).length === 1) {
    return `Das ist die letzte Spalte für „${statusLabel(col.statusKey)}“. Jede Kategorie braucht mindestens eine Spalte.`;
  }
  const cards = boardCards().get(id) || [];
  if (cards.length && (!target || targetId === id)) return 'Bitte eine Zielspalte für die Karten wählen.';
  mutate('Spalte löschen', () => {
    for (const nid of cards) doc.nodes[nid].columnId = targetId;
    for (const nid in doc.nodes) if (doc.nodes[nid].columnId === id) delete doc.nodes[nid].columnId;
    delete doc.columns[id];
  });
  return '';
}

function setBlocked(id, flag, reason) {
  mutate(flag ? 'Blocker setzen' : 'Blocker lösen', () => {
    const n = doc.nodes[id];
    if (flag) n.blocked = { flag: true, reason: String(reason || '').slice(0, 200), since: (n.blocked && n.blocked.since) || nowSynced() };
    else delete n.blocked;
  });
}

/** Kurzer, nicht blockierender Hinweis bei überschrittenem WIP-Limit (Regel K01). */
function wipWarn(col) {
  if (!col || !col.wip || !doc.columns[col.id]) return;
  const n = wipCount(col.id);
  if (n > col.wip && typeof kanbanToast === 'function') {
    kanbanToast(`⚠ „${col.title}“ hat ${n} Karten, das Limit ist ${col.wip}. ${WIP_QUESTION}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// Board-Vorlagen (Spalten mit WIP-Limit und Definition of Done, Meilensteine)
// Dieselben Vorlagen erscheinen unter „Neu“ (mit Mindmap, siehe TEMPLATES in
// mm-io.js) und im Kanban unter „Vorlage …“ (nur das Board).
// ════════════════════════════════════════════════════════════════════
const BOARD_TEMPLATES = [
  { key: 'simple', title: 'Einfaches Kanban', desc: 'Offen / In Arbeit / Erledigt mit WIP-Limit 3', columns: [
    { title: 'Offen', statusKey: 'todo' },
    { title: 'In Arbeit', statusKey: 'doing', wip: 3 },
    { title: 'Erledigt', statusKey: 'done' },
  ] },
  { key: 'nwt8', title: 'NwT-Projekt 8 Wochen', desc: 'Backlog bis Erledigt, Test-Spalte, Definition of Done, 4 Meilensteine', columns: [
    { title: 'Backlog', statusKey: 'todo' },
    { title: 'Diese Woche', statusKey: 'todo', wip: 6 },
    { title: 'In Arbeit', statusKey: 'doing', wip: 3 },
    { title: 'Test', statusKey: 'doing', wip: 2, dod: ['Funktion ausprobiert und Ergebnis notiert', 'Fehler und Verbesserungen als neue Karte angelegt'] },
    { title: 'Erledigt', statusKey: 'done', dod: ['Im Lerntagebuch / in der Doku festgehalten (mit Foto)', 'Material und Werkzeug aufgeräumt', 'Gruppe informiert'] },
  ], milestones: [
    { text: 'Projektskizze abgeben', week: 2 },
    { text: 'Zwischenpräsentation', week: 4 },
    { text: 'Funktionstest bestanden', week: 7 },
    { text: 'Abschlusspräsentation', week: 8 },
  ] },
  { key: 'review', title: 'Projekt mit Review', desc: 'Jede Karte wird von einer anderen Person geprüft', columns: [
    { title: 'Backlog', statusKey: 'todo' },
    { title: 'In Arbeit', statusKey: 'doing', wip: 3 },
    { title: 'Review', statusKey: 'doing', wip: 2, dod: ['Von einer anderen Person geprüft', 'Rückmeldung eingearbeitet'] },
    { title: 'Erledigt', statusKey: 'done', dod: ['Review bestanden'] },
  ] },
];

/** Eigene Vorlagen liegen im Browser (Einstellung dieses Geräts). */
function ownBoardTemplates() {
  try { return (JSON.parse(localStorage.getItem('mm-board-templates') || '[]') || []).filter(t => t && Array.isArray(t.columns)); } catch (e) { return []; }
}
function saveOwnBoardTemplates(list) {
  try { localStorage.setItem('mm-board-templates', JSON.stringify(list.slice(-30))); return true; } catch (e) { return false; }
}
/** Das aktuelle Board als Vorlage (ohne Karten, ohne Personen). */
function boardFromCurrent(title) {
  return {
    key: 'own-' + Date.now().toString(36), title: String(title || 'Eigene Vorlage').slice(0, 60), own: true,
    desc: boardColumns().map(c => c.title).join(' / '),
    columns: boardColumns().map(c => Object.assign({ title: c.title, statusKey: c.statusKey },
      c.wip ? { wip: c.wip } : {}, c.color ? { color: c.color } : {}, Array.isArray(c.dod) && c.dod.length ? { dod: c.dod.slice() } : {})),
  };
}
function boardTemplateByKey(key) { return BOARD_TEMPLATES.concat(ownBoardTemplates()).find(t => t.key === key) || null; }

/** Montag dieser Woche (bzw. heute, wenn heute Montag ist) – Start für Meilensteine. */
function weekStart(iso) {
  const d = parseDate(iso || todayISO());
  return addDays(fmtISO(d), -((d.getDay() + 6) % 7));
}

/**
 * Board-Vorlage auf die aktuelle Mindmap anwenden (innerhalb von mutate):
 * Spalten ersetzen, Karten in die erste Spalte ihrer Kategorie, optional Meilensteine.
 */
function boardTemplateInto(tpl, withMilestones) {
  M().kanbanMode = 'process';
  if (!M().kanbanId) M().kanbanId = uid('b');
  for (const id in doc.columns) delete doc.columns[id];
  for (const id in doc.nodes) if (!doc.nodes[id].task) delete doc.nodes[id].columnId;
  createBoard(tpl.columns);
  for (const name of knownOwners()) ensureMember(name);
  if (withMilestones && tpl.milestones && tpl.milestones.length) {
    const start = M().projectStart || weekStart();
    M().projectStart = start;
    const rid = index().rid;
    let branch = kids(rid).find(k => label(k) === 'Meilensteine');
    if (!branch) branch = createChild(rid, 'Meilensteine');
    for (const m of tpl.milestones) {
      const due = addDays(start, (m.week - 1) * 7 + 4);      // Freitag der Woche
      createChild(branch, m.text, null, { task: true, status: 'todo', ms: true, start: due, due, columnId: columnsOfStatus('todo')[0].id });
    }
  }
}

function applyBoardTemplate(key, withMilestones) {
  const tpl = boardTemplateByKey(key);
  if (!tpl) return false;
  return mutate('Board-Vorlage', () => boardTemplateInto(tpl, withMilestones), { noDerive: true, events: [{ type: 'board.template', to: tpl.title }] });
}

// ════════════════════════════════════════════════════════════════════
// Bewertungskriterien (doc.criteria) – je Datei eine Liste, Karten verweisen
// über node.criteriaIds darauf. „Belegt“ ist ein Kriterium, sobald mindestens
// eine damit verknüpfte Karte erledigt ist.
// ════════════════════════════════════════════════════════════════════
function criteriaList(src) {
  return Object.values((src || doc).criteria || {}).sort((a, b) => ((a.order || 0) - (b.order || 0)) || (a.id < b.id ? -1 : 1));
}
function criteriaOf(n) { return Array.isArray(n && n.criteriaIds) ? n.criteriaIds.filter(c => doc.criteria[c]) : []; }
function addCriterion(title) {
  const last = criteriaList().slice(-1)[0];
  let id = null;
  mutate('Kriterium anlegen', () => {
    id = uid('c');
    doc.criteria[id] = { id, order: (last ? last.order || 0 : 0) + 1, title: String(title || 'Neues Kriterium').slice(0, 120) };
  });
  return id;
}
function updateCriterion(id, fields, mergeKey) {
  if (!doc.criteria[id]) return;
  mutate('Kriterium ändern', () => {
    const c = doc.criteria[id];
    for (const f in fields) { const v = fields[f]; if (v == null || v === '') delete c[f]; else c[f] = String(v).slice(0, f === 'desc' ? 400 : 120); }
  }, mergeKey ? { merge: 'crit:' + id + ':' + mergeKey } : undefined);
}
function moveCriterion(id, delta) {
  const list = criteriaList();
  const i = list.findIndex(c => c.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  mutate('Kriterium verschieben', () => { const a = doc.criteria[list[i].id], b = doc.criteria[list[j].id]; [a.order, b.order] = [b.order || 0, a.order || 0]; if (a.order === b.order) a.order += delta; });
}
function deleteCriterion(id) {
  mutate('Kriterium löschen', () => {
    delete doc.criteria[id];
    for (const nid in doc.nodes) {
      const n = doc.nodes[nid];
      if (Array.isArray(n.criteriaIds) && n.criteriaIds.includes(id)) { n.criteriaIds = n.criteriaIds.filter(c => c !== id); if (!n.criteriaIds.length) delete n.criteriaIds; }
    }
  });
}
/**
 * Welche Kriterien sind durch erledigte Karten belegt? Je Kriterium:
 * {crit, state:'belegt'|'in Arbeit'|'offen', cards:[{id,title,cat,owners}], done, persons}
 */
function criteriaCoverage(src) {
  src = src || doc;
  return criteriaList(src).map(crit => {
    const cards = Object.values(src.nodes).filter(n => n.task && Array.isArray(n.criteriaIds) && n.criteriaIds.includes(crit.id))
      .map(n => ({ id: n.id, title: String(n.text || '').slice(0, 80), cat: cardCategory(n), owners: ownersOf(n) }));
    const done = cards.filter(c => c.cat === 'done');
    return { crit, cards, done: done.length, state: done.length ? 'belegt' : cards.length ? 'in Arbeit' : 'offen',
      persons: [...new Set(done.flatMap(c => c.owners))].sort((a, b) => a.localeCompare(b, 'de')) };
  });
}

// ════════════════════════════════════════════════════════════════════
// Retrospektiven (doc.retros) – Antworten der Gruppe, je Frage ein eigenes
// Feld, damit zwei Personen gleichzeitig an verschiedenen Fragen schreiben können
// ════════════════════════════════════════════════════════════════════
const RETRO_QUESTIONS = [
  { key: 'q1', text: 'Was lief gut?', hint: 'Worauf seid ihr stolz? Was hat geholfen?' },
  { key: 'q2', text: 'Wo gab es Engpässe oder Blockaden?', hint: 'Schaut auf die Kennzahlen: Wo haben Karten lange gelegen? Wann war das WIP-Limit überschritten?' },
  { key: 'q3', text: 'Was ändern wir beim nächsten Mal?', hint: 'Spalten, WIP-Limits, Absprachen, Arbeitsweise …' },
  { key: 'q4', text: 'Wer übernimmt was bis wann?', hint: 'Konkrete Vereinbarungen mit Kürzel und Termin' },
];
function retroList() { return Object.values(doc.retros || {}).sort((a, b) => (b.created || 0) - (a.created || 0)); }
function createRetro() {
  let id = null;
  mutate('Retrospektive', () => {
    id = uid('r');
    const now = nowSynced();
    doc.retros[id] = { id, created: now, title: 'Retrospektive vom ' + new Date(now).toLocaleDateString('de-DE'), snapshot: metricsSummary(computeMetrics(doc, now)) };
  });
  return id;
}
function retroMarkdown(r) {
  const s = r.snapshot || {};
  const lines = [`# ${r.title || 'Retrospektive'}`, '', `Board: ${M().title || label(index().rid)}`, ''];
  lines.push('## Kennzahlen (Stand der Retrospektive)', '');
  for (const row of summaryRows(s)) lines.push(`- ${row[0]}: ${row[1]}`);
  lines.push('');
  for (const q of RETRO_QUESTIONS) lines.push(`## ${q.text}`, '', (r[q.key] || '').trim() || '_(keine Antwort)_', '');
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════
// Protokoll
// ════════════════════════════════════════════════════════════════════
const AUDIT_FIELDS = {
  text: 'Titel', note: 'Inhalt', owner: 'Zuständig', due: 'Fällig', start: 'Start', prio: 'Priorität',
  deps: 'Abhängigkeiten', ms: 'Meilenstein', tags: 'Tags', estimate: 'Aufwand', color: 'Farbe', parent: 'Ast',
  criteriaIds: 'Kriterien',
};
const TEXT_FIELDS = new Set(['text', 'note']);     // Inhalt wird NICHT ins Protokoll kopiert
const TEXT_COALESCE_MS = 120000;                    // Tippen: höchstens ein Eintrag je 2 Minuten
const EVENT_TYPES = {
  'board.process':   'Prozess-Modus eingeschaltet',
  'task.created':    'Karte angelegt',
  'task.moved':      'Karte verschoben',
  'task.changed':    'Karte geändert',
  'task.deleted':    'Karte gelöscht',
  'blocker.set':     'Blocker gesetzt',
  'blocker.cleared': 'Blocker gelöst',
  'column.created':  'Spalte angelegt',
  'column.renamed':  'Spalte umbenannt',
  'column.changed':  'Spalte geändert',
  'column.deleted':  'Spalte gelöscht',
  'column.moved':    'Spalte verschoben',
  'wip.exceeded':    'WIP-Limit überschritten',
  'dod.confirmed':   'Definition of Done bestätigt',
  'member.added':    'Mitglied hinzugefügt',
  'board.template':  'Board-Vorlage übernommen',
};
const COLUMN_FIELDS = { color: 'Farbe', wip: 'WIP-Limit', statusKey: 'Kategorie', dod: 'Definition of Done' };

let lastTextLog = {};          // „Karte|Feld“ → Zeit des letzten Text-Eintrags
let pendingAudit = new Map();  // Einträge aus dem Tippen, die gesammelt werden
let pendingTimer = null;

function personal() { return M().kanbanPersonal !== false; }

// Kennung: Zeit + laufende Nummer + Zufall. Die laufende Nummer hält Einträge aus
// derselben Millisekunde in der richtigen Reihenfolge (z. B. „verschoben“ vor „DoD bestätigt“).
let eventSeq = 0;
function newEventId() {
  eventSeq = (eventSeq + 1) % 1296;
  return 'e' + Date.now().toString(36) + eventSeq.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 8);
}

/** Eintrag anlegen (innerhalb von mutate). Personen nur, wenn „personenbezogen“ eingeschaltet ist. */
function addEvent(e, t) {
  const id = newEventId();
  const ev = { id, t: t || nowSynced(), who: personal() ? (currentPerson() || null) : null };
  for (const k in e) if (e[k] !== undefined && e[k] !== null && e[k] !== '') ev[k] = e[k];
  doc.events[id] = ev;
  return ev;
}

function fmtValue(f, v, src) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (f === 'prio') return PRIOS[v] ? PRIOS[v].label : String(v);
  if (f === 'due' || f === 'start') return fmtLong(v);
  if (f === 'ms') return v ? 'ja' : '';
  if (f === 'deps') return v.map(d => (src.nodes[d] ? (src.nodes[d].text || '').slice(0, 40) : '?')).join(', ');
  if (f === 'parent') return src.nodes[v] ? (src.nodes[v].text || '').slice(0, 40) : '';
  if (f === 'criteriaIds') return v.map(c => (src.criteria && src.criteria[c] ? src.criteria[c].title : '?')).join(', ');
  if (f === 'statusKey') return statusLabel(v);
  if (f === 'dod') return v.length + ' Punkte';
  if (Array.isArray(v)) return v.join(', ');
  return String(v).slice(0, 80);
}

/** Commit-Haken: Einträge aus dem Vergleich vorher/nachher ableiten. */
function auditHook(before, info) {
  if (!kanbanProcess()) return;
  const opts = info.opts || {};
  const evs = [];
  if (!opts.noDerive) {
    deriveNodeEvents(before, evs, info);
    deriveColumnEvents(before, evs);
    deriveMemberEvents(before, evs);
  }
  for (const e of opts.events || []) evs.push(e);
  const extra = info.undo ? { via: 'undo' } : {};
  for (const e of evs) {
    if (e.pendingKey) { queuePending(e); continue; }
    addEvent(Object.assign({}, e, extra));
  }
}

function deriveNodeEvents(before, evs, info) {
  const B = before.nodes || {}, A = doc.nodes;
  const bCols = before.columns || {}, aCols = doc.columns;
  const typing = !!(info.opts && info.opts.merge);
  const ids = new Set([...Object.keys(B), ...Object.keys(A)]);
  for (const id of ids) {
    const b = B[id], a = A[id];
    const bt = !!(b && b.task), at = !!(a && a.task);
    if (!bt && !at) {
      // Ideen: nur das Verschieben zwischen Ideen-Spalten ist kanbanbezogen
      if (a && b && a.columnId !== b.columnId && aCols[a.columnId]) {
        evs.push({ type: 'task.moved', task: id, title: label(id), from: colTitle(bCols, b.columnId), to: colTitle(aCols, a.columnId), toCol: a.columnId, fromCat: 'idea', toCat: 'idea' });
      }
      continue;
    }
    // fromCat/toCat: Status-Kategorie vorher/nachher – damit die Kennzahlen auch
    // stimmen, wenn Spalten später umbenannt oder gelöscht werden
    const title = a ? (a.text || '').slice(0, 60) : (b.text || '').slice(0, 60);
    if (!bt && at) {
      evs.push({ type: 'task.created', task: id, title, to: colTitle(aCols, a.columnId) || statusLabel(cardCategory(a)), toCol: a.columnId, toCat: cardCategory(a) });
      continue;
    }
    if (bt && !a) { evs.push({ type: 'task.deleted', task: id, title, from: colTitle(bCols, b.columnId) || statusLabel(cardCategory(b)), fromCat: cardCategory(b) }); continue; }
    if (bt && !at) {
      // keine Aufgabe mehr: in eine Ideen-Spalte gezogen oder im Eigenschaften-Feld ausgeschaltet
      evs.push({ type: 'task.moved', task: id, title, from: colTitle(bCols, b.columnId) || statusLabel(cardCategory(b)),
        to: colTitle(aCols, a.columnId) || statusLabel('idea'), toCol: a.columnId && aCols[a.columnId] ? a.columnId : undefined,
        fromCat: cardCategory(b), toCat: 'idea' });
      continue;
    }
    // beides Aufgabe: hat sich die angezeigte Spalte oder der Status geändert?
    const bc = shownColumnId(bCols, b), ac = shownColumnId(aCols, a);
    if (cardCategory(a) !== cardCategory(b) || (ac && bc !== ac)) {
      evs.push({ type: 'task.moved', task: id, title, from: colTitle(bCols, bc) || statusLabel(cardCategory(b)),
        to: colTitle(aCols, ac) || statusLabel(cardCategory(a)), fromCol: bc || undefined, toCol: ac || undefined,
        fromCat: cardCategory(b), toCat: cardCategory(a) });
      const col = aCols[ac];
      if (col && col.wip) {
        const count = wipCount(col.id);
        if (count > col.wip) evs.push({ type: 'wip.exceeded', task: id, title, col: col.id, to: `${col.title}: ${count}/${col.wip}` });
      }
    }
    if (manualBlocked(a) !== manualBlocked(b)) evs.push({ type: manualBlocked(a) ? 'blocker.set' : 'blocker.cleared', task: id, title });
    for (const f in AUDIT_FIELDS) {
      if (same(a[f], b[f])) continue;
      if (TEXT_FIELDS.has(f)) {
        const key = id + '|' + f, now = Date.now();
        if (lastTextLog[key] && now - lastTextLog[key] < TEXT_COALESCE_MS) continue;
        lastTextLog[key] = now;
        evs.push({ type: 'task.changed', task: id, title, field: AUDIT_FIELDS[f] });
        continue;
      }
      const hidePerson = f === 'owner' && !personal();
      const e = { type: 'task.changed', task: id, title, field: AUDIT_FIELDS[f],
        from: hidePerson ? '' : fmtValue(f, b[f], before), to: hidePerson ? '' : fmtValue(f, a[f], doc) };
      if (typing) { e.pendingKey = id + '|' + f; e.rawFrom = e.from; }
      evs.push(e);
    }
  }
}

function deriveColumnEvents(before, evs) {
  const B = before.columns || {}, A = doc.columns || {};
  for (const id of new Set([...Object.keys(B), ...Object.keys(A)])) {
    const b = B[id], a = A[id];
    if (!b && a) { evs.push({ type: 'column.created', col: id, to: a.title }); continue; }
    if (b && !a) { evs.push({ type: 'column.deleted', col: id, from: b.title }); continue; }
    if (a.title !== b.title) evs.push({ type: 'column.renamed', col: id, from: b.title, to: a.title, pendingKey: 'col|' + id + '|title', rawFrom: b.title });
    if ((a.order || 0) !== (b.order || 0)) evs.push({ type: 'column.moved', col: id, to: a.title });
    for (const f in COLUMN_FIELDS) {
      if (same(a[f], b[f])) continue;
      evs.push({ type: 'column.changed', col: id, field: COLUMN_FIELDS[f], from: fmtValue(f, b[f], before), to: fmtValue(f, a[f], doc), title: a.title,
        pendingKey: f === 'dod' ? 'col|' + id + '|dod' : undefined });
    }
  }
}

function deriveMemberEvents(before, evs) {
  const B = before.members || {};
  for (const id in doc.members || {}) if (!B[id]) evs.push({ type: 'member.added', to: personal() ? doc.members[id].name : '' });
}

/**
 * Änderungen beim Tippen sammeln und erst nach einer kurzen Pause als EIN Eintrag
 * schreiben („Zuständig: A → AB → ABC“ wird zu „Zuständig: – → ABC“).
 */
function queuePending(e) {
  const old = pendingAudit.get(e.pendingKey);
  const ev = Object.assign({}, e, { from: old ? old.from : e.rawFrom, t: old ? old.t : nowSynced(), who: personal() ? (currentPerson() || null) : null });
  delete ev.pendingKey; delete ev.rawFrom;
  pendingAudit.set(e.pendingKey, ev);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushAudit, 2500);
}
function flushAudit() {
  clearTimeout(pendingTimer);
  if (!pendingAudit.size || readOnly) { pendingAudit.clear(); return; }
  const list = [...pendingAudit.values()].filter(e => e.from !== e.to);
  pendingAudit.clear();
  if (!list.length) return;
  mutate('Protokoll', () => {
    for (const e of list) { const id = newEventId(); doc.events[id] = Object.assign({ id }, e); }
  }, { noUndo: true, noDerive: true });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAudit(); });

onCommit(kanbanReconcile);
onCommit(auditHook);

/** Protokoll als Liste (älteste zuerst), optional gefiltert. */
function auditList(filter) {
  const f = filter || {};
  const from = f.from ? parseDate(f.from).setHours(0, 0, 0, 0) : null;
  const to = f.to ? parseDate(f.to).setHours(23, 59, 59, 999) : null;
  return Object.values(doc.events || {})
    .filter(e => (!f.who || (f.who === '-' ? !e.who : e.who === f.who)) && (!f.task || e.task === f.task)
      && (from == null || e.t >= from) && (to == null || e.t <= to))
    .sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1));
}

/** Ein Eintrag als Satz, z. B. „Karte verschoben: In Arbeit → Review“. */
function eventText(e) {
  let s = EVENT_TYPES[e.type] || e.type;
  if (e.field) s += ` (${e.field})`;
  // fehlen die Spaltennamen, wenigstens die Status-Kategorie nennen
  const from = e.from || (e.fromCat ? statusLabel(e.fromCat) : ''), to = e.to || (e.toCat ? statusLabel(e.toCat) : '');
  if (from || to) s += `: ${from || '–'} → ${to || '–'}`;
  if (e.via === 'undo') s += ' (Rückgängig/Wiederholen)';
  return s;
}

// ════════════════════════════════════════════════════════════════════
// Datenschutz: Projekt abschließen, Auskunft, lokale Daten löschen
// ════════════════════════════════════════════════════════════════════

/** Alle Personen, die im Dokument vorkommen (Zuständige, Mitglieder, Protokoll, Punkte). */
function allPersons() {
  const s = new Set(knownOwners());
  for (const id in doc.events) if (doc.events[id].who) s.add(doc.events[id].who);
  for (const id in doc.votes) if (doc.votes[id].name) s.add(doc.votes[id].name);
  return [...s].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Projekt abschließen: Protokoll behalten, anonymisieren (Personen → „Person 1, 2 …“,
 * auch bei den Zuständigen) oder löschen. Nur außerhalb einer gemeinsamen Sitzung,
 * weil der Server das Protokoll dort nur anhängen lässt.
 */
function closeProject(how) {
  if (typeof collab !== 'undefined' && collab) return 'Bitte zuerst die gemeinsame Sitzung verlassen – während einer Sitzung kann das Protokoll nur ergänzt werden.';
  if (how === 'keep') return '';
  const map = new Map(allPersons().map((p, i) => [p, 'Person ' + (i + 1)]));
  const anon = v => (v && map.has(v) ? map.get(v) : v);
  const ok = mutate(how === 'delete' ? 'Protokoll löschen' : 'Anonymisieren', () => {
    if (how === 'delete') { doc.events = {}; return; }
    for (const id in doc.events) {
      const e = doc.events[id];
      const anonList = s => String(s).split(', ').map(anon).join(', ');
      if (e.who) e.who = anon(e.who);
      if (e.field === 'Zuständig') { if (e.from) e.from = anonList(e.from); if (e.to) e.to = anonList(e.to); }
      if (e.type === 'member.added' && e.to) e.to = anon(e.to);
    }
    for (const id in doc.nodes) { const n = doc.nodes[id]; if (n.owner) setOwners(n, ownersOf(n).map(anon)); }
    for (const id in doc.members) doc.members[id].name = anon(doc.members[id].name);
    for (const id in doc.votes) if (doc.votes[id].name) doc.votes[id].name = anon(doc.votes[id].name);
    M().kanbanAnonymized = true;
  }, { noDerive: true });
  if (ok && how !== 'delete') {
    const me = currentPerson();
    if (me && map.has(me)) setCurrentPerson(map.get(me));
  }
  return '';
}

/** Auskunft: alles zu einer Person (Aufgaben und Protokolleinträge) als JSON. */
function personExport(name) {
  const tasks = treeOrder().filter(id => isTask(id) && ownersOf(id).includes(name)).map(id => {
    const n = doc.nodes[id];
    return { id, titel: n.text || '', pfad: pathText(id), status: STATUS.find(s => s.key === statusOf(id)).label,
      spalte: (columnFor(n) || {}).title || '', faellig: n.due || '', start: n.start || '', zustaendig: ownersOf(id) };
  });
  const events = auditList({ who: name }).map(e => ({ zeit: new Date(e.t).toISOString(), art: EVENT_TYPES[e.type] || e.type, karte: e.title || '', text: eventText(e) }));
  const zustaendigIm = auditList().filter(e => e.field === 'Zuständig' && ((e.to || '').split(', ').includes(name) || (e.from || '').split(', ').includes(name)))
    .map(e => ({ zeit: new Date(e.t).toISOString(), karte: e.title || '', text: eventText(e) }));
  return {
    format: 'mindmap-editor-auskunft', erstellt: new Date().toISOString(), person: name,
    dokument: M().title || label(index().rid),
    hinweis: 'Das Protokoll ist ein Arbeitsnachweis, kein Beweis: Es entsteht ohne Anmeldung und ist nicht fälschungssicher.',
    aufgaben: tasks, protokoll: events, protokollZuZustaendigkeit: zustaendigIm,
    punkte: Object.values(doc.votes).filter(v => v.name === name).map(v => ({ idee: label(v.node), punkte: v.n })),
  };
}

/** Alle Daten dieser App im Browser löschen (Zwischenspeicher, Name, Einstellungen). */
function clearLocalData() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('mm-')) keys.push(k); }
    for (const k of keys) localStorage.removeItem(k);
    sessionStorage.clear();
  } catch (e) { /* egal */ }
}
