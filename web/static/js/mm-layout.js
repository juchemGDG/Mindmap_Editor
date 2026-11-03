'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Layout und Zeichnen
//
// layoutMap() berechnet für jeden sichtbaren Knoten Position und Größe
// (Ergebnis in LAY). drawMap() zeichnet über einen "Painter": dieselbe
// Routine erzeugt das Bild auf dem Canvas, beim PNG-Export und als SVG.
// ════════════════════════════════════════════════════════════════════

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const THEMES = {
  light: {
    bg: '#f8fafc', grid: '#dfe5ee', text: '#0f172a', muted: '#64748b', faint: '#94a3b8',
    line: '#a5b0c2', nodeFill: '#ffffff', nodeBorder: '#d3dae5', rootFill: '#1e293b', rootText: '#f8fafc',
    accent: '#2563eb', accentSoft: 'rgba(37,99,235,0.10)', chip: '#eef2f7', chipText: '#334155',
    link: '#7f8ba3', boundary: 'rgba(100,116,139,0.06)', boundaryLine: '#b7c1cf',
    done: '#3f8f6b', prio: ['', '#b4533c', '#b08a2e', '#8792a3'],
    branches: ['#5876a8', '#4f8a7c', '#a2804c', '#9a6276', '#7469a6', '#6a8a52', '#a46d50', '#4f86a0'],
  },
  dark: {
    bg: '#0d1424', grid: '#1c2638', text: '#e2e8f0', muted: '#94a3b8', faint: '#64748b',
    line: '#4b5a73', nodeFill: '#141e33', nodeBorder: '#2c3a54', rootFill: '#e2e8f0', rootText: '#0f172a',
    accent: '#60a5fa', accentSoft: 'rgba(96,165,250,0.14)', chip: '#1d2940', chipText: '#cbd5e1',
    link: '#8792a8', boundary: 'rgba(148,163,184,0.06)', boundaryLine: '#3a4964',
    done: '#6bbf95', prio: ['', '#e08a74', '#d4b25e', '#94a3b8'],
    branches: ['#7f9ccc', '#6fb3a3', '#c9a46d', '#c08a9d', '#9b90cc', '#8fb277', '#cb9374', '#78aec8'],
  },
  print: {
    bg: '#ffffff', grid: '#eeeeee', text: '#000000', muted: '#444444', faint: '#777777',
    line: '#555555', nodeFill: '#ffffff', nodeBorder: '#333333', rootFill: '#ffffff', rootText: '#000000',
    accent: '#000000', accentSoft: 'rgba(0,0,0,0.06)', chip: '#f0f0f0', chipText: '#000000',
    link: '#555555', boundary: 'rgba(0,0,0,0.03)', boundaryLine: '#888888',
    done: '#000000', prio: ['', '#000000', '#444444', '#888888'],
    branches: ['#333333'],
    rootBorder: '#000000',
  },
};
let themeKey = 'light';
function T() { return THEMES[themeKey] || THEMES.light; }

// Farben, die man einem Ast selbst geben kann (dieselben gedämpften Töne)
const NODE_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
function colorValue(key) {
  const i = NODE_COLORS.indexOf(key);
  if (i < 0) return null;
  const br = T().branches;
  return themeKey === 'print' ? T().line : (THEMES[themeKey] || THEMES.light).branches[i % br.length];
}

// ── Maße ────────────────────────────────────────────────────────────
const HGAP = [64, 36, 28];        // Abstand Eltern → Kind je Tiefe (0, 1, ≥2)
const VGAP = [24, 12, 8];         // Abstand zwischen Geschwistern je Tiefe des Kindes (1, 2, ≥3)
const ORG_COL_GAP = 30, ORG_ROW_GAP = 54, ORG_INDENT = 24, ORG_ITEM_GAP = 8;
const BADGE_H = 18;

let LAY = {};          // id → Layout
let LAY_BOUNDS = null; // {x0,y0,x1,y1}
let LAY_ORDER = [];    // sichtbare Knoten in Zeichenreihenfolge
let layoutRoot = null; // Fokus-Modus: Teilbaum als Wurzel
let editOverride = null; // {id, text} während der Texteingabe
let presentAll = false;    // Präsentation: Eingeklapptes trotzdem auslegen

let measureCtx = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}
function textW(str, font) { const c = mctx(); c.font = font; return c.measureText(str).width; }

function wrapText(text, font, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/).filter(w => w.length);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (textW(test.trimEnd(), font) <= maxW || !line.trim()) {
        if (!line.trim() && textW(w, font) > maxW) {
          // sehr langes Wort: zeichenweise umbrechen
          let chunk = '';
          for (const ch of w) {
            if (textW(chunk + ch, font) > maxW && chunk) { out.push(chunk); chunk = ''; }
            chunk += ch;
          }
          line = chunk;
        } else line = test;
      } else { out.push(line.trimEnd()); line = w.trimStart(); }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}

