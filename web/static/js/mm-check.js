'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Prüfung und „Zum Plan machen“
//
// Regelkatalog (bewusst milde: fast alles sind Hinweise, keine Fehler).
// Jede Regel hat eine ID, einen Schweregrad und eine an Schülerinnen und
// Schüler gerichtete Meldung. Wie beim PAP-Editor:
//   neue Regel = Funktion checkXX(), Aufruf in evaluateMap(), Eintrag in RULES.
//
//   M01–M10  Struktur der Mindmap   (ab Phase „Ordnen“)
//   P01–P06  Aufgaben               (Phase „Planen“)
//   P07–P10  Projektplanung         (Phase „Planen“, Planungsart „Projekt“)
// ════════════════════════════════════════════════════════════════════

const RULES = {
  M01: { sev: 'Hinweis', group: 'Struktur', text: 'Leere Punkte' },
  M02: { sev: 'Hinweis', group: 'Struktur', text: 'Doppelte Punkte unter demselben Ast' },
  M03: { sev: 'Hinweis', group: 'Struktur', text: 'Sehr lange Texte (Stichworte statt Sätze)' },
  M04: { sev: 'Hinweis', group: 'Struktur', text: 'Zu wenige Hauptäste' },
  M05: { sev: 'Hinweis', group: 'Struktur', text: 'Sehr viele Hauptäste' },
  M06: { sev: 'Hinweis', group: 'Struktur', text: 'Hauptast ohne Unterpunkte' },
  M07: { sev: 'Hinweis', group: 'Struktur', text: 'Sehr tiefe Verschachtelung' },
  M08: { sev: 'Hinweis', group: 'Struktur', text: 'Ein Ast enthält fast alles' },
  M09: { sev: 'Hinweis', group: 'Struktur', text: 'Querverbindung ohne Beschriftung' },
  M10: { sev: 'Hinweis', group: 'Struktur', text: 'Gleicher Begriff an mehreren Stellen' },
  P01: { sev: 'Hinweis', group: 'Aufgaben', text: 'Aufgabe ohne Zuständige' },
  P02: { sev: 'Hinweis', group: 'Aufgaben', text: 'Aufgabe ohne Termin' },
  P03: { sev: 'Fehler',  group: 'Aufgaben', text: 'Termin überschritten' },
  P04: { sev: 'Hinweis', group: 'Aufgaben', text: 'Alle Unteraufgaben erledigt, Oberaufgabe nicht' },
  P05: { sev: 'Fehler',  group: 'Aufgaben', text: 'Oberaufgabe erledigt, Unteraufgaben offen' },
  P06: { sev: 'Hinweis', group: 'Aufgaben', text: 'Hauptast ohne Aufgabe' },
  P07: { sev: 'Fehler',  group: 'Projekt',  text: 'Start liegt nach dem Ende' },
  P08: { sev: 'Fehler',  group: 'Projekt',  text: 'Abhängigkeit nicht eingehalten' },
  P09: { sev: 'Fehler',  group: 'Projekt',  text: 'Kreis in den Abhängigkeiten' },
  P10: { sev: 'Hinweis', group: 'Projekt',  text: 'Unteraufgabe außerhalb der Oberaufgabe' },
};
const LONG_TEXT = 50;
const MAX_MAIN = 8;
const MAX_DEPTH = 5;

function F(rule, message, nodeIds, linkIds) {
  return { rule, severity: RULES[rule].sev, message, nodeIds: nodeIds || [], linkIds: linkIds || [] };
}
const q = id => `„${label(id)}“`;

