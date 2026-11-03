'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Kanban-Prozess: Kennzahlen und Retrospektive
// (Bereiche der Kanban-Ansicht neben dem Board; Rechnung in mm-metrics.js)
//
// Diagramme sind schlankes SVG ohne Bibliothek. Jedes Diagramm hat eine
// Tabelle mit denselben Zahlen (Farbe ist nie die einzige Information),
// Werte erscheinen beim Zeigen, Tippen und per Tastatur (Pfeiltasten).
// ════════════════════════════════════════════════════════════════════

let kpPane = 'board';          // board | metrics | retro
let kpRetroId = null;          // gewählte Retrospektive
try { kpPane = localStorage.getItem('mm-kanban-pane') || 'board'; } catch (e) { /* egal */ }

const CFD_SERIES = [           // von unten nach oben gestapelt
  { key: 'done',  label: 'Erledigt',  color: 'var(--viz-done)' },
  { key: 'doing', label: 'In Arbeit', color: 'var(--viz-doing)' },
  { key: 'todo',  label: 'Offen',     color: 'var(--viz-todo)' },
];

function paneSwitch() {
  const b = (k, l) => `<button type="button" data-kpane="${k}" class="${kpPane === k ? 'on' : ''}" aria-pressed="${kpPane === k}">${l}</button>`;
  return `<div class="seg small" role="group" aria-label="Bereich">${b('board', 'Board')}${b('metrics', 'Kennzahlen')}${b('retro', 'Retrospektive')}</div>`;
}
function setPane(p) {
  kpPane = p;
  try { localStorage.setItem('mm-kanban-pane', p); } catch (e) { /* egal */ }
  renderKanbanProcess();
}

// ── Kennzahlen ──────────────────────────────────────────────────────
function tile(label, value, sub) {
  return `<div class="kp-tile"><span class="kp-tile-label">${esc(label)}</span><b class="kp-tile-value">${esc(value)}</b>${sub ? `<span class="kp-tile-sub">${esc(sub)}</span>` : ''}</div>`;
}