// ── Stil eines Knotens ──────────────────────────────────────────────
function nodeStyle(id, depth) {
  const st = baseStyle(id, depth);
  const fs = doc.nodes[id].fs;              // Schriftgröße je Punkt (A−/A+), in px
  if (fs) { st.size = Math.max(9, Math.min(48, st.size + fs)); st.maxW = Math.round(st.maxW * st.size / (st.size - fs)); }
  return st;
}
function baseStyle(id, depth) {
  const n = doc.nodes[id];
  const layout = M().layout;
  const rel = depth;
  let shape = n.shape && n.shape !== 'auto' ? n.shape : null;
  if (rel === 0) {
    return { shape: shape && shape !== 'line' && shape !== 'plain' ? shape : 'root', size: 20, weight: 650, padX: 20, padY: 13, maxW: 300, radius: 12 };
  }
  if (rel === 1) {
    return { shape: shape || 'box', size: 15, weight: 600, padX: 14, padY: 8, maxW: 240, radius: 9 };
  }
  if (layout === 'org') {
    return { shape: shape || 'box', size: 13, weight: 450, padX: 10, padY: 6, maxW: 200, radius: 7 };
  }
  return { shape: shape || 'line', size: 14, weight: 450, padX: 5, padY: 5, maxW: 220, radius: 7 };
}
function fontOf(st) { return `${st.weight} ${st.size}px ${FONT_STACK}`; }

function phase() { return M().phase || 'collect'; }

/** Inhalt eines Knotens messen. */
function measureNode(id, depth) {
  const n = doc.nodes[id];
  const st = nodeStyle(id, depth);
  const font = fontOf(st);
  const text = editOverride && editOverride.id === id ? editOverride.text : (n.text || '');
  const lines = wrapText(text || ' ', font, st.maxW);
  const lineH = Math.round(st.size * 1.3);
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, textW(l, font));
  if (!text) tw = Math.max(tw, st.size * 2.2);

  const ph = phase();
  const showTask = ph === 'plan' && n.task;
  let lead = 0;
  if (showTask) lead += st.size + 6;
  if (n.icon) lead += st.size * 1.1 + 5;
  let trail = 0;
  const ind = [];
  if (n.note && String(n.note).trim()) ind.push('note');
  if (n.link) ind.push('link');
  if (ind.length) trail = 6 + ind.length * 13;

  // Abzeichen-Zeile
  const badges = [];
  if (ph === 'plan') {
    if (n.task) {
      for (const o of ownersOf(n).slice(0, 3)) badges.push({ k: 'owner', t: initials(o), full: o });
      if (n.due) badges.push({ k: 'due', t: fmtShort(n.due) });
      if (n.prio) badges.push({ k: 'prio', t: PRIOS[n.prio] ? PRIOS[n.prio].label : '' , p: n.prio });
    }
    const pr = kids(id).length ? progressOf(id) : null;
    if (pr && pr.all) badges.push({ k: 'prog', t: `${pr.done}/${pr.all}`, pr });
  }
  if (ph !== 'collect') {
    const v = votesOf(id);
    if (v) badges.push({ k: 'votes', t: String(v), v });
  }
  const bfont = `600 11px ${FONT_STACK}`;
  let bw = 0;
  for (const b of badges) {
    b.w = b.k === 'owner' ? 18 : b.k === 'prio' ? textW(b.t, bfont) + 18 : b.k === 'votes' ? textW(b.t, bfont) + 20 : b.k === 'prog' ? textW(b.t, bfont) + 30 : textW(b.t, bfont) + 12;
    bw += b.w + 4;
  }
  if (bw) bw -= 4;

  // Bild
  let img = null;
  if (n.img) {
    const s = imgSize(n.img);
    if (s) {
      const k = Math.min(1, 160 / s.w, 120 / s.h);
      img = { w: Math.round(s.w * k), h: Math.round(s.h * k) };
    }
  }

  const contentW = Math.max(lead + tw + trail, bw, img ? img.w : 0);
  let h = st.padY * 2 + lines.length * lineH;
  if (badges.length) h += BADGE_H + 4;
  if (img) h += img.h + 6;
  const w = Math.ceil(contentW + st.padX * 2);
  return { id, depth, st, font, lines, lineH, tw, lead, trail, ind, badges, img, w: Math.max(w, depth === 0 ? 80 : 28), h: Math.ceil(h) };
}

// Bildgrößen merken (Bilder werden als data:-URL im Knoten gespeichert)
const IMG_CACHE = {};
function imgSize(src) {
  const c = IMG_CACHE[src];
  if (c && c.ok) return { w: c.img.naturalWidth, h: c.img.naturalHeight };
  if (!c) {
    const img = new Image();
    IMG_CACHE[src] = { img, ok: false };
    img.onload = () => { IMG_CACHE[src].ok = true; if (typeof requestRender === 'function') { invalidate(); requestRender(true); } };
    img.src = src;
  }
  return null;
}

// ── Sichtbarkeit ────────────────────────────────────────────────────
function visibleKids(id) {
  const n = doc.nodes[id];
  if (!n || (n.collapsed && !presentAll)) return [];
  return kids(id);
}

function hiddenCount(id) {
  const n = doc.nodes[id];
  if (!n || !n.collapsed || presentAll) return 0;
  return descendants(id, false).length;
}

// ── Layout ──────────────────────────────────────────────────────────
function layoutMap() {
  LAY = {};
  LAY_ORDER = [];
  const ix = index();
  let root = layoutRoot && doc.nodes[layoutRoot] ? layoutRoot : ix.rid;
  if (!root) return;
  const baseDepth = depthOf(root);

  const measure = id => {
    const d = depthOf(id) - baseDepth;
    const L = measureNode(id, d);
    LAY[id] = L;
    LAY_ORDER.push(id);
    for (const c of visibleKids(id)) measure(c);
  };
  measure(root);

  const layout = M().layout;
  if (layout === 'org') layoutOrg(root);
  else layoutHorizontal(root, layout === 'right');

  // Grenzen
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of LAY_ORDER) {
    const L = LAY[id];
    x0 = Math.min(x0, L.x - L.w / 2); x1 = Math.max(x1, L.x + L.w / 2);
    y0 = Math.min(y0, L.y - L.h / 2); y1 = Math.max(y1, L.y + L.h / 2);
  }
  LAY_BOUNDS = { x0, y0, x1, y1 };
  computeBoundaries();
}