// ── Struktur ────────────────────────────────────────────────────────
function checkM01Empty() {
  return treeOrder().filter(id => !(doc.nodes[id].text || '').trim() && !doc.nodes[id].img)
    .map(id => F('M01', `Ein Punkt${isRoot(id) ? ' (das Zentralthema)' : ' unter ' + q(parentOf(id))} hat noch keinen Text.`, [id]));
}
function checkM02Duplicates() {
  const out = [];
  for (const id of treeOrder()) {
    const seen = new Map();
    for (const c of kids(id)) {
      const k = (doc.nodes[c].text || '').trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) out.push(F('M02', `${q(c)} steht unter ${q(id)} doppelt – zusammenfassen?`, [seen.get(k), c]));
      else seen.set(k, c);
    }
  }
  return out;
}
function checkM03Long() {
  return treeOrder().filter(id => !isRoot(id) && (doc.nodes[id].text || '').trim().length > LONG_TEXT)
    .map(id => F('M03', `${q(id).slice(0, 40)}… ist ein ganzer Satz. Mindmaps leben von Stichworten – Erklärungen passen in die Notiz.`, [id]));
}
function checkM04M05Main() {
  const n = kids(index().rid).length;
  if (n < 2) return [F('M04', `Das Zentralthema hat ${n ? 'nur einen Hauptast' : 'noch keine Hauptäste'}. Welche Oberbegriffe gehören noch dazu?`, [index().rid])];
  if (n > MAX_MAIN) return [F('M05', `${n} Hauptäste sind schwer zu überblicken. Ähnliche Äste unter einem Oberbegriff gruppieren (${IS_MAC ? '⌘' : 'Strg'}+G).`, [index().rid])];
  return [];
}
function checkM06Leaves() {
  if (phase() === 'plan') return [];
  return kids(index().rid).filter(b => !kids(b).length)
    .map(b => F('M06', `Der Hauptast ${q(b)} hat noch keine Unterpunkte.`, [b]));
}
function checkM07Depth() {
  return treeOrder().filter(id => depthOf(id) > MAX_DEPTH && !kids(id).length)
    .map(id => F('M07', `${q(id)} liegt ${depthOf(id)} Ebenen tief. Lässt sich das flacher ordnen?`, [id]));
}
function checkM08Balance() {
  const all = Object.keys(doc.nodes).length;
  if (all < 12) return [];
  const out = [];
  for (const b of kids(index().rid)) {
    const n = descendants(b, true).length;
    if (n / (all - 1) > 0.6 && kids(index().rid).length > 1) out.push(F('M08', `Der Ast ${q(b)} enthält ${Math.round(n / (all - 1) * 100)} % aller Punkte. Vielleicht ist er eigentlich ein eigenes Thema oder lässt sich aufteilen.`, [b]));
  }
  return out;
}
function checkM09Links() {
  return Object.values(doc.links).filter(l => !(l.label || '').trim() && doc.nodes[l.from] && doc.nodes[l.to])
    .map(l => F('M09', `Die Querverbindung ${q(l.from)} → ${q(l.to)} ist nicht beschriftet. Wie hängen die beiden zusammen?`, [l.from, l.to], [l.id]));
}
function checkM10Global() {
  const map = new Map();
  for (const id of treeOrder()) {
    const k = (doc.nodes[id].text || '').trim().toLowerCase();
    if (k.length < 3) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(id);
  }
  const out = [];
  for (const [, ids] of map) {
    if (ids.length < 2) continue;
    const parents = new Set(ids.map(parentOf));
    if (parents.size < ids.length) continue;   // gleicher Elternknoten: schon M02
    out.push(F('M10', `${q(ids[0])} kommt ${ids.length}× vor. Eine Querverbindung kann die Stellen verknüpfen.`, ids));
  }
  return out;
}

// ── Aufgaben ────────────────────────────────────────────────────────
function tasksAll() { return treeOrder().filter(isTask); }
function checkP01Owner() {
  return tasksAll().filter(id => !doc.nodes[id].owner && statusOf(id) !== 'done' && !kids(id).some(isTask))
    .map(id => F('P01', `Wer kümmert sich um ${q(id)}?`, [id]));
}
function checkP02Due() {
  return tasksAll().filter(id => !doc.nodes[id].due && !doc.nodes[id].start && statusOf(id) !== 'done' && !kids(id).some(isTask))
    .map(id => F('P02', `Bis wann soll ${q(id)} erledigt sein?`, [id]));
}
function checkP03Overdue() {
  const today = todayISO();
  return tasksAll().filter(id => doc.nodes[id].due && doc.nodes[id].due < today && statusOf(id) !== 'done')
    .map(id => F('P03', `${q(id)} war am ${fmtLong(doc.nodes[id].due)} fällig und ist noch nicht erledigt.`, [id]));
}
function checkP04P05Parents() {
  const out = [];
  for (const id of tasksAll()) {
    const sub = descendants(id, false).filter(isTask);
    if (!sub.length) continue;
    const open = sub.filter(s => statusOf(s) !== 'done');
    if (!open.length && statusOf(id) !== 'done') out.push(F('P04', `Alle Unteraufgaben von ${q(id)} sind erledigt – ist ${q(id)} damit auch fertig?`, [id]));
    if (open.length && statusOf(id) === 'done') out.push(F('P05', `${q(id)} ist als erledigt markiert, aber ${open.length} Unteraufgabe(n) sind noch offen.`, [id, ...open]));
  }
  return out;
}
function checkP06Branches() {
  if (!tasksAll().length) return [];
  return kids(index().rid).filter(b => !descendants(b, true).some(isTask))
    .map(b => F('P06', `Im Ast ${q(b)} gibt es noch keine Aufgabe. Was ist dort zu tun?`, [b]));
}