function metricsHtml(m) {
  const enough = m.cards.some(c => c.done != null) || m.cfd.length > 1;
  const head = `<div class="kp-tiles">
      ${tile('Erledigt', `${m.doneCount} von ${m.total}`, 'Karten')}
      ${tile('Durchlaufzeit', fmtDays(m.lead.median), m.lead.n ? `Median · Mittelwert ${fmtDays(m.lead.mean)}` : 'noch keine Karte erledigt')}
      ${tile('Bearbeitungszeit', fmtDays(m.cycle.median), m.cycle.n ? `Median · Mittelwert ${fmtDays(m.cycle.mean)}` : 'noch keine Karte erledigt')}
      ${tile('Durchsatz', fmtNum(m.throughput.mean), 'Karten je Woche (Mittelwert)')}
      ${tile('Blockiert', fmtDays(m.blockade.total), `insgesamt · ${m.blockade.cards} Karte(n)`)}
      ${tile('WIP-Limit überschritten', `${m.wipExceeded}-mal`, m.dodConfirmed ? `${m.dodConfirmed}-mal DoD bestätigt` : '')}
    </div>
    <p class="kp-hint kp-explain"><b>Durchlaufzeit</b>: vom Anlegen bis „Erledigt“ · <b>Bearbeitungszeit</b>: vom ersten „In Arbeit“ bis „Erledigt“ ·
      Karten aus der Zeit vor dem Prozess-Modus zählen ab dessen Beginn (${esc(new Date(m.boardStart).toLocaleDateString('de-DE'))}).
      Alle Zahlen stammen aus dem Protokoll – ein Arbeitsnachweis, kein Beweis.</p>`;
  if (!enough) return head + '<div class="view-empty">Noch zu wenig Daten. Die Diagramme füllen sich, sobald Karten verschoben und erledigt werden.</div>';
  const cardsRows = m.cards.filter(c => c.cat && c.cat !== 'idea').sort((a, b) => (b.done || 0) - (a.done || 0) || a.title.localeCompare(b.title, 'de'));
  return head + `
    <section class="kp-chart" aria-labelledby="kp-cfd-h">
      <h3 id="kp-cfd-h">Cumulative Flow – Karten je Tag</h3>
      <p class="kp-hint">Wird das Band „In Arbeit“ breiter, beginnt die Gruppe mehr, als sie abschließt. Ein flaches Band „Erledigt“ zeigt einen Stau.</p>
      ${legendHtml()}
      <div class="kp-svgwrap" data-chart="cfd"></div>
      <details><summary>Als Tabelle</summary><div class="kp-tablewrap"><table class="kp-log"><thead><tr><th>Tag</th>${CFD_SERIES.map(s => `<th>${s.label}</th>`).join('')}</tr></thead><tbody>
        ${m.cfd.map(r => `<tr><td>${esc(fmtLong(r.day))}</td>${CFD_SERIES.map(s => `<td>${r[s.key]}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>
    </section>
    <section class="kp-chart" aria-labelledby="kp-tp-h">
      <h3 id="kp-tp-h">Durchsatz – erledigte Karten je Woche</h3>
      <div class="kp-svgwrap" data-chart="throughput"></div>
      <details><summary>Als Tabelle</summary><table class="kp-log"><thead><tr><th>Woche</th><th>ab</th><th>erledigt</th></tr></thead><tbody>
        ${m.weeks.map(w => `<tr><td>${esc(w.label)}</td><td>${esc(fmtLong(w.monday))}</td><td>${w.count}</td></tr>`).join('')}</tbody></table></details>
    </section>
    <section class="kp-chart" aria-labelledby="kp-cards-h">
      <h3 id="kp-cards-h">Je Karte</h3>
      <div class="kp-tablewrap"><table class="kp-log"><thead><tr><th>Karte</th><th>Status</th><th>Durchlaufzeit</th><th>Bearbeitungszeit</th><th>blockiert</th></tr></thead><tbody>
        ${cardsRows.map(c => `<tr><td>${esc(c.title)}</td><td>${esc(statusLabel(c.cat))}</td><td>${fmtDays(c.lead)}${c.lead != null && c.fromBoardStart ? ' *' : ''}</td><td>${fmtDays(c.cycle)}</td><td>${c.blocked ? fmtDays(c.blocked) + (c.blockedNow ? ' (noch)' : '') : '–'}</td></tr>`).join('')}
      </tbody></table></div>
      ${cardsRows.some(c => c.lead != null && c.fromBoardStart) ? '<p class="kp-hint">* Karte gab es schon vor dem Prozess-Modus – gezählt ab dessen Beginn.</p>' : ''}
    </section>`;
}

function legendHtml() {
  return `<div class="kp-legend">${CFD_SERIES.slice().reverse().map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
}

/** Diagramme in ihre Platzhalter zeichnen (Breite = verfügbarer Platz). */
function drawCharts(host, m) {
  const cfdBox = host.querySelector('[data-chart="cfd"]');
  if (cfdBox) cfdBox.innerHTML = cfdSvg(m, Math.max(320, cfdBox.clientWidth));
  const tpBox = host.querySelector('[data-chart="throughput"]');
  if (tpBox) tpBox.innerHTML = throughputSvg(m, Math.max(320, tpBox.clientWidth));
}

function niceMax(v) {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const step = v <= 10 ? 2 : v <= 25 ? 5 : 10;
  return Math.ceil(v / step) * step;
}
function yTicks(max) {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
  const out = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

function cfdSvg(m, W) {
  const H = 240, L = 34, R = 92, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const rows = m.cfd;
  const maxV = niceMax(Math.max(1, ...rows.map(r => r.todo + r.doing + r.done)));
  const x = i => L + (rows.length === 1 ? pw / 2 : i * pw / (rows.length - 1));
  const y = v => T + ph - v * ph / maxV;
  let svg = `<svg class="kp-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative Flow: Karten je Tag nach Status. Werte in der Tabelle darunter." tabindex="0" data-cfd>`;
  for (const v of yTicks(maxV)) svg += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="kp-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="kp-axis" text-anchor="end">${v}</text>`;
  // gestapelte Flächen: jede Schicht von ihrer Unterkante bis zur Oberkante
  let base = rows.map(() => 0);
  const tops = {};
  for (const s of CFD_SERIES) {
    const top = rows.map((r, i) => base[i] + r[s.key]);
    tops[s.key] = top;
    const pts = top.map((v, i) => `${x(i)},${y(v)}`).concat(base.map((v, i) => `${x(i)},${y(v)}`).reverse());
    svg += `<polygon points="${pts.join(' ')}" style="fill:${s.color}" class="kp-band"/>`;
    base = top;
  }
  // direkte Beschriftung am rechten Rand, nur wenn das Band hoch genug ist
  const last = rows.length - 1;
  let below = 0;
  for (const s of CFD_SERIES) {
    const v = rows[last][s.key];
    const mid = y(below + v / 2);
    if (v && (v * ph / maxV) >= 14) svg += `<text x="${L + pw + 8}" y="${mid + 4}" class="kp-dlabel">${s.label} ${v}</text>`;
    below += v;
  }
  // x-Achse: höchstens ~8 Datumsangaben
  const every = Math.max(1, Math.ceil(rows.length / 8));
  rows.forEach((r, i) => { if (i % every === 0 || i === last) svg += `<text x="${x(i)}" y="${H - 8}" class="kp-axis" text-anchor="middle">${esc(fmtShort(r.day))}</text>`; });
  svg += `<line class="kp-cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" style="display:none"/>`;
  svg += `<rect class="kp-hit" x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" data-n="${rows.length}" data-l="${L}" data-pw="${pw}"/>`;
  return svg + '</svg>';
}

function throughputSvg(m, W) {
  const H = 200, L = 34, R = 12, T = 18, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const ws = m.weeks;
  const maxV = niceMax(Math.max(1, ...ws.map(w => w.count)));
  const slot = pw / ws.length;
  const bw = Math.min(24, slot * 0.6);
  const y = v => T + ph - v * ph / maxV;
  let svg = `<svg class="kp-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Durchsatz: erledigte Karten je Kalenderwoche. Werte in der Tabelle darunter.">`;
  for (const v of yTicks(maxV)) svg += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="kp-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="kp-axis" text-anchor="end">${v}</text>`;
  const every = Math.max(1, Math.ceil(ws.length / 10));
  ws.forEach((w, i) => {
    const cx = L + slot * i + slot / 2;
    const h = w.count * ph / maxV;
    if (h > 0) {
      // 4 px abgerundet oben, unten gerade an der Grundlinie
      const r = Math.min(4, h, bw / 2), x0 = cx - bw / 2, y0 = y(w.count), yb = T + ph;
      svg += `<path class="kp-bar" d="M${x0} ${yb} V${y0 + r} Q${x0} ${y0} ${x0 + r} ${y0} H${x0 + bw - r} Q${x0 + bw} ${y0} ${x0 + bw} ${y0 + r} V${yb} Z"/>`;
      svg += `<text x="${cx}" y="${y0 - 5}" class="kp-dlabel" text-anchor="middle">${w.count}</text>`;
    }
    // Trefferfläche größer als die Säule: die ganze Spalte
    svg += `<rect class="kp-hitbar" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ph}" fill="transparent" tabindex="0" role="img" aria-label="${esc(w.label)}: ${w.count} erledigt" data-tip="${esc(w.label + ' (ab ' + fmtLong(w.monday) + ')')}" data-val="${w.count}"/>`;
    if (i % every === 0 || i === ws.length - 1) svg += `<text x="${cx}" y="${H - 8}" class="kp-axis" text-anchor="middle">${esc(w.label)}</text>`;
  });
  return svg + '</svg>';
}

// ── Tooltip (ein gemeinsamer für alle Diagramme) ─────────────────────
function tipEl() {
  let el = $('kp-tip');
  if (!el) { el = document.createElement('div'); el.id = 'kp-tip'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  return el;
}
/** rows = [[Wert, Beschriftung, Farbe?]] – Werte zuerst, per textContent (keine HTML-Einschleusung) */
function showTip(x, y, title, rows) {
  const el = tipEl();
  el.textContent = '';
  const h = document.createElement('div'); h.className = 'kp-tip-title'; h.textContent = title; el.appendChild(h);
  for (const [v, l, c] of rows) {
    const r = document.createElement('div'); r.className = 'kp-tip-row';
    if (c) { const k = document.createElement('i'); k.style.background = c; r.appendChild(k); }
    const b = document.createElement('b'); b.textContent = v; r.appendChild(b);
    r.appendChild(document.createTextNode(' ' + l));
    el.appendChild(r);
  }
  el.style.display = 'block';
  const w = el.offsetWidth, hh = el.offsetHeight;
  el.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x + 14)) + 'px';
  el.style.top = Math.max(6, Math.min(window.innerHeight - hh - 6, y - hh - 10)) + 'px';
}
function hideTip() { const el = $('kp-tip'); if (el) el.style.display = 'none'; }

let kpMetrics = null;     // zuletzt gezeichnete Kennzahlen (für den Tooltip)
let cfdIndex = -1;

function cfdShow(svg, i, clientX, clientY) {
  const rows = kpMetrics.cfd;
  i = Math.max(0, Math.min(rows.length - 1, i));
  cfdIndex = i;
  const hit = svg.querySelector('.kp-hit');
  const L = +hit.dataset.l, pw = +hit.dataset.pw;
  const px = L + (rows.length === 1 ? pw / 2 : i * pw / (rows.length - 1));
  const line = svg.querySelector('.kp-cross');
  line.setAttribute('x1', px); line.setAttribute('x2', px); line.style.display = '';
  const r = rows[i];
  const box = svg.getBoundingClientRect();
  showTip(clientX != null ? clientX : box.left + px, clientY != null ? clientY : box.top + 40, fmtLong(r.day),
    CFD_SERIES.slice().reverse().map(s => [String(r[s.key]), s.label, s.color]));
}

function bindInsights(host) {
  // Zeigen (Maus) und Antippen (Finger) zeigen dieselben Werte
  const onPoint = e => {
    const hit = e.target.closest && e.target.closest('.kp-hit');
    if (hit && kpMetrics) {
      const svg = hit.ownerSVGElement, box = svg.getBoundingClientRect();
      const n = +hit.dataset.n, L = +hit.dataset.l, pw = +hit.dataset.pw;
      const i = n === 1 ? 0 : Math.round((e.clientX - box.left - L) / pw * (n - 1));
      cfdShow(svg, i, e.clientX, e.clientY);
      return;
    }
    const bar = e.target.closest && e.target.closest('.kp-hitbar');
    if (bar) { showTip(e.clientX, e.clientY, bar.dataset.tip, [[bar.dataset.val, 'erledigt']]); bar.classList.add('hover'); return; }
  };
  host.addEventListener('pointermove', onPoint);
  host.addEventListener('pointerdown', onPoint);
  host.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch') return;       // beim Tippen stehen lassen, bis woanders hingetippt wird
    if (e.target.closest && (e.target.closest('.kp-hit') || e.target.closest('.kp-hitbar'))) {
      hideTip();
      host.querySelectorAll('.kp-cross').forEach(l => { l.style.display = 'none'; });
      host.querySelectorAll('.kp-hitbar.hover').forEach(b => b.classList.remove('hover'));
    }
  });
  // Tastatur: Diagramm fokussieren, Pfeiltasten wandern durch die Tage
  host.addEventListener('keydown', e => {
    const svg = e.target.closest && e.target.closest('[data-cfd]');
    if (!svg || !kpMetrics || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault();
    const n = kpMetrics.cfd.length;
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (cfdIndex < 0 ? n - 1 : cfdIndex + (e.key === 'ArrowLeft' ? -1 : 1));
    cfdShow(svg, i);
  });
  host.addEventListener('focusin', e => {
    const svg = e.target.closest && e.target.closest('[data-cfd]');
    if (svg && kpMetrics) cfdShow(svg, cfdIndex < 0 ? kpMetrics.cfd.length - 1 : cfdIndex);
    const bar = e.target.closest && e.target.closest('.kp-hitbar');
    if (bar) { const b = bar.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top + 30, bar.dataset.tip, [[bar.dataset.val, 'erledigt']]); }
  });
  host.addEventListener('focusout', e => {
    if (e.target.closest && (e.target.closest('[data-cfd]') || e.target.closest('.kp-hitbar'))) { hideTip(); }
    if (e.target.matches && e.target.matches('[data-rq], [data-rtitle]')) setTimeout(() => { if (kpPane === 'retro') renderKanbanProcess(); }, 0);
  });
  host.addEventListener('input', e => {
    const q = e.target.dataset.rq, id = kpRetroId;
    if (q && id && doc.retros[id]) mutate('Retrospektive', () => { doc.retros[id][q] = e.target.value.slice(0, 4000); }, { merge: 'retro:' + id + ':' + q });
    if (e.target.dataset.rtitle != null && id && doc.retros[id]) mutate('Retrospektive', () => { doc.retros[id].title = e.target.value.slice(0, 80); }, { merge: 'retro:' + id + ':title' });
  });
  // Tippen außerhalb eines Diagramms blendet den Wert wieder aus
  document.addEventListener('pointerdown', e => {
    if (!(e.target.closest && (e.target.closest('.kp-hit') || e.target.closest('.kp-hitbar')))) {
      hideTip();
      host.querySelectorAll('.kp-cross').forEach(l => { l.style.display = 'none'; });
    }
  }, true);
  host.addEventListener('click', e => {
    const pane = e.target.closest('[data-kpane]');
    if (pane) { setPane(pane.dataset.kpane); return; }
    const r = e.target.closest('[data-retro]');
    if (r) { kpRetroId = r.dataset.retro; renderKanbanProcess(); return; }
    const a = e.target.closest('[data-kr]');
    if (!a) return;
    // Fokus sofort setzen (nicht verzögert), sonst springt er zurück, wenn jemand schnell weitertippt
    if (a.dataset.kr === 'new') { kpRetroId = createRetro(); renderKanbanProcess(); const t = host.querySelector('[data-rq="q1"]'); if (t) t.focus(); }
    else if (a.dataset.kr === 'export' && doc.retros[kpRetroId]) {
      deliverFile(retroMarkdown(doc.retros[kpRetroId]), baseName() + '_retrospektive.md', 'text/markdown');
    } else if (a.dataset.kr === 'delete' && doc.retros[kpRetroId]) {
      if (!confirm('Diese Retrospektive löschen?')) return;
      const id = kpRetroId;
      mutate('Retrospektive löschen', () => { delete doc.retros[id]; });
      kpRetroId = null;
    }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'kanban' && kanbanProcess() && kpPane === 'metrics' && kpMetrics) drawCharts(host, kpMetrics); }, 150);
  });
}

