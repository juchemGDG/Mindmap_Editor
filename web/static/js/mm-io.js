'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Dateien: Speichern/Laden, Import/Export, Vorlagen,
// Desktop-Brücke, Einbettung (?embed=1), Download der Desktop-Version
// ════════════════════════════════════════════════════════════════════

const PARAMS = new URLSearchParams(location.search);
const EMBED = PARAMS.get('embed') === '1' && window.parent !== window;
const DESKTOP = PARAMS.get('desktop') === '1';
let dirty = false;

/** Ungespeicherte Änderungen merken (die Desktop-Version fragt dann beim Schließen nach). */
function setDirty(v) {
  v = !!v && Object.keys(doc.nodes).length > 1;
  if (v === dirty) return;
  dirty = v;
  const api = desktopApi();
  if (api && api.set_dirty) api.set_dirty(v).catch(() => {});
}

function desktopApi() { return window.pywebview && window.pywebview.api ? window.pywebview.api : null; }

function baseName() {
  const t = (M().title || label(index().rid) || 'mindmap').trim();
  return t.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'mindmap';
}

// ── Herunterladen bzw. speichern ────────────────────────────────────
const DOWNLOAD_GAP = 600;
let nextDownloadAt = 0;

/** Datei ausgeben: Desktop = Speichern-Dialog, eingebettet = an den Host, sonst Download. */
function deliverFile(content, name, mime) {
  const api = desktopApi();
  if (api) {
    const isBlob = content instanceof Blob;
    const send = (data, b64) => api.save_file(name, data, b64).then(path => {
      if (path) { flashStatus('Gespeichert: ' + path); if (/\.json$/i.test(name)) setDirty(false); }
    }).catch(err => showModal('Speichern', 'Speichern fehlgeschlagen: ' + err));
    if (isBlob) {
      const rd = new FileReader();
      rd.onload = () => send(String(rd.result).split(',')[1], true);
      rd.readAsDataURL(content);
    } else send(content, false);
    return;
  }
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
  if (EMBED && embedHostDownloads) {
    embedSend({ event: 'download', name, mime: blob.type || 'application/octet-stream', blob }, embedOrigin);
    flashStatus(`${name} an die einbettende Seite übergeben`);
    return;
  }
  const now = Date.now(), wait = Math.max(0, nextDownloadAt - now);
  nextDownloadAt = now + wait + DOWNLOAD_GAP;
  const go = () => {
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  if (wait) setTimeout(go, wait); else go();
  if (/\.json$/i.test(name)) setDirty(false);
}

function saveMap() {
  if (editing) commitEdit();
  deliverFile(JSON.stringify(docPayload(), null, 1), baseName() + '.json', 'application/json');
}

function confirmDiscard() {
  if (!dirty || Object.keys(doc.nodes).length <= 1) return true;
  return confirm('Nicht gespeicherte Änderungen gehen verloren. Trotzdem fortfahren?');
}

// ── Öffnen ──────────────────────────────────────────────────────────
function pickFile(accept, cb) {
  const api = desktopApi();
  if (api) {
    api.open_file(accept).then(res => { if (res) cb(res.name, res.data); })
      .catch(err => showModal('Öffnen', 'Öffnen fehlgeschlagen: ' + err));
    return;
  }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept;
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => cb(f.name, String(r.result));
    r.readAsText(f);
  };
  inp.click();
}

function openMap() {
  if (!confirmDiscard()) return;
  pickFile('.json,.mm,.opml,.md,.txt,.markdown', (name, text) => {
    try {
      const d = parseAnyFile(name, text);
      if (!d) { showModal('Öffnen', 'Diese Datei konnte nicht gelesen werden.'); return; }
      if (!/\.json$/i.test(name) && d.meta && d.meta.m) d.meta.m.title = name.replace(/\.[^.]+$/, '');
      leaveRoomSilently();
      replaceDoc(d);
      afterDocLoaded();
      setDirty(false);
      flashStatus('Geöffnet: ' + name);
    } catch (err) {
      showModal('Öffnen', 'Fehler beim Laden: ' + err.message);
    }
  });
}