// ── Projekt ─────────────────────────────────────────────────────────
function checkP07Range() {
  return tasksAll().filter(id => { const n = doc.nodes[id]; return n.start && n.due && n.start > n.due; })
    .map(id => F('P07', `Bei ${q(id)} liegt der Start (${fmtLong(doc.nodes[id].start)}) nach dem Ende (${fmtLong(doc.nodes[id].due)}).`, [id]));
}
function checkP08Deps() {
  const out = [];
  for (const id of tasksAll()) {
    const n = doc.nodes[id];
    const r = taskRange(id);
    if (!r) continue;
    for (const d of n.deps || []) {
      const rd = doc.nodes[d] ? taskRange(d) : null;
      if (rd && r.s <= rd.e) out.push(F('P08', `${q(id)} beginnt am ${fmtLong(r.s)}, obwohl ${q(d)} erst am ${fmtLong(rd.e)} fertig ist.`, [id, d]));
    }
  }
  return out;
}
function checkP09Cycles() {
  const out = [];
  const state = {};
  const stack = [];
  const visit = id => {
    state[id] = 1; stack.push(id);
    for (const d of doc.nodes[id].deps || []) {
      if (!doc.nodes[d]) continue;
      if (state[d] === 1) {
        const cyc = stack.slice(stack.indexOf(d));
        out.push(F('P09', `Diese Aufgaben warten im Kreis aufeinander: ${cyc.map(c => q(c)).join(' → ')} → ${q(d)}.`, cyc));
      } else if (!state[d]) visit(d);
    }
    stack.pop(); state[id] = 2;
  };
  for (const id of tasksAll()) if (!state[id]) visit(id);
  return out;
}
function checkP10Nested() {
  const out = [];
  for (const id of tasksAll()) {
    const r = taskRange(id);
    if (!r) continue;
    const p = ancestors(id).find(isTask);
    const rp = p ? taskRange(p) : null;
    if (rp && (r.s < rp.s || r.e > rp.e)) out.push(F('P10', `${q(id)} liegt zeitlich außerhalb der Oberaufgabe ${q(p)}.`, [id, p]));
  }
  return out;
}

function evaluateMap() {
  const ph = phase();
  let out = [];
  out = out.concat(checkM01Empty(), checkM02Duplicates(), checkM03Long(), checkM04M05Main(), checkM06Leaves(),
    checkM07Depth(), checkM08Balance(), checkM09Links(), checkM10Global());
  if (ph === 'plan') {
    out = out.concat(checkP01Owner(), checkP02Due(), checkP03Overdue(), checkP04P05Parents(), checkP06Branches());
    if (M().planMode === 'project') out = out.concat(checkP07Range(), checkP08Deps(), checkP09Cycles(), checkP10Nested());
  }
  const off = new Set(M().disabledRules || []);
  out = out.filter(f => !off.has(f.rule));
  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'Fehler' ? -1 : 1) || a.rule.localeCompare(b.rule));
  return out;
}