function hgap(d) { return HGAP[Math.min(d, 2)]; }
function vgap(dChild) { return VGAP[Math.min(dChild - 1, 2)]; }

function subtreeH(id) {
  const L = LAY[id];
  const ch = visibleKids(id);
  if (!ch.length) { L.chH = 0; L.sh = L.h; return L.sh; }
  let sum = 0;
  for (const c of ch) sum += subtreeH(c);
  sum += vgap(L.depth + 1) * (ch.length - 1);
  L.chH = sum;
  L.sh = Math.max(L.h, sum);
  return L.sh;
}

function placeH(id, cx, cy, dir, list) {
  const L = LAY[id];
  L.x = cx; L.y = cy; L.dir = dir;
  const ch = list || visibleKids(id);
  if (!ch.length) return;
  let total = 0;
  for (const c of ch) total += LAY[c].sh;
  total += vgap(L.depth + 1) * (ch.length - 1);
  let y = cy - total / 2;
  for (const c of ch) {
    const C = LAY[c], n = doc.nodes[c];
    const ccx = cx + dir * (L.w / 2 + hgap(L.depth) + C.w / 2) + (n.dx || 0);
    const ccy = y + C.sh / 2 + (n.dy || 0);
    placeH(c, ccx, ccy, dir);
    y += C.sh + vgap(L.depth + 1);
  }
}

/** Mindmap (beidseitig) oder Logik-Diagramm (nur nach rechts). */
function layoutHorizontal(root, onlyRight) {
  for (const id of LAY_ORDER) LAY[id].sh = 0;
  subtreeH(root);
  const ch = visibleKids(root);
  const R = LAY[root];
  R.x = 0; R.y = 0; R.dir = 1;
  if (onlyRight) { placeH(root, 0, 0, 1); for (const c of ch) LAY[c].side = 'R'; return; }

  // Seiten verteilen: feste Seite (side) respektieren, sonst Höhen ausgleichen
  let total = 0;
  for (const c of ch) total += LAY[c].sh;
  const right = [], left = [];
  let acc = 0;
  for (const c of ch) {
    const s = doc.nodes[c].side;
    if (s === 'L') left.push(c);
    else if (s === 'R') { right.push(c); acc += LAY[c].sh; }
  }
  for (const c of ch) {
    const s = doc.nodes[c].side;
    if (s === 'L' || s === 'R') continue;
    if (acc + LAY[c].sh / 2 <= total / 2 || !right.length) { right.push(c); acc += LAY[c].sh; }
    else left.push(c);
  }
  const keepOrder = arr => arr.sort((a, b) => ch.indexOf(a) - ch.indexOf(b));
  keepOrder(right); keepOrder(left);
  for (const c of right) LAY[c].side = 'R';
  for (const c of left) LAY[c].side = 'L';

  const placeSide = (list, dir) => {
    if (!list.length) return;
    let tot = 0;
    for (const c of list) tot += LAY[c].sh;
    tot += vgap(1) * (list.length - 1);
    let y = -tot / 2;
    for (const c of list) {
      const C = LAY[c], n = doc.nodes[c];
      const cx = dir * (R.w / 2 + hgap(0) + C.w / 2) + (n.dx || 0);
      const cy = y + C.sh / 2 + (n.dy || 0);
      placeH(c, cx, cy, dir);
      y += C.sh + vgap(1);
    }
  };
  placeSide(right, 1);
  placeSide(left, -1);
}

/** Strukturplan (PSP): Hauptäste nebeneinander, darunter eingerückte Listen. */
function layoutOrg(root) {
  const R = LAY[root];
  R.x = 0; R.y = 0; R.dir = 1;
  const cols = visibleKids(root);
  // Spaltenbreite und -höhe aus der eingerückten Liste
  const listSize = (id, left) => {
    const L = LAY[id];
    let w = left + L.w, h = L.h;
    for (const c of visibleKids(id)) {
      const s = listSize(c, left + ORG_INDENT);
      w = Math.max(w, s.w); h += ORG_ITEM_GAP + s.h;
    }
    return { w, h };
  };
  const sizes = cols.map(c => listSize(c, 0));
  let total = sizes.reduce((s, x) => s + x.w, 0) + ORG_COL_GAP * Math.max(0, cols.length - 1);
  let x = -total / 2;
  const top = R.h / 2 + ORG_ROW_GAP;
  const placeList = (id, left, y, offX, offY) => {
    const L = LAY[id], n = doc.nodes[id];
    const ox = offX + (n.dx || 0), oy = offY + (n.dy || 0);
    L.x = left + L.w / 2 + ox; L.y = y + L.h / 2 + oy; L.dir = 1; L.org = true;
    let yy = y + L.h + ORG_ITEM_GAP;
    for (const c of visibleKids(id)) {
      const s = listSize(c, 0);
      placeList(c, left + ORG_INDENT, yy, ox, oy);
      yy += s.h + ORG_ITEM_GAP;
    }
  };
  cols.forEach((c, i) => {
    const L = LAY[c];
    const colW = sizes[i].w;
    // Hauptast oben links in der Spalte, die Liste darunter eingerückt
    const n = doc.nodes[c];
    L.x = x + L.w / 2 + (n.dx || 0); L.y = top + L.h / 2 + (n.dy || 0); L.dir = 1; L.org = true; L.orgHead = true;
    let yy = top + L.h + ORG_ITEM_GAP + 4;
    for (const k of visibleKids(c)) {
      const s = listSize(k, 0);
      placeList(k, x + ORG_INDENT, yy, n.dx || 0, n.dy || 0);
      yy += s.h + ORG_ITEM_GAP;
    }
    x += colW + ORG_COL_GAP;
  });
}

