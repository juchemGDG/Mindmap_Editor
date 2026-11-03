'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Kennzahlen aus dem Protokoll (Kanban-Prozess)
//
// Reine Rechnung ohne Oberfläche: computeMetrics(src, now) bekommt ein
// Dokument (events, nodes, columns) und einen Zeitpunkt und liefert alle Zahlen.
// So lässt sie sich mit festen Beispiel-Protokollen testen.
//
// Begriffe (wie in der Wirtschaft üblich):
//   Durchlaufzeit (Lead Time)     vom Anlegen der Karte bis „Erledigt“
//   Bearbeitungszeit (Cycle Time) vom ersten „In Arbeit“ bis „Erledigt“
//   Durchsatz                     erledigte Karten je Kalenderwoche
//   Blockadedauer                 Zeit, in der Karten als blockiert markiert waren
//   Cumulative Flow               je Tag: wie viele Karten offen / in Arbeit / erledigt
//
// Gerechnet wird mit der Status-KATEGORIE (offen, in Arbeit, erledigt), nicht mit
// einzelnen Spalten – so stimmen die Zahlen auch, wenn Spalten umbenannt werden.
// Karten, die es schon vor dem Prozess-Modus gab, zählen ab dessen Beginn.
// Wurde eine Karte wieder geöffnet, zählt die letzte Fertigstellung.
// ════════════════════════════════════════════════════════════════════

const DAY_MS = 86400000;
const CAT_BY_LABEL = { 'Offen': 'todo', 'In Arbeit': 'doing', 'Erledigt': 'done' };

/** Kategorie eines Protokolleintrags (which = 'to' oder 'from'). Ältere Einträge ohne toCat: über Spalte bzw. Beschriftung. */
function eventCat(e, which, cols) {
  if (e[which + 'Cat']) return e[which + 'Cat'];
  const colId = e[which + 'Col'];
  if (colId && cols[colId]) return cols[colId].statusKey;
  const l = e[which];
  if (l && CAT_BY_LABEL[l]) return CAT_BY_LABEL[l];
  if (l && /^Ideen/.test(l)) return 'idea';
  return null;
}

/** Weg jeder Karte durch die Kategorien, aus dem Protokoll rekonstruiert. */
function cardJourneys(src, now) {
  const cols = src.columns || {};
  const evs = Object.values(src.events || {}).sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1));
  const startEv = evs.find(e => e.type === 'board.process') || evs[0];
  const boardStart = startEv ? startEv.t : now;
  const map = new Map();
  const get = (id, title) => {
    if (!map.has(id)) map.set(id, { id, title: title || '', created: null, deleted: null, initial: null, moves: [], blocks: [] });
    const j = map.get(id);
    if (title) j.title = title;
    return j;
  };
  for (const e of evs) {
    if (!e.task) continue;
    const j = get(e.task, e.title);
    if (e.type === 'task.created') {
      j.created = e.t;
      j.moves.push({ t: e.t, cat: eventCat(e, 'to', cols) || 'todo' });
    } else if (e.type === 'task.moved') {
      const from = eventCat(e, 'from', cols), to = eventCat(e, 'to', cols);
      if (j.created == null && !j.moves.length && j.initial == null && from) j.initial = from;
      if (to) j.moves.push({ t: e.t, cat: to });
    } else if (e.type === 'task.deleted') {
      j.deleted = e.t;
      if (j.created == null && !j.moves.length && j.initial == null) j.initial = eventCat(e, 'from', cols);
    } else if (e.type === 'blocker.set') {
      if (!j.blocks.some(b => b.to == null)) j.blocks.push({ from: e.t, to: null });
    } else if (e.type === 'blocker.cleared') {
      const open = j.blocks.find(b => b.to == null);
      if (open) open.to = e.t;
    }
  }
  // Aufgaben, die (noch) nicht im Protokoll stehen, sind seit Beginn da
  for (const id in src.nodes || {}) {
    const n = src.nodes[id];
    if (!n.task) continue;
    const j = get(id, String(n.text || '').slice(0, 60));
    if (j.created == null && j.initial == null && !j.moves.length) j.initial = cardCategory(n);
    // schon vor dem Prozess-Modus blockiert (kein Eintrag „Blocker gesetzt“)
    if (n.blocked && n.blocked.flag && !j.blocks.some(b => b.to == null)) j.blocks.push({ from: Math.max(n.blocked.since || boardStart, boardStart), to: null });
  }
  for (const j of map.values()) {
    if (j.created == null && j.initial == null) j.initial = j.moves.length ? j.moves[0].cat : 'todo';
    j.start = j.created != null ? j.created : boardStart;
    j.fromBoardStart = j.created == null;
  }
  return { boardStart, journeys: [...map.values()] };
}

/** Kategorie einer Karte zum Zeitpunkt T (null = gab es da nicht). */
function catAt(j, T) {
  if (j.created != null && T < j.created) return null;
  if (j.deleted != null && T >= j.deleted) return null;
  let c = j.created != null ? null : j.initial;
  for (const m of j.moves) if (m.t <= T) c = m.cat;
  return c;
}

function stats(values) {
  const v = values.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, mean: null };
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, median, mean: v.reduce((s, x) => s + x, 0) / v.length };
}