// ── Anzeige der Hinweise ────────────────────────────────────────────
let checkOpen = false;
let lastFindings = [];
function runCheck(open) {
  if (open) checkOpen = true;
  lastFindings = evaluateMap();
  findingIds = checkOpen ? new Set(lastFindings.flatMap(f => f.nodeIds)) : null;
  const badge = $('check-badge');
  if (badge) {
    badge.textContent = lastFindings.length || '';
    badge.style.display = lastFindings.length && phase() !== 'collect' ? '' : 'none';
    badge.classList.toggle('err', lastFindings.some(f => f.severity === 'Fehler'));
  }
  const panel = $('check-panel');
  if (!panel) return;
  panel.style.display = checkOpen ? 'flex' : 'none';
  document.body.classList.toggle('check-open', checkOpen);
  if (!checkOpen) { requestRender(); return; }
  const list = $('check-list');
  const off = M().disabledRules || [];
  list.innerHTML = (lastFindings.length ? lastFindings.map((f, i) => `
      <div class="finding ${f.severity === 'Fehler' ? 'err' : ''}" data-f="${i}">
        <div class="f-head"><span class="f-rule">${f.rule}</span><span class="f-sev">${f.severity}</span>
          <button type="button" class="f-off" data-off="${f.rule}" title="Diese Regel ausblenden">ausblenden</button></div>
        <div class="f-msg">${esc(f.message)}</div></div>`).join('')
    : `<div class="f-ok">✓ Keine Hinweise${phase() === 'collect' ? ' – in der Phase „Sammeln“ wird bewusst nur wenig geprüft.' : '.'}</div>`)
    + (off.length ? `<div class="f-disabled">Ausgeblendet: ${off.map(r => `<button type="button" data-on="${r}" title="${esc(RULES[r] ? RULES[r].text : r)}">${r} ↺</button>`).join(' ')}</div>` : '');
  requestRender();
}
function closeCheck() { checkOpen = false; runCheck(); }