// Rahmen um Teilbäume (boundary)
let BOUNDS_LIST = [];
function computeBoundaries() {
  BOUNDS_LIST = [];
  for (const id of LAY_ORDER) {
    const n = doc.nodes[id];
    if (n.boundary == null || n.boundary === false) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const walk = k => {
      const L = LAY[k];
      if (!L) return;
      x0 = Math.min(x0, L.x - L.w / 2); x1 = Math.max(x1, L.x + L.w / 2);
      y0 = Math.min(y0, L.y - L.h / 2); y1 = Math.max(y1, L.y + L.h / 2);
      for (const c of visibleKids(k)) walk(c);
    };
    walk(id);
    const pad = 12;
    const lab = typeof n.boundary === 'string' ? n.boundary.trim() : '';
    BOUNDS_LIST.push({ id, x0: x0 - pad, y0: y0 - pad - (lab ? 12 : 0), x1: x1 + pad, y1: y1 + pad, label: lab, depth: depthOf(id) });
  }
  BOUNDS_LIST.sort((a, b) => a.depth - b.depth);
  for (const b of BOUNDS_LIST) {
    LAY_BOUNDS.x0 = Math.min(LAY_BOUNDS.x0, b.x0); LAY_BOUNDS.y0 = Math.min(LAY_BOUNDS.y0, b.y0);
    LAY_BOUNDS.x1 = Math.max(LAY_BOUNDS.x1, b.x1); LAY_BOUNDS.y1 = Math.max(LAY_BOUNDS.y1, b.y1);
  }
}

// ── Farben je Ast ───────────────────────────────────────────────────
function branchColor(id) {
  const t = T();
  // eigene Farbe am Knoten oder einem Vorfahren gewinnt
  let cur = id;
  while (cur) {
    const n = doc.nodes[cur];
    if (n && n.color) { const v = colorValue(n.color); if (v) return v; }
    if (isRoot(cur)) break;
    cur = parentOf(cur);
  }
  if (M().branchColors !== 'muted' || themeKey === 'print') return t.line;
  const b = branchOf(id);
  if (!b) return t.line;
  const i = kids(index().rid).indexOf(b);
  return t.branches[(i < 0 ? 0 : i) % t.branches.length];
}

// ── Ankerpunkte für Verbindungslinien ───────────────────────────────
function anchorOut(L) {           // wo die Linie zu den Kindern startet
  const s = L.st.shape;
  if (s === 'line') return { x: L.x + L.dir * L.w / 2, y: L.y + L.h / 2 };
  return { x: L.x + L.dir * L.w / 2, y: L.y };
}
function anchorIn(L, dir) {       // wo die Linie vom Elternknoten ankommt
  const s = L.st.shape;
  if (s === 'line') return { x: L.x - dir * L.w / 2, y: L.y + L.h / 2 };
  return { x: L.x - dir * L.w / 2, y: L.y };
}

// ════════════════════════════════════════════════════════════════════
// Painter: Canvas
// ════════════════════════════════════════════════════════════════════
function canvasPainter(c) {
  const style = o => {
    if (o.dash) c.setLineDash(o.dash); else c.setLineDash([]);
    c.lineCap = o.cap || 'round'; c.lineJoin = 'round';
  };
  const build = cmds => {
    c.beginPath();
    for (const k of cmds) {
      if (k[0] === 'M') c.moveTo(k[1], k[2]);
      else if (k[0] === 'L') c.lineTo(k[1], k[2]);
      else if (k[0] === 'C') c.bezierCurveTo(k[1], k[2], k[3], k[4], k[5], k[6]);
      else if (k[0] === 'Q') c.quadraticCurveTo(k[1], k[2], k[3], k[4]);
      else if (k[0] === 'Z') c.closePath();
    }
  };
  return {
    kind: 'canvas',
    path(cmds, o) {
      build(cmds); style(o);
      if (o.alpha != null) c.globalAlpha = o.alpha;
      if (o.fill) { c.fillStyle = o.fill; c.fill(); }
      if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lw || 1; c.stroke(); }
      c.globalAlpha = 1;
    },
    rect(x, y, w, h, r, o) { this.path(roundRectCmds(x, y, w, h, r), o); },
    circle(cx, cy, r, o) {
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); style(o);
      if (o.alpha != null) c.globalAlpha = o.alpha;
      if (o.fill) { c.fillStyle = o.fill; c.fill(); }
      if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lw || 1; c.stroke(); }
      c.globalAlpha = 1;
    },
    text(str, x, y, o) {
      c.font = o.font; c.fillStyle = o.color; c.textAlign = o.align || 'left'; c.textBaseline = o.baseline || 'middle';
      if (o.alpha != null) c.globalAlpha = o.alpha;
      c.fillText(str, x, y);
      if (o.strike) {
        const w = c.measureText(str).width;
        const sx = o.align === 'center' ? x - w / 2 : x;
        c.fillRect(sx, y, w, 1.2);
      }
      c.globalAlpha = 1;
    },
    image(src, x, y, w, h) {
      const e = IMG_CACHE[src];
      if (e && e.ok) c.drawImage(e.img, x, y, w, h);
    },
    alpha(a) { c.globalAlpha = a; },
  };
}