/** ISO-Kalenderwoche eines Zeitpunkts: {key:'2026-W41', week, year, monday} */
function isoWeekOf(t) {
  const d = new Date(t);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const dow = (day.getDay() + 6) % 7;                 // Montag = 0
  const monday = new Date(day); monday.setDate(day.getDate() - dow);
  const thu = new Date(monday); thu.setDate(monday.getDate() + 3);
  const year = thu.getFullYear();
  const jan4 = new Date(year, 0, 4, 12);
  const week1 = new Date(jan4); week1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const week = Math.round((monday - week1) / (7 * DAY_MS)) + 1;
  return { key: `${year}-W${String(week).padStart(2, '0')}`, week, year, monday: fmtISO(monday) };
}

/** Alle Kennzahlen. src = Dokument (oder Teil davon), now = Zeitpunkt in ms. */
function computeMetrics(src, now) {
  now = now || Date.now();
  const { boardStart, journeys } = cardJourneys(src, now);
  const cards = [];
  for (const j of journeys) {
    const final = catAt(j, now);
    let lastDone = null, firstDoing = null;
    if (final === 'done') {
      for (const m of j.moves) if (m.cat === 'done' && m.t <= now) lastDone = m.t;
      if (lastDone != null) {
        for (const m of j.moves) if (m.cat === 'doing' && m.t <= lastDone) { firstDoing = m.t; break; }
      }
    }
    const blocked = j.blocks.reduce((s, b) => s + Math.max(0, (b.to != null ? b.to : now) - b.from), 0);
    cards.push({
      id: j.id, title: j.title, cat: final, fromBoardStart: j.fromBoardStart,
      lead: lastDone != null ? (lastDone - j.start) / DAY_MS : null,
      cycle: lastDone != null && firstDoing != null ? (lastDone - firstDoing) / DAY_MS : null,
      done: lastDone,
      blocked: blocked / DAY_MS, blockedNow: j.blocks.some(b => b.to == null),
    });
  }

  // Durchsatz je Kalenderwoche – von der Woche des Starts bis heute, auch leere Wochen
  const weeks = [];
  for (let t = isoWeekOf(boardStart).monday, guard = 0; guard < 200; guard++) {
    const w = isoWeekOf(parseDate(t).getTime());
    weeks.push({ key: w.key, label: 'KW ' + w.week, monday: w.monday, count: 0 });
    if (w.key === isoWeekOf(now).key) break;
    t = addDays(t, 7);
  }
  for (const c of cards) if (c.done != null) { const w = weeks.find(x => x.key === isoWeekOf(c.done).key); if (w) w.count++; }

  // Cumulative Flow: Stand am Ende jedes Tages (heute: jetzt)
  const cfd = [];
  for (let day = fmtISO(new Date(boardStart)), guard = 0; guard < 400; guard++) {
    const end = parseDate(day).setHours(23, 59, 59, 999);
    const T = Math.min(end, now);
    const row = { day, todo: 0, doing: 0, done: 0 };
    for (const j of journeys) { const c = catAt(j, T); if (c && c in row) row[c]++; }
    cfd.push(row);
    if (end >= now) break;
    day = addDays(day, 1);
  }

  const blockedCards = cards.filter(c => c.blocked > 0);
  const evs = Object.values(src.events || {});
  return {
    boardStart, now, cards, weeks, cfd,
    lead: stats(cards.map(c => c.lead)),
    cycle: stats(cards.map(c => c.cycle)),
    throughput: stats(weeks.map(w => w.count)),
    blockade: { total: blockedCards.reduce((s, c) => s + c.blocked, 0), cards: blockedCards.length, ...stats(blockedCards.map(c => c.blocked)) },
    wipExceeded: evs.filter(e => e.type === 'wip.exceeded').length,
    dodConfirmed: evs.filter(e => e.type === 'dod.confirmed').length,
    total: cards.filter(c => c.cat && c.cat !== 'idea').length,
    doneCount: cards.filter(c => c.cat === 'done').length,
  };
}

// ── Anzeige von Zahlen ──────────────────────────────────────────────
function fmtDays(d) {
  if (d == null) return '–';
  const r = Math.round(d * 10) / 10;
  return (r === 1 ? '1' : r.toLocaleString('de-DE')) + (r === 1 ? ' Tag' : ' Tage');
}
function fmtNum(x) { return x == null ? '–' : (Math.round(x * 10) / 10).toLocaleString('de-DE'); }

/** Kurzfassung für eine Retrospektive (wird mit ihr gespeichert). */
function metricsSummary(m) {
  return {
    t: m.now, done: m.doneCount, total: m.total,
    leadMedian: m.lead.median, leadMean: m.lead.mean, cycleMedian: m.cycle.median, cycleMean: m.cycle.mean,
    throughputMean: m.throughput.mean, blockadeDays: m.blockade.total, blockedCards: m.blockade.cards, wipExceeded: m.wipExceeded,
  };
}
function summaryRows(s) {
  return [
    ['Erledigt', `${s.done ?? 0} von ${s.total ?? 0} Karten`],
    ['Durchlaufzeit (Median / Mittelwert)', `${fmtDays(s.leadMedian)} / ${fmtDays(s.leadMean)}`],
    ['Bearbeitungszeit (Median / Mittelwert)', `${fmtDays(s.cycleMedian)} / ${fmtDays(s.cycleMean)}`],
    ['Durchsatz je Woche (Mittelwert)', fmtNum(s.throughputMean) + ' Karten'],
    ['Blockiert insgesamt', `${fmtDays(s.blockadeDays)} (${s.blockedCards ?? 0} Karten)`],
    ['WIP-Limit überschritten', `${s.wipExceeded ?? 0}-mal`],
  ];
}
