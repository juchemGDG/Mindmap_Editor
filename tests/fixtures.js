// Feste Beispieldaten für Kennzahlen- und Berichtstests
const { sampleDoc } = require('./helpers');

const ts = s => Date.parse(s + ':00+02:00');      // Oktober 2026: Sommerzeit
const NOW = ts('2026-10-14T09:00');

/**
 * Festes Beispiel: Board ab Mo 05.10.2026 09:00, fünf Karten.
 *   A  angelegt 05.10 (offen) → in Arbeit 06.10 → erledigt 08.10
 *   B  schon vorher da (kein „angelegt“) → in Arbeit 07.10 → erledigt 12.10 (älterer Eintrag ohne toCat)
 *   C  angelegt 06.10 direkt in Arbeit, blockiert 07.10–09.10 → erledigt 13.10
 *   D  angelegt 08.10 (offen), blockiert seit 12.10 (noch)
 *   E  angelegt 05.10 in Arbeit → erledigt 06.10 → wieder in Arbeit 07.10 → erledigt 09.10
 */
function protocolDoc() {
  const cols = {
    kB: { id: 'kB', order: 1, title: 'Backlog', statusKey: 'todo' },
    kA: { id: 'kA', order: 2, title: 'In Arbeit', statusKey: 'doing', wip: 3 },
    kE: { id: 'kE', order: 3, title: 'Erledigt', statusKey: 'done' },
  };
  const node = (id, text, status, extra) => Object.assign({ id, parent: 'b1', order: id.charCodeAt(0), text, task: true, status, columnId: { todo: 'kB', doing: 'kA', done: 'kE' }[status] }, extra || {});
  const ev = [];
  const add = (t, type, task, extra) => ev.push(Object.assign({ id: 'e' + String(ev.length).padStart(3, '0'), t: ts(t), who: 'AB', type, task, title: task }, extra || {}));
  const mv = (t, task, fromCat, toCat) => add(t, 'task.moved', task, { fromCat, toCat, toCol: { todo: 'kB', doing: 'kA', done: 'kE' }[toCat] });
  add('2026-10-05T09:00', 'board.process', undefined, { title: undefined });
  add('2026-10-05T09:00', 'task.created', 'A', { toCat: 'todo' });
  add('2026-10-05T09:00', 'task.created', 'E', { toCat: 'doing' });
  mv('2026-10-06T09:00', 'A', 'todo', 'doing');
  add('2026-10-06T09:00', 'task.created', 'C', { toCat: 'doing' });
  mv('2026-10-06T09:00', 'E', 'doing', 'done');
  mv('2026-10-07T09:00', 'B', 'todo', 'doing');
  add('2026-10-07T09:00', 'blocker.set', 'C');
  mv('2026-10-07T09:00', 'E', 'done', 'doing');
  add('2026-10-07T10:00', 'wip.exceeded', 'E', { col: 'kA', to: 'In Arbeit: 4/3' });
  mv('2026-10-08T09:00', 'A', 'doing', 'done');
  add('2026-10-08T09:00', 'task.created', 'D', { toCat: 'todo' });
  add('2026-10-09T09:00', 'blocker.cleared', 'C');
  mv('2026-10-09T09:00', 'E', 'doing', 'done');
  add('2026-10-12T09:00', 'task.moved', 'B', { from: 'In Arbeit', to: 'Erledigt', toCol: 'kE' });   // wie in Etappe 1: ohne fromCat/toCat
  add('2026-10-12T09:00', 'blocker.set', 'D');
  add('2026-10-13T09:00', 'task.moved', 'C', { fromCat: 'doing', toCat: 'done', toCol: 'kE' });
  add('2026-10-13T09:05', 'dod.confirmed', 'C', { col: 'kE', to: 'Erledigt: 2 von 2 Kriterien bestätigt' });
  const d = sampleDoc();
  d.doc.nodes = {
    root: { id: 'root', parent: null, order: 0, text: 'Projekt' }, b1: { id: 'b1', parent: 'root', order: 1, text: 'Bau' },
    A: node('A', 'A', 'done'), B: node('B', 'B', 'done'), C: node('C', 'C', 'done'),
    D: node('D', 'D', 'todo', { blocked: { flag: true, reason: 'wartet', since: ts('2026-10-12T09:00') } }), E: node('E', 'E', 'done'),
  };
  d.doc.meta.m.kanbanMode = 'process';
  d.doc.meta.m.kanbanId = 'btest';
  d.doc.columns = cols;
  d.doc.events = Object.fromEntries(ev.map(e => [e.id, e]));
  return d;
}

module.exports = { ts, NOW, protocolDoc };