// Painter: SVG (für den Export)
function svgPainter() {
  const parts = [];
  const attr = o => {
    let s = '';
    s += o.fill ? ` fill="${o.fill}"` : ' fill="none"';
    if (o.stroke) s += ` stroke="${o.stroke}" stroke-width="${o.lw || 1}" stroke-linecap="${o.cap || 'round'}" stroke-linejoin="round"`;
    if (o.dash) s += ` stroke-dasharray="${o.dash.join(' ')}"`;
    if (o.alpha != null) s += ` opacity="${o.alpha}"`;
    return s;
  };
  const f = v => Math.round(v * 100) / 100;
  return {
    kind: 'svg', parts,
    path(cmds, o) {
      const d = cmds.map(k => k[0] + k.slice(1).map(f).join(' ')).join(' ');
      parts.push(`<path d="${d}"${attr(o)}/>`);
    },
    rect(x, y, w, h, r, o) { this.path(roundRectCmds(x, y, w, h, r), o); },
    circle(cx, cy, r, o) { parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attr(o)}/>`); },
    text(str, x, y, o) {
      const m = /^(\d+)\s+([\d.]+)px\s+(.*)$/.exec(o.font) || [];
      const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
      const dy = o.baseline === 'alphabetic' ? 0 : '0.35em';
      const dec = o.strike ? ' text-decoration="line-through"' : '';
      parts.push(`<text x="${f(x)}" y="${f(y)}" dy="${dy}" font-family="${xmlEsc(FONT_STACK)}" font-size="${m[2] || 13}" font-weight="${m[1] || 400}" fill="${o.color}" text-anchor="${anchor}"${dec}${o.alpha != null ? ` opacity="${o.alpha}"` : ''} xml:space="preserve">${xmlEsc(str)}</text>`);
    },
    image(src, x, y, w, h) { parts.push(`<image href="${xmlEsc(src)}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/>`); },
    alpha() {},
  };
}

function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function roundRectCmds(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = 0.5523 * r;
  return [
    ['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r],
    ['L', x + w, y + h - r], ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
    ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r],
    ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y], ['Z'],
  ];
}

// ════════════════════════════════════════════════════════════════════
// Zeichnen
// ════════════════════════════════════════════════════════════════════
/**
 * opts: {sel:Set, selLink, hover, drop:{id,mode}, remoteSel:[{id,color,name}],
 *        dim:Set (abgeblendet), search:Set, linkPreview:{from,x,y}, noUi:true}
 */
function drawMap(p, opts) {
  opts = opts || {};
  const t = T();
  const only = opts.only || null;     // Präsentation: nur diese Knoten zeichnen

  // 1. Rahmen um Teilbäume
  for (const b of BOUNDS_LIST) {
    if (only && !only.has(b.id)) continue;
    const col = doc.nodes[b.id].color ? colorValue(doc.nodes[b.id].color) : null;
    p.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 14, { fill: col ? hexAlpha(col, 0.07) : t.boundary, stroke: col || t.boundaryLine, lw: 1.2, dash: [5, 4] });
    if (b.label) p.text(b.label, b.x0 + 12, b.y0 + 12, { font: `600 11px ${FONT_STACK}`, color: col || t.muted });
  }

  // 2. Verbindungslinien
  for (const id of LAY_ORDER) {
    const L = LAY[id];
    for (const c of visibleKids(id)) if (LAY[c] && (!only || only.has(c))) drawEdge(p, L, LAY[c], c, opts);
  }

  // 3. Querverbindungen
  for (const lid in doc.links) {
    const l = doc.links[lid];
    if (!LAY[l.from] || !LAY[l.to]) continue;
    if (only && (!only.has(l.from) || !only.has(l.to))) continue;
    drawCrossLink(p, l, opts.selLink === lid, opts);
  }
  if (opts.linkPreview && LAY[opts.linkPreview.from]) {
    const A = LAY[opts.linkPreview.from];
    p.path([['M', A.x, A.y], ['L', opts.linkPreview.x, opts.linkPreview.y]], { stroke: t.accent, lw: 1.6, dash: [6, 4] });
  }

  // 4. Knoten
  for (const id of LAY_ORDER) if (!only || only.has(id)) drawNode(p, id, opts);
}

function hexAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function edgeWidth(childDepth) { return childDepth <= 1 ? 3 : childDepth === 2 ? 2 : 1.5; }

