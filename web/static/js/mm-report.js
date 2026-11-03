'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Bericht zum Kanban-Prozess (Markdown und A4-Druck/PDF)
//
// Ein Bericht fasst zusammen: Stand der Karten, Kennzahlen, Bewertungs-
// kriterien, Retrospektiven und einen Auszug aus dem Protokoll.
// PDF entsteht über den Druckdialog des Browsers („Als PDF sichern“) –
// ohne zusätzliche Bibliothek. Die Desktop-Version speichert stattdessen eine
// druckfertige HTML-Datei, die sich in jedem Browser als PDF sichern lässt.
// ════════════════════════════════════════════════════════════════════

const REPORT_DEFAULTS = { cards: true, metrics: true, criteria: true, retros: true, log: 'last', persons: true };
const REPORT_LOG_LAST = 50;

/** Alle Zahlen und Listen für den Bericht (aus dem aktuellen Dokument). */
function reportData(opts, now) {
  const o = Object.assign({}, REPORT_DEFAULTS, opts || {});
  now = now || nowSynced();
  const cards = boardCards();
  const evs = auditList();
  return {
    o, now,
    title: M().title || label(index().rid),
    purpose: (M().kanbanPurpose || '').trim(),
    personal: personal(),
    columns: boardColumns().map(c => ({ col: c, ids: (cards.get(c.id) || []) })),
    metrics: computeMetrics(doc, now),
    coverage: criteriaCoverage(),
    retros: retroList().slice().reverse(),
    events: o.log === 'none' ? [] : o.log === 'all' ? evs : evs.slice(-REPORT_LOG_LAST),
    eventsTotal: evs.length,
  };
}

const NOTICE_TEXT = 'Das Protokoll ist ein Arbeitsnachweis, kein Beweis: Es entsteht ohne Anmeldung und ist nicht fälschungssicher.';

function reportCardLine(id) {
  const n = doc.nodes[id];
  const extra = [ownersOf(n).join(', '), n.due ? 'fällig ' + fmtLong(n.due) : '', isBlocked(id) ? 'blockiert' : ''].filter(Boolean).join(' · ');
  return { text: label(id), extra };
}

// ── Markdown ────────────────────────────────────────────────────────
function mdCell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }

function reportMarkdown(opts) {
  const r = reportData(opts);
  const m = r.metrics, o = r.o;
  const L = [`# Bericht: ${r.title}`, '', `Stand: ${new Date(r.now).toLocaleString('de-DE')}`, ''];
  if (r.purpose) L.push(`Zweck des Protokolls: ${r.purpose}`, '');
  L.push(`> ${NOTICE_TEXT}`, '');
  if (o.cards) {
    L.push('## Stand der Karten', '');
    for (const { col, ids } of r.columns) {
      L.push(`### ${col.title} (${ids.length}${col.wip ? ' / Limit ' + col.wip : ''})`, '');
      if (!ids.length) L.push('_(keine Karten)_');
      for (const id of ids) { const c = reportCardLine(id); L.push(`- ${c.text}${c.extra ? ' – ' + c.extra : ''}`); }
      L.push('');
    }
  }
  if (o.metrics) {
    L.push('## Kennzahlen', '');
    for (const [k, v] of summaryRows(metricsSummary(m))) L.push(`- ${k}: ${v}`);
    L.push('', '### Durchsatz je Woche', '', '| Woche | ab | erledigt |', '|---|---|---|');
    for (const w of m.weeks) L.push(`| ${w.label} | ${fmtLong(w.monday)} | ${w.count} |`);
    L.push('', '### Je Karte', '', '| Karte | Status | Durchlaufzeit | Bearbeitungszeit | blockiert |', '|---|---|---|---|---|');
    for (const c of m.cards.filter(c => c.cat && c.cat !== 'idea')) {
      L.push(`| ${mdCell(c.title)} | ${statusLabel(c.cat)} | ${fmtDays(c.lead)} | ${fmtDays(c.cycle)} | ${c.blocked ? fmtDays(c.blocked) : '–'} |`);
    }
    L.push('');
  }
  if (o.criteria && r.coverage.length) {
    L.push('## Bewertungskriterien', '');
    for (const c of r.coverage) {
      L.push(`- **${c.crit.title}** – ${c.state}${c.cards.length ? `: ${c.cards.map(k => `${k.title}${k.cat === 'done' ? ' (erledigt)' : ''}${k.owners.length ? ' [' + k.owners.join(', ') + ']' : ''}`).join('; ')}` : ''}`);
      if (c.crit.desc) L.push(`  ${c.crit.desc}`);
    }
    L.push('');
  }
  if (o.retros && r.retros.length) {
    L.push('## Retrospektiven', '');
    for (const x of r.retros) {
      L.push(`### ${x.title || 'Retrospektive'}`, '');
      for (const q of RETRO_QUESTIONS) L.push(`**${q.text}**`, '', (x[q.key] || '').trim() || '_(keine Antwort)_', '');
    }
  }
  if (r.events.length) {
    L.push(`## Protokoll${r.events.length < r.eventsTotal ? ` (letzte ${r.events.length} von ${r.eventsTotal} Einträgen)` : ''}`, '');
    L.push(o.persons ? '| Zeit | Person | Was | Karte |' : '| Zeit | Was | Karte |', o.persons ? '|---|---|---|---|' : '|---|---|---|');
    for (const e of r.events) {
      const t = new Date(e.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      L.push(o.persons ? `| ${t} | ${mdCell(e.who || '–')} | ${mdCell(eventText(e))} | ${mdCell(e.title || '')} |` : `| ${t} | ${mdCell(eventText(e))} | ${mdCell(e.title || '')} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

// ── HTML für Druck / PDF ────────────────────────────────────────────
// Eigene, helle Farben für den Bericht – unabhängig vom gewählten Design der App
const REPORT_CSS = `
.rp { --text:#0f172a; --text2:#334155; --muted:#64748b; --border:#cbd5e1; --surface:#ffffff;
  --viz-done:#2f8f5b; --viz-doing:#3b6fc4; --viz-todo:#c27c1a; --accent:#2563eb;
  color: var(--text); background: #fff; font: 10.5pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.rp h1 { font-size: 18pt; margin: 0 0 2mm; }
.rp h2 { font-size: 13pt; margin: 7mm 0 2mm; border-bottom: 1px solid var(--border); padding-bottom: 1mm; }
.rp h3 { font-size: 11pt; margin: 4mm 0 1mm; }
.rp .rp-meta { color: var(--muted); margin: 0 0 3mm; }
.rp .rp-note { border-left: 3px solid var(--border); padding: 1mm 3mm; color: var(--text2); margin: 2mm 0 4mm; }
.rp table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 1mm 0 3mm; }
.rp th, .rp td { text-align: left; border-bottom: 1px solid var(--border); padding: 1.2mm 2mm; vertical-align: top; }
.rp th { color: var(--muted); font-weight: 600; }
.rp .rp-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(42mm, 1fr)); gap: 3mm; }
.rp .rp-col { border: 1px solid var(--border); border-radius: 2mm; padding: 2mm 3mm; break-inside: avoid; }
.rp .rp-col ul { margin: 1mm 0 0; padding-left: 4mm; }
.rp .rp-col small, .rp small { color: var(--muted); }
.rp .rp-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; margin-bottom: 3mm; }
.rp .rp-tile { border: 1px solid var(--border); border-radius: 2mm; padding: 2mm 3mm; }
.rp .rp-tile b { display: block; font-size: 12pt; }
.rp .rp-tile span { color: var(--muted); font-size: 9pt; }
.rp .rp-legend { display: flex; gap: 5mm; font-size: 9pt; color: var(--text2); margin: 1mm 0; }
.rp .rp-legend i { display: inline-block; width: 3mm; height: 3mm; border-radius: 0.6mm; margin-right: 1.5mm; vertical-align: -0.3mm; }
.rp .rp-chart { break-inside: avoid; margin-bottom: 3mm; }
.rp .rp-chart svg { max-width: 100%; height: auto; }
.rp .kp-grid { stroke: var(--border); stroke-width: 1; }
.rp .kp-axis { font-size: 10px; fill: var(--muted); }
.rp .kp-dlabel { font-size: 10.5px; fill: var(--text2); font-weight: 600; }
.rp .kp-band { stroke: #fff; stroke-width: 2; stroke-linejoin: round; }
.rp .kp-bar { fill: var(--viz-doing); }
.rp .kp-cross { display: none; }
.rp .rp-crit { break-inside: avoid; margin-bottom: 2mm; }
.rp .rp-retro { break-inside: avoid; }
.rp .rp-retro p { margin: 0 0 2mm; white-space: pre-wrap; }
.rp .rp-page { break-after: page; }
@page { size: A4; margin: 15mm 14mm; }
`;

function reportHtml(opts) {
  const r = reportData(opts);
  const m = r.metrics, o = r.o;
  let h = `<div class="rp"><h1>Bericht: ${esc(r.title)}</h1>
    <p class="rp-meta">Stand: ${esc(new Date(r.now).toLocaleString('de-DE'))}${r.purpose ? ` · Zweck des Protokolls: ${esc(r.purpose)}` : ''}</p>
    <p class="rp-note">${esc(NOTICE_TEXT)}</p>`;
  if (o.cards) {
    h += `<h2>Stand der Karten</h2><div class="rp-cols">${r.columns.map(({ col, ids }) => `<div class="rp-col"><b>${esc(col.title)}</b> <small>${ids.length}${col.wip ? ' / Limit ' + col.wip : ''} · ${esc(statusLabel(col.statusKey).replace(/ \(.*\)/, ''))}</small>
      <ul>${ids.map(id => { const c = reportCardLine(id); return `<li>${esc(c.text)}${c.extra ? ` <small>${esc(c.extra)}</small>` : ''}</li>`; }).join('') || '<li><small>keine</small></li>'}</ul></div>`).join('')}</div>`;
  }
  if (o.metrics) {
    h += `<h2>Kennzahlen</h2><div class="rp-tiles">${summaryRows(metricsSummary(m)).map(([k, v]) => `<div class="rp-tile"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
    if (m.cfd.length > 1) {
      h += `<div class="rp-chart"><h3>Cumulative Flow – Karten je Tag</h3>
        <div class="rp-legend">${CFD_SERIES.slice().reverse().map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>${cfdSvg(m, 660)}</div>`;
    }
    h += `<div class="rp-chart"><h3>Durchsatz – erledigte Karten je Woche</h3>${throughputSvg(m, 660)}</div>`;
    h += `<h3>Je Karte</h3><table><thead><tr><th>Karte</th><th>Status</th><th>Durchlaufzeit</th><th>Bearbeitungszeit</th><th>blockiert</th></tr></thead><tbody>
      ${m.cards.filter(c => c.cat && c.cat !== 'idea').map(c => `<tr><td>${esc(c.title)}</td><td>${esc(statusLabel(c.cat))}</td><td>${fmtDays(c.lead)}</td><td>${fmtDays(c.cycle)}</td><td>${c.blocked ? fmtDays(c.blocked) : '–'}</td></tr>`).join('')}</tbody></table>`;
  }
  if (o.criteria && r.coverage.length) {
    h += `<h2>Bewertungskriterien</h2>${r.coverage.map(c => `<div class="rp-crit"><b>${esc(CRIT_STATE[c.state])} · ${esc(c.crit.title)}</b>${c.crit.desc ? `<br><small>${esc(c.crit.desc)}</small>` : ''}
      <br>${c.cards.length ? c.cards.map(k => `${k.cat === 'done' ? '☑' : k.cat === 'doing' ? '◐' : '☐'} ${esc(k.title)}${k.owners.length ? ` <small>(${esc(k.owners.join(', '))})</small>` : ''}`).join(' · ') : '<small>noch keine Karte verknüpft</small>'}</div>`).join('')}`;
  }
  if (o.retros && r.retros.length) {
    h += `<h2>Retrospektiven</h2>${r.retros.map(x => `<div class="rp-retro"><h3>${esc(x.title || 'Retrospektive')}</h3>
      ${RETRO_QUESTIONS.map(q => `<b>${esc(q.text)}</b><p>${esc((x[q.key] || '').trim() || '(keine Antwort)')}</p>`).join('')}</div>`).join('')}`;
  }
  if (r.events.length) {
    h += `<h2>Protokoll${r.events.length < r.eventsTotal ? ` <small>(letzte ${r.events.length} von ${r.eventsTotal} Einträgen)</small>` : ''}</h2>
      <table><thead><tr><th>Zeit</th>${o.persons ? '<th>Person</th>' : ''}<th>Was</th><th>Karte</th></tr></thead><tbody>
      ${r.events.map(e => `<tr><td>${esc(new Date(e.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td>${o.persons ? `<td>${esc(e.who || '–')}</td>` : ''}<td>${esc(eventText(e))}</td><td>${esc(e.title || '')}</td></tr>`).join('')}</tbody></table>`;
  }
  return h + '</div>';
}

/** Eigenständige, druckfertige HTML-Datei (z. B. für die Desktop-Version). */
function reportStandalone(opts) {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Bericht: ${esc(M().title || label(index().rid))}</title><style>${REPORT_CSS} body{margin:0;padding:12mm;} @media print{body{padding:0}}</style></head>
<body>${reportHtml(opts)}<p style="color:#64748b;font-size:9pt;margin-top:8mm">Zum Speichern als PDF: im Browser „Drucken“ und als Ziel „Als PDF sichern“ wählen.</p></body></html>`;
}

/** Drucken bzw. als PDF sichern – im Browser über den Druckdialog, in der Desktop-Version als Datei. */
function printReport(opts) {
  if (DESKTOP) {
    deliverFile(reportStandalone(opts), baseName() + '_bericht.html', 'text/html');
    showModal('Bericht', 'Der Bericht wurde als druckfertige HTML-Datei gespeichert.\n\nFür ein PDF die Datei im Browser öffnen, „Drucken“ wählen und als Ziel „Als PDF sichern“.');
    return;
  }
  const area = $('print-area');
  if (!area) return;
  area.innerHTML = `<style>${REPORT_CSS}</style>` + reportHtml(opts);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}