function bindCheckPanel() {
  const list = $('check-list');
  if (!list) return;
  list.addEventListener('click', e => {
    const off = e.target.closest('[data-off]');
    if (off) { mutate('Regel ausblenden', () => { M().disabledRules = [...new Set([...(M().disabledRules || []), off.dataset.off])]; }); return; }
    const on = e.target.closest('[data-on]');
    if (on) { mutate('Regel einblenden', () => { M().disabledRules = (M().disabledRules || []).filter(r => r !== on.dataset.on); }); return; }
    const f = e.target.closest('[data-f]');
    if (!f) return;
    const fi = lastFindings[Number(f.dataset.f)];
    if (!fi) return;
    if (fi.linkIds.length) { selLink = fi.linkIds[0]; sel = new Set(); focusId = null; selectionChanged(); }
    else select(fi.nodeIds.filter(id => doc.nodes[id]));
    if (currentView === 'map' && fi.nodeIds[0]) {
      // eingeklappte Vorfahren öffnen
      const hidden = fi.nodeIds.flatMap(id => ancestors(id)).filter(a => doc.nodes[a] && doc.nodes[a].collapsed);
      if (hidden.length) mutate('Aufklappen', () => { for (const a of hidden) delete doc.nodes[a].collapsed; }, { noUndo: true });
      setTimeout(() => ensureVisible(fi.nodeIds[0]), 20);
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// „Zum Plan machen“
// ════════════════════════════════════════════════════════════════════
function openPlanWizard() {
  if (readOnly) return;
  const box = $('plan-modal');
  if (!box) return;
  const p = primary();
  const branch = p && !isRoot(p) ? p : null;
  const anyVotes = Object.keys(doc.votes).length > 0;
  const anyPrio = Object.values(doc.nodes).some(n => n.prio);
  $('plan-scope-branch-label').textContent = branch ? `nur den markierten Ast „${label(branch).slice(0, 40)}“` : 'nur den markierten Ast (vorher einen Ast markieren)';
  const sb = document.querySelector('input[name="plan-scope"][value="branch"]');
  sb.disabled = !branch;
  if (!branch) document.querySelector('input[name="plan-scope"][value="all"]').checked = true;
  const fv = document.querySelector('input[name="plan-what"][value="voted"]');
  fv.disabled = !anyVotes && !anyPrio;
  $('plan-what-voted-label').textContent = anyVotes || anyPrio ? 'nur Ideen mit Punkten oder Priorität' : 'nur Ideen mit Punkten oder Priorität (noch keine vergeben)';
  if (fv.disabled && fv.checked) document.querySelector('input[name="plan-what"][value="leaves"]').checked = true;
  document.querySelector(`input[name="plan-mode"][value="${M().planMode === 'project' ? 'project' : 'simple'}"]`).checked = true;
  $('plan-start').value = M().projectStart || todayISO();
  updatePlanWizard();
  box.style.display = 'flex';
}

function planCandidates() {
  const scope = document.querySelector('input[name="plan-scope"]:checked').value;
  const what = document.querySelector('input[name="plan-what"]:checked').value;
  const p = primary();
  const base = scope === 'branch' && p && !isRoot(p) ? descendants(p, true) : treeOrder().filter(id => !isRoot(id));
  let ids;
  if (what === 'leaves') ids = base.filter(id => !kids(id).length);
  else if (what === 'level2') ids = base.filter(id => depthOf(id) >= 2);
  else ids = base.filter(id => votesOf(id) > 0 || doc.nodes[id].prio);
  return ids.filter(id => !isRoot(id));
}

function updatePlanWizard() {
  const project = document.querySelector('input[name="plan-mode"]:checked').value === 'project';
  $('plan-project-opts').style.display = project ? '' : 'none';
  const ids = planCandidates();
  const fresh = ids.filter(id => !isTask(id)).length;
  $('plan-count').textContent = ids.length
    ? `${ids.length} Punkte werden Aufgaben${fresh < ids.length ? ` (${ids.length - fresh} sind es schon)` : ''}.`
    : 'Keine passenden Punkte gefunden.';
}

function applyPlanWizard() {
  const ids = planCandidates();
  const project = document.querySelector('input[name="plan-mode"]:checked').value === 'project';
  const seq = $('plan-seq').checked;
  const prioFromVotes = $('plan-prio').checked;
  const start = $('plan-start').value || todayISO();
  const dur = Math.max(1, parseInt($('plan-dur').value, 10) || 1);
  const openView = document.querySelector('input[name="plan-open"]:checked').value;
  // Punkte → Priorität: oberes Drittel hoch, mittleres mittel
  const voted = ids.filter(id => votesOf(id) > 0).sort((a, b) => votesOf(b) - votesOf(a));
  const third = Math.max(1, Math.ceil(voted.length / 3));
  mutate('Zum Plan machen', () => {
    M().phase = 'plan';
    M().planMode = project ? 'project' : 'simple';
    if (project) M().projectStart = start;
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n.task) { n.task = true; n.status = 'todo'; }
      if (prioFromVotes && !n.prio && votesOf(id) > 0) {
        const r = voted.indexOf(id);
        n.prio = r < third ? 1 : r < third * 2 ? 2 : 3;
      }
      if (project && !n.start && !n.due) n._d = dur;   // wird gleich eingeplant
    }
    if (project && seq) {
      // innerhalb eines Elternknotens nacheinander: jede Aufgabe wartet auf die vorige
      const byParent = new Map();
      for (const id of ids) { const p = parentOf(id); if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(id); }
      for (const [p, list] of byParent) {
        const ordered = kids(p).filter(k => list.includes(k));
        for (let i = 1; i < ordered.length; i++) {
          const n = doc.nodes[ordered[i]];
          const deps = new Set(n.deps || []);
          deps.add(ordered[i - 1]);
          n.deps = [...deps];
        }
      }
    }
  });
  if (project) scheduleNewTasks();
  $('plan-modal').style.display = 'none';
  flashStatus(`${ids.length} Aufgaben angelegt`);
  switchView(openView);
  if (openView === 'map') { mutate('Strukturplan', () => { M().layout = 'org'; }, { joinLast: true }); fitView(); }
}

/** Neue Aufgaben (Feld _d = gewünschte Dauer) nach ihren Abhängigkeiten einplanen. */
function scheduleNewTasks() {
  const startDay = M().projectStart || todayISO();
  mutate('Termine', () => {
    const fin = {};
    const visiting = new Set();
    const end = id => {
      if (fin[id]) return fin[id];
      const n = doc.nodes[id];
      if (visiting.has(id)) return null;
      visiting.add(id);
      let earliest = startDay;
      for (const d of n.deps || []) {
        if (!doc.nodes[d] || !isTask(d)) continue;
        const e = end(d);
        if (e && addDays(e, 1) > earliest) earliest = addDays(e, 1);
      }
      if (n._d) {
        n.start = skipWeekend(earliest);
        n.due = addDays(n.start, n._d - 1);
        delete n._d;
      }
      visiting.delete(id);
      fin[id] = n.due || n.start || earliest;
      return fin[id];
    };
    for (const id of treeOrder().filter(isTask)) end(id);
  }, { joinLast: true });
}

function bindPlanWizard() {
  const box = $('plan-modal');
  if (!box) return;
  box.addEventListener('change', updatePlanWizard);
  on('plan-ok', 'click', applyPlanWizard);
  on('plan-cancel', 'click', () => { box.style.display = 'none'; });
  box.addEventListener('click', e => { if (e.target === box) box.style.display = 'none'; });
}