function drawEdge(p, P, C, cid, opts) {
  const col = branchColor(cid);
  const alpha = opts.dim && opts.dim.has(cid) ? 0.25 : null;
  if (P.org || C.org) { drawOrgEdge(p, P, C, col, alpha); return; }
  const dir = C.dir;
  const a = anchorOut(P), b = anchorIn(C, dir);
  const style = M().lineStyle;
  const w = edgeWidth(C.depth);
  if (P.depth === 0 && style === 'curve') {
    // sich verjüngender Hauptast
    const w0 = 7, w1 = 2.5;
    const k = Math.abs(b.x - a.x) * 0.55;
    const ax = P.x + dir * Math.min(P.w / 2 - 6, 20);
    const ay = P.y;
    p.path([
      ['M', ax, ay - w0 / 2], ['C', ax + dir * k, ay - w0 / 2, b.x - dir * k, b.y - w1 / 2, b.x, b.y - w1 / 2],
      ['L', b.x, b.y + w1 / 2], ['C', b.x - dir * k, b.y + w1 / 2, ax + dir * k, ay + w0 / 2, ax, ay + w0 / 2], ['Z'],
    ], { fill: col, alpha });
  } else if (style === 'straight') {
    p.path([['M', a.x, a.y], ['L', b.x, b.y]], { stroke: col, lw: w, alpha });
  } else if (style === 'elbow') {
    const mx = a.x + dir * Math.max(10, Math.abs(b.x - a.x) * 0.45);
    const r = Math.min(8, Math.abs(b.y - a.y) / 2);
    const sy = Math.sign(b.y - a.y) || 1;
    const cmds = [['M', a.x, a.y]];
    if (r < 1) cmds.push(['L', b.x, b.y]);
    else {
      cmds.push(['L', mx - dir * r, a.y], ['Q', mx, a.y, mx, a.y + sy * r], ['L', mx, b.y - sy * r], ['Q', mx, b.y, mx + dir * r, b.y], ['L', b.x, b.y]);
    }
    p.path(cmds, { stroke: col, lw: w, alpha });
  } else {
    const k = Math.abs(b.x - a.x) * 0.5;
    p.path([['M', a.x, a.y], ['C', a.x + dir * k, a.y, b.x - dir * k, b.y, b.x, b.y]], { stroke: col, lw: w, alpha });
  }
  // Unterstrich bei Knoten im Linienstil
  if (C.st.shape === 'line') {
    p.path([['M', C.x - C.w / 2, C.y + C.h / 2], ['L', C.x + C.w / 2, C.y + C.h / 2]], { stroke: col, lw: w, alpha });
  }
}

function drawOrgEdge(p, P, C, col, alpha) {
  const lw = C.orgHead ? 2.5 : 1.5;
  if (C.orgHead) {
    // vom Zentralthema nach unten, über eine Sammelschiene zu den Hauptästen
    const y0 = P.y + P.h / 2, y1 = C.y - C.h / 2;
    const ym = y0 + (y1 - y0) / 2;
    const r = Math.min(8, Math.abs(C.x - P.x) / 2, (y1 - ym));
    const sx = Math.sign(C.x - P.x);
    const cmds = [['M', P.x, y0], ['L', P.x, ym - (sx ? r : 0)]];
    if (sx) cmds.push(['Q', P.x, ym, P.x + sx * r, ym], ['L', C.x - sx * r, ym], ['Q', C.x, ym, C.x, ym + r]);
    cmds.push(['L', C.x, y1]);
    p.path(cmds, { stroke: col, lw, alpha });
    return;
  }
  // eingerückte Liste: senkrechte Linie links, waagrecht zum Kind
  const sx = P.x - P.w / 2 + Math.min(14, P.w / 2);
  const y0 = P.y + P.h / 2;
  const cy = C.y;
  const cx = C.x - C.w / 2;
  const r = Math.min(6, (cy - y0) / 2);
  p.path([['M', sx, y0], ['L', sx, cy - r], ['Q', sx, cy, sx + r, cy], ['L', cx, cy]], { stroke: col, lw, alpha });
}

function nodeRect(L) { return { x: L.x - L.w / 2, y: L.y - L.h / 2, w: L.w, h: L.h }; }