/** Unterpunkte aus einer Datei unter dem markierten Knoten einfügen. */
function importIntoMap() {
  pickFile('.json,.mm,.opml,.md,.txt,.markdown', (name, text) => {
    try {
      const d = parseAnyFile(name, text);
      if (!d) { showModal('Importieren', 'Diese Datei konnte nicht gelesen werden.'); return; }
      const norm = normalizeDoc(d);
      const saved = doc;
      doc = norm; invalidate();
      const rid = rootId();
      const data = extractSubtrees([rid]);
      doc = saved; invalidate();
      const target = primary() || index().rid;
      let out = [];
      mutate('Importieren', () => { out = insertSubtrees(data, target); });
      select(out);
      flashStatus('Importiert: ' + name);
    } catch (err) { showModal('Importieren', 'Fehler: ' + err.message); }
  });
}

function parseAnyFile(name, text) {
  const t = String(text).replace(/^\uFEFF/, '');
  const trimmed = t.trim();
  if (/\.json$/i.test(name) || trimmed.startsWith('{')) {
    const p = JSON.parse(trimmed);
    if (p && (p.format === FORMAT || (p.doc && p.doc.nodes) || p.nodes)) return p;
    throw new Error('Das ist keine Datei des Mindmap Editors.');
  }
  if (/<opml/i.test(trimmed)) return fromOpml(trimmed);
  if (/<map[\s>]/i.test(trimmed)) return fromFreeMind(trimmed);
  return fromIndentedText(t, name);
}

function treeToDoc(rootText, build) {
  const d = emptyDoc(rootText);
  const add = (parent, items) => {
    items.forEach((it, i) => {
      const id = uid('n');
      d.nodes[id] = Object.assign({ id, parent, order: i + 1, text: it.text || '' }, it.extra || {});
      add(id, it.children || []);
    });
  };
  add('root', build);
  return d;
}

function fromIndentedText(text, name) {
  const data = parseIndentedText(text);
  if (!data) return null;
  // eine einzelne oberste Zeile wird das Zentralthema
  if (data.top.length === 1) {
    const d = emptyDoc(data.nodes[data.top[0]].text);
    for (const id in data.nodes) {
      if (id === data.top[0]) continue;
      const n = Object.assign({}, data.nodes[id]);
      if (n.parent === data.top[0]) n.parent = 'root';
      d.nodes[id] = n;
    }
    return d;
  }
  const d = emptyDoc((name || 'Import').replace(/\.[^.]+$/, ''));
  for (const id in data.nodes) {
    const n = Object.assign({}, data.nodes[id]);
    if (!n.parent) n.parent = 'root';
    d.nodes[id] = n;
  }
  return d;
}

function fromOpml(xml) {
  const dom = new DOMParser().parseFromString(xml, 'text/xml');
  const body = dom.querySelector('body');
  if (!body) return null;
  const conv = el => [...el.children].filter(c => c.tagName.toLowerCase() === 'outline').map(c => {
    const extra = {};
    const note = c.getAttribute('_note'); if (note) extra.note = note;
    const url = c.getAttribute('url') || c.getAttribute('htmlUrl'); if (url) extra.link = url;
    if (c.getAttribute('_status')) { extra.task = true; extra.status = c.getAttribute('_status'); }
    return { text: c.getAttribute('text') || c.getAttribute('title') || '', extra, children: conv(c) };
  });
  const top = conv(body);
  const title = (dom.querySelector('head > title') || {}).textContent || '';
  if (top.length === 1) return treeToDoc(top[0].text, top[0].children);
  return treeToDoc(title || 'Import', top);
}

function fromFreeMind(xml) {
  const dom = new DOMParser().parseFromString(xml, 'text/xml');
  const root = dom.querySelector('map > node');
  if (!root) return null;
  const conv = el => [...el.children].filter(c => c.tagName === 'node').map(c => {
    const extra = {};
    if (c.getAttribute('LINK')) extra.link = c.getAttribute('LINK');
    if (c.getAttribute('FOLDED') === 'true') extra.collapsed = true;
    const pos = c.getAttribute('POSITION');
    if (pos) extra.side = pos === 'left' ? 'L' : 'R';
    return { text: c.getAttribute('TEXT') || '', extra, children: conv(c) };
  });
  return treeToDoc(root.getAttribute('TEXT') || 'Mindmap', conv(root));
}

