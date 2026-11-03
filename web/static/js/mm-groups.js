'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Gruppenübersicht für die Lehrkraft
//
// Mehrere Mindmap-Dateien (je Gruppe eine) gleichzeitig laden und vergleichen:
// Fortschritt, WIP-Verletzungen, Blockaden, Beitragsanteile je Mitglied.
// Rein lesend und NUR im Browser: Die Dateien werden weder hochgeladen noch
// gespeichert – nach dem Schließen der Seite ist die Übersicht weg.
// ════════════════════════════════════════════════════════════════════

let groups = [];     // [{name, s: groupSummary(…)}] – nur im Arbeitsspeicher

// Diese Einträge zählen als „Beitrag“ (Arbeit an Karten, nicht Board-Einstellungen)
const CONTRIB_TYPES = new Set(['task.created', 'task.moved', 'task.changed', 'blocker.set', 'blocker.cleared', 'dod.confirmed']);

/** Kennzahlen einer Gruppendatei (src = normalisiertes Dokument). */
function groupSummary(src, now) {
  const tasks = Object.values(src.nodes).filter(n => n.task);
  const done = tasks.filter(n => cardCategory(n) === 'done');
  const process = !!(src.meta && src.meta.m && src.meta.m.kanbanMode === 'process');
  const m = computeMetrics(src, now);
  // WIP jetzt: Spalten, die gerade über dem Limit sind
  const count = {};
  for (const n of tasks) { const c = shownColumnId(src.columns || {}, n); if (c) count[c] = (count[c] || 0) + 1; }
  const wipNow = Object.values(src.columns || {}).filter(c => c.wip && (count[c.id] || 0) > c.wip).map(c => `${c.title} ${count[c.id]}/${c.wip}`);
  // Beiträge je Person
  const evs = Object.values(src.events || {});
  const contrib = evs.filter(e => CONTRIB_TYPES.has(e.type));
  const persons = new Map();
  const p = name => { if (!persons.has(name)) persons.set(name, { name, events: 0, doneCards: 0 }); return persons.get(name); };
  for (const e of contrib) if (e.who) p(e.who).events++;
  for (const n of done) for (const o of ownersOf(n)) p(o).doneCards++;
  const withWho = contrib.filter(e => e.who).length;
  const list = [...persons.values()].sort((a, b) => b.events - a.events || b.doneCards - a.doneCards || a.name.localeCompare(b.name, 'de'));
  for (const x of list) x.share = withWho ? x.events / withWho : null;
  const last = evs.reduce((t, e) => Math.max(t, e.t || 0), 0);
  return {
    title: (src.meta && src.meta.m && src.meta.m.title) || (src.nodes.root ? src.nodes.root.text : '') || 'Mindmap',
    process, total: tasks.length, done: done.length, pct: tasks.length ? done.length / tasks.length : 0,
    wipNow, wipExceeded: m.wipExceeded, blockedNow: m.cards.filter(c => c.blockedNow).length, blockadeDays: m.blockade.total,
    leadMedian: m.lead.median, last: last || null, persons: list,
    personal: !(src.meta && src.meta.m && src.meta.m.kanbanPersonal === false),
    anonymized: !!(src.meta && src.meta.m && src.meta.m.kanbanAnonymized),
    contribTotal: contrib.length, contribWithWho: withWho,
  };
}

/** Dateien einlesen (Text) und hinzufügen. */
function addGroupFiles(files) {
  for (const f of files) {
    let entry;
    try {
      const d = parseAnyFile(f.name, f.data);
      const check = validateFile(d);
      if (check.fatal) throw new Error(check.errors[0]);
      entry = { name: f.name, s: groupSummary(normalizeDoc(d), nowSynced()) };
    } catch (err) {
      entry = { name: f.name, error: err instanceof SyntaxError ? 'kein gültiges JSON' : err.message };
    }
    groups = groups.filter(g => g.name !== f.name).concat([entry]);
  }
  renderGroups();
}