function drawNode(p, id, opts) {
  const L = LAY[id];
  const n = doc.nodes[id];
  const t = T();
  const st = L.st;
  const r = nodeRect(L);
  const col = branchColor(id);
  const dim = opts.dim && opts.dim.has(id);
  const alpha = dim ? 0.3 : null;
  const sel = opts.sel && opts.sel.has(id);
  const done = n.task && n.status === 'done' && phase() === 'plan';

  // Auswahl / Ablageziel / Suchtreffer
  if (!opts.noUi) {
    for (const rs of opts.remoteSel || []) {
      if (rs.id === id) p.rect(r.x - 6, r.y - 6, r.w + 12, r.h + 12, (st.radius || 6) + 4, { stroke: rs.color, lw: 2, dash: [4, 3] });
    }
    if (opts.search && opts.search.has(id)) p.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, (st.radius || 6) + 3, { fill: 'rgba(250,204,21,0.28)' });
    if (opts.findings && opts.findings.has(id)) p.rect(r.x - 5, r.y - 5, r.w + 10, r.h + 10, (st.radius || 6) + 3, { stroke: '#d97706', lw: 1.6, dash: [3, 3] });
    if (sel) p.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, (st.radius || 6) + 3, { fill: t.accentSoft, stroke: t.accent, lw: 2 });
    if (opts.drop && opts.drop.id === id && opts.drop.mode === 'child') {
      p.rect(r.x - 6, r.y - 6, r.w + 12, r.h + 12, (st.radius || 6) + 4, { stroke: t.accent, lw: 2.5, dash: [6, 3] });
    }
  }

  // Form
  if (st.shape === 'root') {
    p.rect(r.x, r.y, r.w, r.h, st.radius, { fill: t.rootFill, stroke: t.rootBorder, lw: 2, alpha });
  } else if (st.shape === 'box' || st.shape === 'pill') {
    const rad = st.shape === 'pill' ? r.h / 2 : st.radius;
    const border = M().branchColors === 'muted' || n.color ? col : t.nodeBorder;
    p.rect(r.x, r.y, r.w, r.h, rad, { fill: t.nodeFill, stroke: border, lw: L.depth === 1 ? 1.6 : 1.2, alpha });
  }

  const textColor = st.shape === 'root' ? t.rootText : (done ? t.muted : t.text);
  let x = r.x + st.padX;
  let y = r.y + st.padY;

  if (L.img) {
    p.image(n.img, L.x - L.img.w / 2, y, L.img.w, L.img.h);
    y += L.img.h + 6;
  }
  const firstMid = y + L.lineH / 2;

  // Aufgaben-Kreis
  if (phase() === 'plan' && n.task) {
    const s = st.size * 0.5;
    const cx = x + s, cy = firstMid;
    L.checkHit = { x: cx, y: cy, r: s + 3 };
    const sc = n.status || 'todo';
    const ring = sc === 'done' ? t.done : t.muted;
    p.circle(cx, cy, s, { stroke: ring, lw: 1.6, fill: sc === 'done' ? t.done : (st.shape === 'root' ? t.rootFill : t.nodeFill), alpha });
    if (sc === 'doing') p.path([['M', cx, cy - s], ['C', cx + s * 1.33, cy - s, cx + s * 1.33, cy + s, cx, cy + s], ['Z']], { fill: t.muted, alpha });
    if (sc === 'done') p.path([['M', cx - s * 0.45, cy + 0.5], ['L', cx - s * 0.1, cy + s * 0.38], ['L', cx + s * 0.5, cy - s * 0.35]], { stroke: '#ffffff', lw: 1.8, alpha });
    x += st.size + 6;
  } else L.checkHit = null;

  if (n.icon) {
    p.text(n.icon, x + st.size * 0.55, firstMid, { font: `600 ${st.size}px ${FONT_STACK}`, color: st.shape === 'root' ? t.rootText : col === t.line ? t.muted : col, align: 'center', alpha });
    x += st.size * 1.1 + 5;
  }

  // Text
  const tx = x;
  L.lines.forEach((line, i) => {
    p.text(line, tx, y + i * L.lineH + L.lineH / 2, { font: L.font, color: textColor, strike: done, alpha });
  });
  if (!(editOverride && editOverride.id === id) && !(n.text || '').trim()) {
    p.text('…', tx, y + L.lineH / 2, { font: L.font, color: t.faint, alpha });
  }

  // Hinweise auf Notiz / Link
  let ix = tx + L.tw + 6;
  for (const k of L.ind) {
    const c = st.shape === 'root' ? t.rootText : t.faint;
    if (k === 'note') {
      for (let j = 0; j < 3; j++) p.path([['M', ix + 1, firstMid - 4 + j * 4], ['L', ix + 10, firstMid - 4 + j * 4]], { stroke: c, lw: 1.3, alpha });
    } else {
      p.path([['M', ix + 2, firstMid + 4], ['L', ix + 9, firstMid - 3]], { stroke: c, lw: 1.4, alpha });
      p.path([['M', ix + 4, firstMid - 3], ['L', ix + 9, firstMid - 3], ['L', ix + 9, firstMid + 2]], { stroke: c, lw: 1.4, alpha });
    }
    ix += 13;
  }

  // Abzeichen
  if (L.badges.length) {
    let bx = r.x + st.padX;
    const by = y + L.lines.length * L.lineH + 4 + BADGE_H / 2;
    const bfont = `600 11px ${FONT_STACK}`;
    L.voteHit = null;
    for (const b of L.badges) {
      if (b.k === 'owner') {
        p.circle(bx + 9, by, 9, { fill: t.chip, stroke: t.nodeBorder, lw: 1, alpha });
        p.text(b.t, bx + 9, by + 0.5, { font: `700 8.5px ${FONT_STACK}`, color: t.chipText, align: 'center', alpha });
      } else if (b.k === 'prio') {
        p.rect(bx, by - 8, b.w, 16, 8, { fill: t.chip, alpha });
        p.circle(bx + 8, by, 3.5, { fill: t.prio[b.p] || t.muted, alpha });
        p.text(b.t, bx + 14, by + 0.5, { font: bfont, color: t.chipText, alpha });
      } else if (b.k === 'votes') {
        p.rect(bx, by - 8, b.w, 16, 8, { fill: b.v ? t.accentSoft : t.chip, stroke: phase() === 'order' ? t.accent : null, lw: 1, alpha });
        p.circle(bx + 8, by, 3.5, { fill: t.accent, alpha });
        p.text(b.t, bx + 15, by + 0.5, { font: bfont, color: t.chipText, alpha });
        L.voteHit = { x: bx, y: by - 8, w: b.w, h: 16 };
      } else if (b.k === 'prog') {
        p.rect(bx, by - 8, b.w, 16, 8, { fill: t.chip, alpha });
        const bw = 16, fr = b.pr.all ? b.pr.done / b.pr.all : 0;
        p.rect(bx + 6, by - 2, bw, 4, 2, { fill: t.nodeBorder, alpha });
        if (fr > 0) p.rect(bx + 6, by - 2, Math.max(4, bw * fr), 4, 2, { fill: t.done, alpha });
        p.text(b.t, bx + 26, by + 0.5, { font: bfont, color: t.chipText, alpha });
      } else {
        const overdue = b.k === 'due' && n.due < todayISO() && n.status !== 'done';
        p.rect(bx, by - 8, b.w, 16, 8, { fill: overdue ? hexAlpha(t.prio[1], 0.16) : t.chip, alpha });
        p.text(b.t, bx + 6, by + 0.5, { font: bfont, color: overdue ? t.prio[1] : t.chipText, alpha });
      }
      bx += b.w + 4;
    }
  } else L.voteHit = null;

  // Punkt vergeben (Phase „Ordnen“): kleiner Knopf an der Ecke, nur bei Zeiger/Markierung
  if (!opts.noUi && phase() === 'order' && !isRoot(id) && !readOnly && (opts.hover === id || sel)) {
    const cx = r.x + r.w, cy = r.y;
    p.circle(cx, cy, 9, { fill: t.accent, stroke: t.bg, lw: 2 });
    p.path([['M', cx - 4, cy], ['L', cx + 4, cy], ['M', cx, cy - 4], ['L', cx, cy + 4]], { stroke: '#ffffff', lw: 1.8 });
    L.voteHit = { x: cx - 11, y: cy - 11, w: 22, h: 22 };
  }

  // eingeklappt: Anzahl ausgeblendeter Unterpunkte
  const hid = hiddenCount(id);
  L.toggleHit = null;
  if (hid) {
    const a = toggleAnchor(L);
    p.circle(a.x, a.y, 9, { fill: t.bg, stroke: col, lw: 1.5, alpha });
    p.text(String(hid), a.x, a.y + 0.5, { font: `700 9px ${FONT_STACK}`, color: t.muted, align: 'center', alpha });
    L.toggleHit = { x: a.x, y: a.y, r: 11 };
  } else if (!opts.noUi && opts.hover === id && kids(id).length && !isRoot(id) && id !== layoutRoot) {
    const a = toggleAnchor(L);
    p.circle(a.x, a.y, 7, { fill: t.bg, stroke: col, lw: 1.4 });
    p.path([['M', a.x - 3.5, a.y], ['L', a.x + 3.5, a.y]], { stroke: col, lw: 1.4 });
    L.toggleHit = { x: a.x, y: a.y, r: 10 };
  }

  // Einfügemarke beim Ziehen
  if (!opts.noUi && opts.drop && opts.drop.id === id && (opts.drop.mode === 'before' || opts.drop.mode === 'after')) {
    const yy = opts.drop.mode === 'before' ? r.y - 5 : r.y + r.h + 5;
    p.path([['M', r.x, yy], ['L', r.x + r.w, yy]], { stroke: t.accent, lw: 3 });
    p.circle(r.x, yy, 3.5, { fill: t.accent });
  }
}