// ── Bilder ──────────────────────────────────────────────────────────
function exportBounds() {
  if (needLayout) { layoutMap(); needLayout = false; }
  const b = LAY_BOUNDS;
  const pad = 40;
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

function renderToCanvas(scale) {
  const b = exportBounds();
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const s = Math.min(scale || 2, 8000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
  const x = c.getContext('2d');
  x.fillStyle = T().bg;
  x.fillRect(0, 0, c.width, c.height);
  x.setTransform(s, 0, 0, s, -b.x0 * s, -b.y0 * s);
  drawMap(canvasPainter(x), { noUi: true });
  return c;
}

function exportImage(fmt) {
  if (editing) commitEdit();
  const c = renderToCanvas(2);
  const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
  c.toBlob(blob => deliverFile(blob, baseName() + '.' + fmt, mime), mime, 0.92);
}

function buildSVG() {
  const b = exportBounds();
  const p = svgPainter();
  drawMap(p, { noUi: true });
  const w = Math.ceil(b.x1 - b.x0), h = Math.ceil(b.y1 - b.y0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x0} ${b.y0} ${w} ${h}">` +
    `<rect x="${b.x0}" y="${b.y0}" width="${w}" height="${h}" fill="${T().bg}"/>` + p.parts.join('') + '</svg>';
}
function exportSVG() { if (editing) commitEdit(); deliverFile(buildSVG(), baseName() + '.svg', 'image/svg+xml'); }

// ── Text-Formate ────────────────────────────────────────────────────
function taskSuffix(n) {
  const parts = [];
  if (n.owner) parts.push('@' + n.owner);
  if (n.start && n.start !== n.due) parts.push('ab ' + fmtLong(n.start));
  if (n.due) parts.push('bis ' + fmtLong(n.due));
  if (n.prio) parts.push('Priorität ' + PRIOS[n.prio].label);
  return parts.length ? ' (' + parts.join(', ') + ')' : '';
}

function toMarkdown() {
  const rid = index().rid;
  const lines = [`# ${label(rid)}`, ''];
  if (doc.nodes[rid].note) lines.push(doc.nodes[rid].note, '');
  for (const b of kids(rid)) {
    const n = doc.nodes[b];
    lines.push(`## ${n.task ? (n.status === 'done' ? '[x] ' : '[ ] ') : ''}${label(b)}${n.task ? taskSuffix(n) : ''}`, '');
    if (n.note) lines.push(n.note, '');
    const walk = (id, d) => {
      const m = doc.nodes[id];
      const box = m.task ? (m.status === 'done' ? '[x] ' : m.status === 'doing' ? '[~] ' : '[ ] ') : '';
      lines.push(`${'  '.repeat(d)}- ${box}${(m.text || '').replace(/\n/g, ' ')}${m.task ? taskSuffix(m) : ''}`);
      if (m.note) lines.push(...m.note.split('\n').map(l => `${'  '.repeat(d + 1)}> ${l}`));
      if (m.link) lines.push(`${'  '.repeat(d + 1)}<${m.link}>`);
      for (const c of kids(id)) walk(c, d + 1);
    };
    for (const c of kids(b)) walk(c, 0);
    lines.push('');
  }
  const ls = Object.values(doc.links).filter(l => doc.nodes[l.from] && doc.nodes[l.to]);
  if (ls.length) {
    lines.push('## Querverbindungen', '');
    for (const l of ls) lines.push(`- ${label(l.from)} → ${label(l.to)}${l.label ? ' (' + l.label + ')' : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

function toTaskMarkdown() {
  const rid = index().rid;
  const lines = [`# Plan: ${label(rid)}`, '', `Stand: ${fmtLong(todayISO())}`, ''];
  for (const b of kids(rid)) {
    const ts = descendants(b, true).filter(isTask);
    const ordered = treeOrder(b).filter(id => ts.includes(id));
    if (!ordered.length) continue;
    const pr = ordered.filter(id => statusOf(id) === 'done').length;
    lines.push(`## ${label(b)} (${pr}/${ordered.length} erledigt)`, '');
    for (const id of ordered) {
      const n = doc.nodes[id];
      const box = n.status === 'done' ? '[x]' : '[ ]';
      const path = ancestors(id).reverse().slice(2).map(label).join(' › ');
      lines.push(`- ${box} ${label(id)}${n.status === 'doing' ? ' – in Arbeit' : ''}${taskSuffix(n)}${path ? `  _(${path})_` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function toOpml() {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<opml version="2.0">`, `<head><title>${xmlEsc(M().title || '')}</title></head>`, `<body>`];
  const walk = (id, d) => {
    const n = doc.nodes[id];
    const attrs = [`text="${xmlEsc(n.text || '')}"`];
    if (n.note) attrs.push(`_note="${xmlEsc(n.note)}"`);
    if (n.link) attrs.push(`url="${xmlEsc(n.link)}"`);
    if (n.task) attrs.push(`_status="${xmlEsc(n.status || 'todo')}"`);
    const ch = kids(id);
    if (!ch.length) out.push(`${'  '.repeat(d)}<outline ${attrs.join(' ')}/>`);
    else {
      out.push(`${'  '.repeat(d)}<outline ${attrs.join(' ')}>`);
      for (const c of ch) walk(c, d + 1);
      out.push(`${'  '.repeat(d)}</outline>`);
    }
  };
  walk(index().rid, 1);
  out.push('</body>', '</opml>');
  return out.join('\n');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv() {
  const head = ['Aufgabe', 'Hauptast', 'Pfad', 'Status', 'Zuständig', 'Start', 'Fällig', 'Priorität', 'Punkte', 'Abhängig von', 'Notiz'];
  const rows = [head];
  for (const id of treeOrder().filter(isTask)) {
    const n = doc.nodes[id];
    rows.push([
      label(id), branchOf(id) ? label(branchOf(id)) : '', pathText(id), STATUS.find(s => s.key === statusOf(id)).label,
      n.owner || '', n.start ? fmtLong(n.start) : '', n.due ? fmtLong(n.due) : '', n.prio ? PRIOS[n.prio].label : '',
      votesOf(id) || '', (n.deps || []).filter(d => doc.nodes[d]).map(label).join(', '), n.note || '',
    ]);
  }
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}

function icsText(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function toIcs() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mindmap Editor//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(M().title || label(index().rid))}`];
  let n = 0;
  for (const id of treeOrder().filter(isTask)) {
    const t = doc.nodes[id];
    const r = taskRange(id);
    if (!r) continue;
    n++;
    lines.push('BEGIN:VEVENT', `UID:${id}@mindmap-editor`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${r.s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(r.e, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsText((t.status === 'done' ? '✓ ' : '') + label(id))}`,
      `DESCRIPTION:${icsText([pathText(id), t.owner ? 'Zuständig: ' + t.owner : '', t.note || ''].filter(Boolean).join('\n'))}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count: n };
}

function exportAs(kind) {
  if (editing) commitEdit();
  const b = baseName();
  switch (kind) {
    case 'png': exportImage('png'); break;
    case 'jpg': exportImage('jpg'); break;
    case 'svg': exportSVG(); break;
    case 'md': deliverFile(toMarkdown(), b + '.md', 'text/markdown'); break;
    case 'tasks-md':
      if (!treeOrder().some(isTask)) { showModal('Aufgabenliste', 'Es gibt noch keine Aufgaben. Nutze „Zum Plan machen“ oder markiere Punkte als Aufgabe.'); break; }
      deliverFile(toTaskMarkdown(), b + '_aufgaben.md', 'text/markdown'); break;
    case 'opml': deliverFile(toOpml(), b + '.opml', 'text/x-opml'); break;
    case 'csv':
      if (!treeOrder().some(isTask)) { showModal('Aufgaben als CSV', 'Es gibt noch keine Aufgaben.'); break; }
      deliverFile(toCsv(), b + '_aufgaben.csv', 'text/csv'); break;
    case 'ics': {
      const r = toIcs();
      if (!r.count) { showModal('Kalender', 'Keine Aufgabe hat einen Termin. Termine vergibst du im Eigenschaften-Feld oder im Zeitplan.'); break; }
      deliverFile(r.text, b + '_termine.ics', 'text/calendar'); break;
    }
    case 'print': printMap(); break;
  }
}

/** Drucken bzw. als PDF sichern (über den Druckdialog des Browsers). */
function printMap() {
  const area = $('print-area');
  if (!area) return;
  const svg = buildSVG().replace(/^<\?xml[^>]*>\s*/, '');
  let html = `<div class="print-page"><h1>${esc(M().title || label(index().rid))}</h1><div class="print-map">${svg}</div></div>`;
  const tasks = treeOrder().filter(isTask);
  if (tasks.length) {
    html += `<div class="print-page"><h1>Aufgaben</h1><table><thead><tr><th></th><th>Aufgabe</th><th>Ast</th><th>Zuständig</th><th>Termin</th><th>Priorität</th></tr></thead><tbody>` +
      tasks.map(id => { const n = doc.nodes[id]; return `<tr><td>${n.status === 'done' ? '☑' : n.status === 'doing' ? '◐' : '☐'}</td><td>${esc(label(id))}</td><td>${esc(branchOf(id) ? label(branchOf(id)) : '')}</td><td>${esc(n.owner || '')}</td><td>${n.start && n.start !== n.due ? fmtLong(n.start) + ' – ' : ''}${n.due ? fmtLong(n.due) : ''}</td><td>${n.prio ? PRIOS[n.prio].label : ''}</td></tr>`; }).join('') +
      `</tbody></table></div>`;
  }
  area.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}

// ════════════════════════════════════════════════════════════════════
// Vorlagen
// ════════════════════════════════════════════════════════════════════
const TEMPLATES = [
  { key: 'empty', title: 'Leere Mindmap', desc: 'Nur ein Zentralthema', root: 'Zentralthema', tree: [] },
  { key: 'ws', title: 'Brainstorming (W-Fragen)', desc: 'Wer? Was? Wann? Wo? Warum? Wie?', root: 'Thema', tree: ['Wer?', 'Was?', 'Wann?', 'Wo?', 'Warum?', 'Wie?'] },
  { key: 'project', title: 'Projektplanung', desc: 'Ziel, Aufgaben, Material, Termine, Risiken', root: 'Projekt', tree: [
    ['Ziel', ['Was soll am Ende fertig sein?', 'Woran erkennen wir Erfolg?']],
    ['Aufgaben', []], ['Material & Werkzeug', []], ['Team & Rollen', []],
    ['Termine', ['Start', 'Zwischenstand', 'Abgabe']], ['Risiken', ['Was kann schiefgehen?']]] },
  { key: 'lesson', title: 'Unterrichtsvorbereitung', desc: 'Ziele, Phasen, Material, Differenzierung', root: 'Stunde / Einheit', tree: [
    ['Lernziele', []], ['Einstieg', []], ['Erarbeitung', []], ['Sicherung', []],
    ['Material & Medien', []], ['Differenzierung', ['Unterstützung', 'Erweiterung']], ['Hausaufgabe', []]] },
  { key: 'procon', title: 'Pro & Contra', desc: 'Argumente sammeln und abwägen', root: 'Entscheidung', tree: ['Pro', 'Contra', 'Offene Fragen', 'Fazit'] },
  { key: 'cause', title: 'Ursachen finden', desc: 'Ishikawa: Mensch, Maschine, Methode …', root: 'Problem', tree: ['Mensch', 'Maschine', 'Methode', 'Material', 'Messung', 'Umwelt'] },
  { key: 'talk', title: 'Referat / Präsentation', desc: 'Vom Thema bis zur Generalprobe', root: 'Referat', tree: [
    ['Thema eingrenzen', ['Leitfrage']], ['Recherche', ['Quellen']], ['Gliederung', ['Einleitung', 'Hauptteil', 'Schluss']],
    ['Folien & Medien', []], ['Proben', []]] },
];

function templateDoc(t) {
  const items = t.tree.map(x => Array.isArray(x) ? { text: x[0], children: x[1].map(s => ({ text: s })) } : { text: x });
  const d = treeToDoc(t.root, items);
  return d;
}

function showTemplates() {
  const box = $('template-modal');
  const list = $('template-list');
  if (!box || !list) return;
  list.innerHTML = TEMPLATES.map(t => `<button type="button" class="tpl" data-tpl="${t.key}"><b>${esc(t.title)}</b><span>${esc(t.desc)}</span></button>`).join('')
    + `<button type="button" class="tpl tpl-text" data-tpl="__text"><b>Aus Text erstellen …</b><span>Liste einfügen – Einrückung wird zur Struktur</span></button>`;
  box.style.display = 'flex';
}

function chooseTemplate(key) {
  $('template-modal').style.display = 'none';
  if (key === '__text') {
    showPrompt('Mindmap aus Text', 'Eine Zeile pro Punkt. Die erste Zeile ist das Zentralthema, eingerückte Zeilen (Leerzeichen oder Tab) werden Unterpunkte.', '', v => {
      if (!v || !v.trim()) return;
      if (!confirmDiscard()) return;
      leaveRoomSilently();
      replaceDoc(fromIndentedText(v, 'Mindmap'));
      afterDocLoaded();
    }, true, true);
    return;
  }
  const t = TEMPLATES.find(x => x.key === key);
  if (!t || !confirmDiscard()) return;
  leaveRoomSilently();
  replaceDoc(templateDoc(t));
  afterDocLoaded();
  setDirty(false);
  selectOne(index().rid);
  if (key === 'empty' || key === 'ws') setTimeout(() => startEdit(index().rid), 80);
}

function afterDocLoaded() {
  sel = new Set(); focusId = null; selLink = null; layoutRoot = null;
  searchHits = null;
  updateFocusBar();
  needLayout = true;
  layoutMap(); needLayout = false;
  fitView(false);
  // große Mindmaps nicht unlesbar klein zeigen: dann lieber auf das Zentralthema
  if (view.z < 0.45 && LAY[index().rid]) {
    const { w, h } = cssSize();
    const R = LAY[index().rid];
    view.z = 0.45; view.x = w / 2 - R.x * view.z; view.y = h / 2 - R.y * view.z;
    requestRender();
  }
  selectionChanged();
  applyMetaUi();
}

// ── Zwischenspeicher im Browser (nicht beim gemeinsamen Bearbeiten) ─
let autosaveTimer = null;
function scheduleAutosave() {
  if (EMBED || collabActive()) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem('mm-autosave', JSON.stringify(docPayload())); } catch (e) { /* voll oder privat */ }
  }, 700);
}
function restoreAutosave() {
  try {
    const s = localStorage.getItem('mm-autosave');
    if (!s) return false;
    replaceDoc(JSON.parse(s));
    return true;
  } catch (e) { return false; }
}

// ════════════════════════════════════════════════════════════════════
// Einbettung (?embed=1) – gleiches Protokoll wie beim PAP-Editor
//   Editor -> Host:  {source:'mindmap-editor', event:'ready'}
//   Host -> Editor:  {target:'mindmap-editor', action:'load', mindmap:<JSON wie "Speichern"|null>, title?, downloads?:true}
//   Editor -> Host:  {source:'mindmap-editor', event:'save', mindmap:<JSON>, svg:<SVG-Text>}
//   Editor -> Host:  {source:'mindmap-editor', event:'exit'}
//   Editor -> Host:  {source:'mindmap-editor', event:'download', name, mime, blob}
// (Statt `mindmap` wird auch `diagram` akzeptiert bzw. mitgeschickt.)
// ════════════════════════════════════════════════════════════════════
let embedOrigin = null;
let embedChanged = false;
let embedHostDownloads = false;

function embedSend(msg, origin) { window.parent.postMessage(Object.assign({ source: 'mindmap-editor' }, msg), origin); }

function embedLoad(msg) {
  const data = msg.mindmap || msg.diagram;
  try { replaceDoc(data && typeof data === 'object' ? data : templateDoc(TEMPLATES[0])); }
  catch (err) { alert('Die gespeicherte Mindmap konnte nicht geladen werden: ' + err.message); replaceDoc(emptyDoc()); }
  if (typeof msg.title === 'string' && msg.title && (!data || !data.doc || !data.doc.meta)) M().title = msg.title;
  afterDocLoaded();
  selectOne(index().rid);
  embedChanged = false;
  flashStatus('Mindmap geladen');
}

function embedSave() {
  if (!embedOrigin) { alert('Keine Verbindung zur einbettenden Seite.'); return; }
  if (editing) commitEdit();
  const payload = docPayload();
  embedSend({ event: 'save', mindmap: payload, diagram: payload, svg: buildSVG() }, embedOrigin);
  embedChanged = false;
  flashStatus('An das Projekt übergeben …');
}

function embedExit() {
  if (embedChanged && !confirm('Nicht übernommene Änderungen verwerfen?')) return;
  if (embedOrigin) embedSend({ event: 'exit' }, embedOrigin);
}

function initEmbed() {
  if (!EMBED) return;
  document.body.classList.add('embed');
  const bar = $('menubar');
  if (bar) {
    const close = document.createElement('button');
    close.className = 'btn-menu'; close.textContent = 'Schließen';
    close.addEventListener('click', embedExit);
    const save = document.createElement('button');
    save.className = 'btn-menu btn-accent'; save.textContent = 'In Projekt übernehmen';
    save.addEventListener('click', embedSave);
    bar.prepend(close); bar.prepend(save);
  }
  onChange(info => { if (info.local) embedChanged = true; });
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.target !== 'mindmap-editor') return;
    if (m.action === 'load') { embedOrigin = e.origin; embedHostDownloads = m.downloads === true; embedLoad(m); }
  });
  embedSend({ event: 'ready' }, '*');
}

// ════════════════════════════════════════════════════════════════════
// Download der Desktop-Version (wie beim PAP-Editor)
// ════════════════════════════════════════════════════════════════════
const GITHUB_REPO = 'juchemGDG/Mindmap_Editor';
const DOWNLOADS = [
  { key: 'macos',   os: 'macOS',   file: 'Mindmap-Editor.dmg',                 hint: 'Apple Silicon & Intel · .dmg' },
  { key: 'windows', os: 'Windows', file: 'Mindmap-Editor-Setup.exe',           hint: 'Installer · .exe' },
  { key: 'linux',   os: 'Linux',   file: 'Mindmap-Editor-linux-x86_64.tar.gz', hint: 'entpacken & starten · .tar.gz' },
];

function humanSize(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function downloadRow(item) {
  const a = document.createElement('a');
  a.className = 'download-item';
  a.innerHTML = '<span class="download-os"></span><span class="download-meta"></span>';
  a.querySelector('.download-os').textContent = item.os;
  a.querySelector('.download-meta').textContent = item.hint;
  return a;
}
function setRow(a, hint, extra, missing) {
  a.classList.toggle('missing', !!missing);
  a.querySelector('.download-meta').textContent = missing ? 'noch nicht verfügbar' : (extra ? `${hint} · ${extra}` : hint);
}

function showDownloads() {
  const list = $('download-list'), info = $('download-version'), box = $('download-modal');
  if (!list || !box) return;
  list.innerHTML = '';
  info.textContent = 'Suche neueste Version …';
  const rows = {};
  for (const item of DOWNLOADS) {
    const a = downloadRow(item);
    a.href = 'downloads/' + item.file;
    rows[item.key] = a;
    list.appendChild(a);
  }
  box.style.display = 'flex';
  fetch('api/downloads', { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('kein Backend')))
    .then(data => {
      for (const file of data.files || []) {
        const a = rows[file.key]; if (!a) continue;
        if (file.available) {
          a.href = file.url;
          if (file.source === 'github') a.removeAttribute('download'); else a.setAttribute('download', file.name);
          setRow(a, file.hint, [humanSize(file.size), file.source === 'lokal' ? 'lokale Kopie' : ''].filter(Boolean).join(' · '), false);
        } else { a.removeAttribute('href'); setRow(a, file.hint, '', true); }
      }
      info.textContent = data.version ? `Aktuelle Version: ${data.version}` + (data.published ? ` (${data.published})` : '')
        : (data.error ? `Kein GitHub-Release gefunden – ${data.error}` : 'Kein GitHub-Release gefunden.');
    })
    .catch(() => githubDirekt(rows, info));
}

function githubDirekt(rows, info) {
  const lokal = (only) => {
    for (const item of DOWNLOADS) {
      if (only && !only.includes(item.key)) continue;
      const a = rows[item.key];
      a.setAttribute('download', item.file);
      a.href = 'downloads/' + item.file;
      fetch('downloads/' + item.file, { method: 'HEAD' }).then(r => {
        if (!r.ok) { a.removeAttribute('href'); setRow(a, item.hint, '', true); return; }
        setRow(a, item.hint, humanSize(Number(r.headers.get('content-length'))), false);
      }).catch(() => {});
    }
  };
  if (!GITHUB_REPO) { info.textContent = ''; lokal(); return; }
  fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then(release => {
      const assets = {};
      for (const a of release.assets || []) assets[a.name] = a;
      const missing = [];
      for (const item of DOWNLOADS) {
        const a = rows[item.key], asset = assets[item.file];
        if (!asset) { missing.push(item.key); continue; }
        a.href = asset.browser_download_url;
        a.removeAttribute('download');
        setRow(a, item.hint, humanSize(asset.size), false);
      }
      info.textContent = `Aktuelle Version: ${release.tag_name}` + (release.published_at ? ` (${release.published_at.slice(0, 10)})` : '');
      if (missing.length) lokal(missing);
    })
    .catch(() => { info.textContent = ''; lokal(); });
}