// ── Retrospektive ───────────────────────────────────────────────────
function retroHtml() {
  const list = retroList();
  if (kpRetroId && !doc.retros[kpRetroId]) kpRetroId = null;
  if (!kpRetroId && list.length) kpRetroId = list[0].id;
  const r = kpRetroId ? doc.retros[kpRetroId] : null;
  const ro = readOnly ? ' disabled' : '';
  const side = `<div class="kp-retrolist" role="list">
      ${readOnly ? '' : '<button type="button" class="btn-small accent" data-kr="new">+ Neue Retrospektive</button>'}
      ${list.map(x => `<button type="button" class="kp-retroitem${x.id === kpRetroId ? ' on' : ''}" data-retro="${esc(x.id)}" aria-pressed="${x.id === kpRetroId}">${esc(x.title || 'Retrospektive')}</button>`).join('')}
    </div>`;
  if (!r) {
    return `<div class="kp-retro">${side}<div class="view-empty">Eine Retrospektive hilft, aus dem Projekt zu lernen: Was lief gut, wo hakte es, was ändern wir?
      Sie friert die aktuellen Kennzahlen ein; die Antworten werden in der Datei gespeichert.${readOnly ? '' : '<br><br>Oben links: <b>+ Neue Retrospektive</b>.'}</div></div>`;
  }
  return `<div class="kp-retro">${side}<div class="kp-retrobody">
      <div class="insp-field"><label for="kp-rtitle">Titel</label><input id="kp-rtitle" data-rtitle value="${esc(r.title || '')}"${ro}></div>
      <div class="kp-tiles small">${summaryRows(r.snapshot || {}).map(([l, v]) => tile(l, v)).join('')}</div>
      <p class="kp-hint">Kennzahlen vom ${esc(new Date((r.snapshot && r.snapshot.t) || r.created).toLocaleString('de-DE'))} – Verlauf unter „Kennzahlen“. Bitte nur über die Arbeit schreiben, keine Bewertungen einzelner Personen.</p>
      ${RETRO_QUESTIONS.map(q => `<div class="insp-field kp-q"><label for="kp-${q.key}">${esc(q.text)}</label><span class="kp-hint">${esc(q.hint)}</span>
        <textarea id="kp-${q.key}" data-rq="${q.key}" rows="3"${ro}>${esc(r[q.key] || '')}</textarea></div>`).join('')}
      <div class="modal-buttons">
        ${readOnly ? '' : '<button type="button" class="btn-secondary danger" data-kr="delete">Löschen</button>'}
        <button type="button" class="btn-secondary" data-kr="export">Als Markdown exportieren</button>
      </div></div></div>`;
}

/** Inhalt des gewählten Bereichs (Kennzahlen oder Retrospektive) zeichnen. */
function renderInsightPane(box) {
  if (kpPane === 'metrics') {
    kpMetrics = computeMetrics(doc, nowSynced());
    box.innerHTML = metricsHtml(kpMetrics);
    drawCharts(box, kpMetrics);
  } else {
    box.innerHTML = retroHtml();
  }
}