function toggleAnchor(L) {
  if (L.org) return { x: L.x - L.w / 2 + Math.min(14, L.w / 2), y: L.y + L.h / 2 + 10 };
  const a = anchorOut(L);
  return { x: a.x + L.dir * 11, y: a.y };
}

// Querverbindung: geschwungen zwischen den nächstgelegenen Rändern
function crossLinkGeom(l) {
  const A = LAY[l.from], B = LAY[l.to];
  const edgePt = (L, tx, ty) => {
    const dx = tx - L.x, dy = ty - L.y;
    const sx = Math.abs(dx) / (L.w / 2 + 6), sy = Math.abs(dy) / (L.h / 2 + 6);
    const s = Math.max(sx, sy) || 1;
    return { x: L.x + dx / s, y: L.y + dy / s };
  };
  const a = edgePt(A, B.x, B.y), b = edgePt(B, A.x, A.y);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = (l.bend == null ? 0.22 : l.bend) * len;
  const cx = mx - dy / len * bend, cy = my + dx / len * bend;
  return { a, b, c: { x: cx, y: cy }, mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 } };
}

function drawCrossLink(p, l, selected, opts) {
  const t = T();
  const g = crossLinkGeom(l);
  const col = selected ? t.accent : t.link;
  const alpha = opts.dim && (opts.dim.has(l.from) || opts.dim.has(l.to)) ? 0.25 : null;
  p.path([['M', g.a.x, g.a.y], ['Q', g.c.x, g.c.y, g.b.x, g.b.y]], { stroke: col, lw: selected ? 2.2 : 1.5, dash: [6, 4], alpha });
  // Pfeilspitze am Ziel
  const ang = Math.atan2(g.b.y - g.c.y, g.b.x - g.c.x);
  const s = 9;
  p.path([['M', g.b.x, g.b.y], ['L', g.b.x - s * Math.cos(ang - 0.4), g.b.y - s * Math.sin(ang - 0.4)],
    ['L', g.b.x - s * Math.cos(ang + 0.4), g.b.y - s * Math.sin(ang + 0.4)], ['Z']], { fill: col, alpha });
  if (l.label) {
    const font = `500 11.5px ${FONT_STACK}`;
    const w = textW(l.label, font) + 14;
    p.rect(g.mid.x - w / 2, g.mid.y - 10, w, 20, 10, { fill: t.bg, stroke: col, lw: 1, alpha });
    p.text(l.label, g.mid.x, g.mid.y + 0.5, { font, color: t.chipText, align: 'center', alpha });
  }
}

/** Geschätzter Abstand eines Punktes zur Querverbindung (für Klicks). */
function distToCrossLink(l, x, y) {
  const g = crossLinkGeom(l);
  let best = Infinity;
  for (let i = 0; i <= 24; i++) {
    const s = i / 24, u = 1 - s;
    const px = u * u * g.a.x + 2 * u * s * g.c.x + s * s * g.b.x;
    const py = u * u * g.a.y + 2 * u * s * g.c.y + s * s * g.b.y;
    best = Math.min(best, Math.hypot(px - x, py - y));
  }
  if (l.label) {
    const w = textW(l.label, `500 11.5px ${FONT_STACK}`) + 14;
    if (Math.abs(x - g.mid.x) <= w / 2 && Math.abs(y - g.mid.y) <= 10) best = 0;
  }
  return best;
}