/** Mehrere Dateien wählen: Desktop über die Brücke, sonst Datei-Auswahl des Browsers. */
function pickFiles(cb) {
  const api = desktopApi();
  if (api && api.open_files) { api.open_files('.json').then(list => cb(list || [])).catch(err => showModal('Öffnen', 'Öffnen fehlgeschlagen: ' + err)); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json'; inp.multiple = true;
  inp.onchange = () => readFileList(inp.files, cb);
  inp.click();
}
function readFileList(fileList, cb) {
  const files = [...(fileList || [])];
  Promise.all(files.map(f => f.text().then(data => ({ name: f.name, data })))).then(cb);
}

function openGroups() {
  const box = $('groups-modal');
  if (!box) return;
  renderGroups();
  box.style.display = 'flex';
}

function pctText(x) { return x == null ? '–' : Math.round(x * 100) + ' %'; }
function bar(frac, label) {
  return `<span class="gr-bar" role="img" aria-label="${esc(label)}"><i style="width:${Math.round(Math.max(0, Math.min(1, frac || 0)) * 100)}%"></i></span>`;
}

function renderGroups() {
  const body = $('groups-body');
  if (!body) return;
  const ok = groups.filter(g => g.s);
  const rows = groups.map((g, i) => g.error
    ? `<tr><td>${esc(g.name)}</td><td colspan="6" class="gr-err">⚠ konnte nicht gelesen werden: ${esc(g.error)}</td><td><button type="button" class="kp-icon" data-gdel="${i}" aria-label="${esc(g.name)} entfernen">×</button></td></tr>`
    : `<tr><td><b>${esc(g.s.title)}</b><br><small>${esc(g.name)}${g.s.process ? '' : ' · ohne Prozess-Modus'}</small></td>
        <td>${bar(g.s.pct, `${g.s.done} von ${g.s.total} erledigt`)} ${g.s.done}/${g.s.total} <small>(${pctText(g.s.pct)})</small></td>
        <td>${g.s.wipNow.length ? '⚠ ' + esc(g.s.wipNow.join(', ')) : '–'}</td>
        <td>${g.s.wipExceeded}-mal</td>
        <td>${g.s.blockedNow ? `⛔ ${g.s.blockedNow} jetzt` : '–'}<br><small>${fmtDays(g.s.blockadeDays)} insgesamt</small></td>
        <td>${fmtDays(g.s.leadMedian)}</td>
        <td>${g.s.last ? esc(new Date(g.s.last).toLocaleDateString('de-DE')) : '–'}</td>
        <td><button type="button" class="kp-icon" data-gdel="${i}" aria-label="${esc(g.s.title)} entfernen">×</button></td></tr>`).join('');
  const contrib = ok.map(g => `<section class="gr-group"><h3>${esc(g.s.title)}</h3>
      ${!g.s.personal ? '<p class="kp-hint">Protokoll ohne Personen geführt – keine Beitragsanteile.</p>' : ''}
      ${g.s.anonymized ? '<p class="kp-hint">Anonymisiert.</p>' : ''}
      ${g.s.persons.length ? `<table class="kp-log"><thead><tr><th>Mitglied</th><th>Anteil an den Protokolleinträgen</th><th>erledigte Karten (zuständig)</th></tr></thead><tbody>
        ${g.s.persons.map(p => `<tr><td>${esc(p.name)}</td><td>${p.share == null ? '–' : `${bar(p.share, `${pctText(p.share)} der Einträge`)} ${pctText(p.share)} <small>(${p.events})</small>`}</td><td>${p.doneCards}</td></tr>`).join('')}</tbody></table>`
        : '<p class="kp-hint">Noch keine Einträge mit Person.</p>'}
      ${g.s.contribTotal > g.s.contribWithWho ? `<p class="kp-hint">${g.s.contribTotal - g.s.contribWithWho} Einträge ohne Namen (niemand hatte „Ich bin …“ gewählt).</p>` : ''}
    </section>`).join('');
  body.innerHTML = `
    <p class="modal-intro">Mehrere Gruppendateien (.json) laden und vergleichen. <b>Rein lesend und nur in diesem Browser</b> – es wird nichts hochgeladen oder gespeichert; nach dem Schließen der Seite ist die Übersicht weg.</p>
    <div class="gr-drop" data-gdrop tabindex="-1">Dateien hierher ziehen oder <button type="button" class="btn-small accent" data-gact="pick">Dateien wählen …</button></div>
    ${groups.length ? `<div class="kp-tablewrap"><table class="kp-log gr-table"><thead><tr><th>Gruppe</th><th>Fortschritt</th><th>WIP jetzt</th><th>WIP überschritten</th><th>Blockaden</th><th>Durchlaufzeit (Median)</th><th>zuletzt aktiv</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 class="gr-sub">Beitragsanteile je Mitglied</h3>
      <p class="kp-hint">Gezählt werden Protokolleinträge zur Arbeit an Karten (anlegen, verschieben, ändern, Blocker, DoD) – ein Hinweis auf Aktivität, <b>kein Maß für Qualität</b>. Das Protokoll ist ein Arbeitsnachweis, kein Beweis.</p>
      ${contrib}` : ''}
    <div class="modal-buttons">${groups.length ? '<button type="button" class="btn-secondary" data-gact="clear">Liste leeren</button><button type="button" class="btn-secondary" data-gact="md">Als Markdown</button>' : ''}<button type="button" class="btn-primary" data-gact="close">Schließen</button></div>`;
}

function groupsMarkdown() {
  const L = ['# Gruppenübersicht', '', `Stand: ${new Date().toLocaleString('de-DE')}`, '',
    '> Rein lesend erstellt. Beitragsanteile zählen Protokolleinträge – ein Hinweis auf Aktivität, kein Maß für Qualität. Das Protokoll ist ein Arbeitsnachweis, kein Beweis.', '',
    '| Gruppe | erledigt | WIP jetzt | WIP überschritten | blockiert jetzt | Blockade gesamt | Durchlaufzeit (Median) |', '|---|---|---|---|---|---|---|'];
  for (const g of groups.filter(x => x.s)) {
    const s = g.s;
    L.push(`| ${mdCell(s.title)} | ${s.done}/${s.total} (${pctText(s.pct)}) | ${mdCell(s.wipNow.join(', ') || '–')} | ${s.wipExceeded} | ${s.blockedNow} | ${fmtDays(s.blockadeDays)} | ${fmtDays(s.leadMedian)} |`);
  }
  for (const g of groups.filter(x => x.s)) {
    L.push('', `## ${g.s.title}`, '');
    if (!g.s.persons.length) { L.push('_(keine Einträge mit Person)_'); continue; }
    L.push('| Mitglied | Anteil Protokolleinträge | erledigte Karten (zuständig) |', '|---|---|---|');
    for (const p of g.s.persons) L.push(`| ${mdCell(p.name)} | ${pctText(p.share)} (${p.events}) | ${p.doneCards} |`);
  }
  return L.join('\n') + '\n';
}

function bindGroups() {
  const box = $('groups-modal'), body = $('groups-body');
  if (!box || !body) return;
  body.addEventListener('click', e => {
    const del = e.target.closest('[data-gdel]');
    if (del) { groups.splice(Number(del.dataset.gdel), 1); renderGroups(); return; }
    const a = e.target.closest('[data-gact]');
    if (!a) return;
    if (a.dataset.gact === 'pick') pickFiles(addGroupFiles);
    else if (a.dataset.gact === 'clear') { groups = []; renderGroups(); }
    else if (a.dataset.gact === 'md') deliverFile(groupsMarkdown(), 'gruppenuebersicht.md', 'text/markdown');
    else if (a.dataset.gact === 'close') box.style.display = 'none';
  });
  // Ziehen und Ablegen von Dateien
  box.addEventListener('dragover', e => { e.preventDefault(); const z = body.querySelector('[data-gdrop]'); if (z) z.classList.add('over'); });
  box.addEventListener('dragleave', e => { if (e.target === box) { const z = body.querySelector('[data-gdrop]'); if (z) z.classList.remove('over'); } });
  box.addEventListener('drop', e => { e.preventDefault(); readFileList(e.dataTransfer && e.dataTransfer.files, addGroupFiles); });
  box.addEventListener('click', e => { if (e.target === box) box.style.display = 'none'; });
}
