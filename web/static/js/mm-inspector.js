'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Eigenschaften (rechte Leiste), Ideen-Eingabe,
// Brainstorming-Timer und Punktevergabe
// ════════════════════════════════════════════════════════════════════

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function $(id) { return document.getElementById(id); }

// eigene Kennung (für Punkte und gemeinsames Bearbeiten)
function myId() {
  let id = null;
  try { id = localStorage.getItem('mm-client-id'); } catch (e) { /* privat */ }
  if (!id) { id = uid('c'); try { localStorage.setItem('mm-client-id', id); } catch (e) { /* egal */ } }
  return id;
}
function myName() {
  try { return localStorage.getItem('mm-name') || ''; } catch (e) { return ''; }
}

let inspectorOpen = true;
let inspectorKey = '';

function toggleInspector(force) {
  inspectorOpen = force == null ? !inspectorOpen : force;
  document.body.classList.toggle('inspector-closed', !inspectorOpen);
  try { localStorage.setItem('mm-inspector', inspectorOpen ? '1' : '0'); } catch (e) { /* egal */ }
  setTimeout(() => { resizeCanvas(); requestRender(); }, 220);
}

function knownOwners() {
  const s = new Set();
  for (const id in doc.nodes) for (const o of ownersOf(id)) s.add(o);
  for (const id in doc.members || {}) if (doc.members[id].name) s.add(doc.members[id].name);
  return [...s].sort((a, b) => a.localeCompare(b, 'de'));
}

// ── Aufbau ──────────────────────────────────────────────────────────
function updateInspector() {
  const body = $('inspector-body');
  if (!body) return;
  cleanSelection();
  const ids = [...sel];
  const key = selLink ? 'L' + selLink : ids.length ? (ids.length === 1 ? 'N' + ids[0] : 'M' + ids.sort().join(',')) : '-';
  const full = key + '|' + phase() + '|' + M().planMode + '|' + (ids.length === 1 && doc.nodes[ids[0]] ? (doc.nodes[ids[0]].task ? 't' : '') + (doc.nodes[ids[0]].boundary != null ? 'b' : '') + (doc.nodes[ids[0]].img ? 'i' : '') : '') + '|' + (readOnly ? 'r' : '');
  // Übersicht (nichts markiert) enthält Zahlen – bei jeder Änderung neu aufbauen
  const overviewStale = key === '-' && !body.contains(document.activeElement);
  if (full !== inspectorKey || overviewStale) {
    inspectorKey = full;
    if (selLink) body.innerHTML = linkPanel(selLink);
    else if (ids.length === 1) body.innerHTML = nodePanel(ids[0]);
    else if (ids.length > 1) body.innerHTML = multiPanel(ids);
    else body.innerHTML = mapPanel();
    wireInspector(body);
  }
  refreshInspectorValues(body);
}

function field(labelText, inner, cls) {
  return `<div class="insp-field ${cls || ''}"><label>${labelText}</label>${inner}</div>`;
}

function segmented(name, options, current) {
  return `<div class="seg" data-seg="${name}">` + options.map(o =>
    `<button type="button" data-val="${esc(o.key)}" class="${String(o.key) === String(current) ? 'on' : ''}" title="${esc(o.title || o.label)}">${o.dot ? `<i style="background:${o.dot}"></i>` : ''}${esc(o.label)}</button>`).join('') + '</div>';
}

function nodePanel(id) {
  const n = doc.nodes[id];
  const root = isRoot(id);
  const path = pathText(id);
  const pm = M().planMode;
  const ro = readOnly ? ' disabled' : '';
  let h = '';
  h += `<div class="insp-path">${root ? 'Zentralthema' : esc(path ? path : 'Hauptast')}</div>`;
  h += field('Thema', `<textarea data-field="text" rows="2"${ro}></textarea>`);
  h += field('Notiz', `<textarea data-field="note" rows="3" placeholder="Erklärung, Quelle, Gedanken …"${ro}></textarea>`);
  h += field('Link', `<div class="insp-row"><input data-field="link" type="url" placeholder="https://…"${ro}><button type="button" class="mini" data-act="open-link" title="Link öffnen">↗</button></div>`);

  // Aufgabe
  h += `<div class="insp-section"><div class="insp-section-head"><span>Aufgabe</span>
    <label class="switch"><input type="checkbox" data-field="task"${ro}><i></i></label></div>`;
  if (n.task) {
    h += field('Status', segmented('status', STATUS, n.status || 'todo'));
    h += field('Zuständig', `<input data-field="owner" list="owner-list" placeholder="Name"${ro}><datalist id="owner-list">${knownOwners().map(o => `<option value="${esc(o)}">`).join('')}</datalist>`);
    if (pm === 'project') {
      h += `<div class="insp-2col">` + field('Start', `<input data-field="start" type="date"${ro}>`) + field('Ende', `<input data-field="due" type="date"${ro}>`) + `</div>`;
      h += `<div class="insp-2col">` + field('Dauer (Tage)', `<input data-field="dur" type="number" min="1" max="999"${ro}>`) +
        field('Meilenstein', `<label class="switch"><input type="checkbox" data-field="ms"${ro}><i></i></label>`) + `</div>`;
      h += field('Abhängig von', `<div class="deps" data-deps></div><select data-act="add-dep"${ro}><option value="">+ Vorgänger hinzufügen …</option></select>`);
    } else {
      h += field('Fällig', `<input data-field="due" type="date"${ro}>`);
    }
    h += field('Priorität', segmented('prio', PRIOS.map(p => ({ key: p.key, label: p.key ? p.label : '—', dot: p.key ? T().prio[p.key] : null })), n.prio || 0));
  } else {
    h += `<p class="insp-hint">Als Aufgabe markieren, um Status, Zuständige und Termin festzulegen. Schnell: <kbd>${IS_MAC ? '⌘' : 'Strg'}</kbd>+<kbd>Enter</kbd></p>`;
  }
  const pr = progressOf(id);
  if (pr.all) {
    const pc = Math.round(pr.done / pr.all * 100);
    h += `<div class="insp-progress"><div><b>${pr.done}</b> von ${pr.all} Unteraufgaben erledigt</div><span><i style="width:${pc}%"></i></span></div>`;
  }
  h += `</div>`;

  // Punkte
  if (phase() !== 'collect') {
    h += `<div class="insp-section"><div class="insp-section-head"><span>Punkte</span><b data-votes></b></div>
      <div class="insp-row"><button type="button" class="mini" data-act="vote-" title="Punkt zurücknehmen">−</button><span class="insp-myvotes" data-myvotes></span><button type="button" class="mini" data-act="vote+" title="Punkt vergeben">+</button></div></div>`;
  }

  // Darstellung
  h += `<div class="insp-section"><div class="insp-section-head"><span>Darstellung</span></div>`;
  h += field('Symbol', `<div class="icon-grid" data-icons><button type="button" data-icon="" title="kein Symbol">—</button>${ICONS.map(i => `<button type="button" data-icon="${esc(i)}">${esc(i)}</button>`).join('')}</div>`);
  h += field('Farbe des Astes', `<div class="swatches" data-colors><button type="button" data-color="" title="automatisch">—</button>${NODE_COLORS.map(c => `<button type="button" data-color="${c}" style="background:${colorValue(c)}"></button>`).join('')}</div>`);
  h += field('Schriftgröße', `<div class="insp-row"><button type="button" class="mini" data-act="fs-" title="kleiner">A−</button><button type="button" class="mini" data-act="fs+" title="größer">A+</button><button type="button" class="mini" data-act="fs0" title="Standard">Standard</button><span class="insp-myvotes" data-fs></span></div>`);
  if (!root) {
    h += field('Form', `<select data-field="shape"${ro}><option value="auto">Automatisch</option><option value="box">Kasten</option><option value="pill">Abgerundet</option><option value="line">Unterstrichen</option><option value="plain">Nur Text</option></select>`);
  }
  h += `<div class="insp-field"><label>Rahmen um den Ast</label><div class="insp-row"><label class="switch"><input type="checkbox" data-act="boundary"${ro}><i></i></label>
    ${n.boundary != null ? `<input data-field="boundary" placeholder="Beschriftung"${ro}>` : ''}</div></div>`;
  h += field('Bild', n.img
    ? `<div class="insp-row"><img class="insp-img" src="${esc(n.img)}" alt=""><button type="button" class="mini danger" data-act="img-del">Entfernen</button></div>`
    : `<button type="button" class="btn-small" data-act="img-add"${ro}>Bild auswählen …</button>`);
  h += `</div>`;

  if (!readOnly) {
    h += `<div class="insp-actions">
      <button type="button" class="btn-small" data-act="child">+ Unterpunkt</button>
      ${root ? '' : '<button type="button" class="btn-small" data-act="sibling">+ Nachbar</button>'}
      <button type="button" class="btn-small" data-act="link">Querverbindung …</button>
      ${root ? '' : '<button type="button" class="btn-small danger" data-act="delete">Löschen</button>'}
    </div>`;
  }
  return h;
}

function multiPanel(ids) {
  const ro = readOnly ? ' disabled' : '';
  let h = `<div class="insp-path">${ids.length} Punkte markiert</div>`;
  h += `<div class="insp-section"><div class="insp-section-head"><span>Gemeinsam ändern</span></div>`;
  h += field('Aufgabe', segmented('m-task', [{ key: 'on', label: 'Aufgabe' }, { key: 'off', label: 'keine' }], ''));
  h += field('Status', segmented('m-status', STATUS, ''));
  h += field('Zuständig', `<div class="insp-row"><input data-act="m-owner" list="owner-list" placeholder="Name"${ro}><button type="button" class="mini" data-act="m-owner-set">OK</button></div><datalist id="owner-list">${knownOwners().map(o => `<option value="${esc(o)}">`).join('')}</datalist>`);
  h += field('Priorität', segmented('m-prio', PRIOS.map(p => ({ key: p.key, label: p.key ? p.label : '—', dot: p.key ? T().prio[p.key] : null })), ''));
  h += field('Farbe des Astes', `<div class="swatches" data-colors><button type="button" data-color="" title="automatisch">—</button>${NODE_COLORS.map(c => `<button type="button" data-color="${c}" style="background:${colorValue(c)}"></button>`).join('')}</div>`);
  h += field('Schriftgröße', `<div class="insp-row"><button type="button" class="mini" data-act="fs-">A−</button><button type="button" class="mini" data-act="fs+">A+</button><button type="button" class="mini" data-act="fs0">Standard</button></div>`);
  h += `</div>`;
  if (!readOnly) {
    h += `<div class="insp-actions"><button type="button" class="btn-small" data-act="group">Gruppieren</button>
      <button type="button" class="btn-small danger" data-act="delete">Löschen</button></div>`;
  }
  return h;
}

function linkPanel(lid) {
  const ro = readOnly ? ' disabled' : '';
  const l = doc.links[lid];
  let h = `<div class="insp-path">Querverbindung</div>`;
  h += `<p class="insp-hint">${esc(label(l.from))} → ${esc(label(l.to))}</p>`;
  h += field('Beschriftung', `<input data-lfield="label" placeholder="z. B. „führt zu“"${ro}>`);
  if (!readOnly) {
    h += `<div class="insp-actions"><button type="button" class="btn-small" data-act="link-rev">Richtung umkehren</button>
      <button type="button" class="btn-small danger" data-act="delete">Löschen</button></div>`;
  }
  return h;
}

function mapPanel() {
  const all = Object.keys(doc.nodes).length;
  let tasks = 0, done = 0;
  for (const id in doc.nodes) if (doc.nodes[id].task) { tasks++; if (doc.nodes[id].status === 'done') done++; }
  const m = IS_MAC ? '⌘' : 'Strg';
  if (readOnly) {
    return `<div class="insp-path">Mindmap</div>
    <div class="insp-stats"><div><b>${all}</b><span>Punkte</span></div><div><b>${kids(index().rid).length}</b><span>Hauptäste</span></div><div><b>${done}/${tasks}</b><span>Aufgaben erledigt</span></div></div>
    <p class="insp-hint">Du siehst diese Mindmap über einen <b>Nur-ansehen-Link</b>. Änderungen der anderen erscheinen hier sofort. Mit „Speichern“ kannst du dir eine Kopie sichern.</p>`;
  }
  return `<div class="insp-path">Mindmap</div>
    ${field('Titel', `<input data-mfield="title"${readOnly ? ' disabled' : ''}>`)}
    <div class="insp-stats"><div><b>${all}</b><span>Punkte</span></div><div><b>${kids(index().rid).length}</b><span>Hauptäste</span></div><div><b>${done}/${tasks}</b><span>Aufgaben erledigt</span></div></div>
    <div class="insp-section"><div class="insp-section-head"><span>Schnell arbeiten</span></div>
    <ul class="insp-keys">
      <li><kbd>Tab</kbd> Unterpunkt</li>
      <li><kbd>Enter</kbd> Nachbar</li>
      <li>Einfach lostippen – überschreibt den markierten Punkt</li>
      <li><kbd>F2</kbd> / Doppelklick: Text ändern</li>
      <li><kbd>Leertaste</kbd> ein-/ausklappen</li>
      <li><kbd>${m}</kbd>+<kbd>Enter</kbd> Aufgabe / Status</li>
      <li><kbd>${m}</kbd>+<kbd>1</kbd>…<kbd>3</kbd> Priorität</li>
      <li><kbd>${m}</kbd>+<kbd>G</kbd> Markierte gruppieren</li>
      <li><kbd>Shift</kbd>+Ziehen: Rahmen zum Markieren</li>
    </ul></div>
    <p class="insp-hint">Tipp: Mehrzeiligen Text (z. B. eine Liste) einfügen – jede Zeile wird ein Punkt, Einrückungen werden zu Unterpunkten.</p>`;
}

// ── Werte setzen, ohne das Feld mit dem Cursor zu überschreiben ─────
function refreshInspectorValues(body) {
  const active = document.activeElement;
  const id = sel.size === 1 ? [...sel][0] : null;
  const n = id ? doc.nodes[id] : null;
  body.querySelectorAll('[data-field]').forEach(el => {
    if (!n || el === active) return;
    const f = el.dataset.field;
    let v = n[f];
    if (f === 'dur') v = n.start && n.due ? (dayDiff(n.start, n.due) + 1) : '';
    if (f === 'shape') v = n.shape || 'auto';
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : v;
  });
  body.querySelectorAll('[data-act="boundary"]').forEach(el => { if (n) el.checked = n.boundary != null; });
  body.querySelectorAll('[data-lfield]').forEach(el => {
    if (el === active || !selLink || !doc.links[selLink]) return;
    el.value = doc.links[selLink][el.dataset.lfield] || '';
  });
  body.querySelectorAll('[data-mfield]').forEach(el => { if (el !== active) el.value = M()[el.dataset.mfield] || ''; });
  if (n) {
    body.querySelectorAll('[data-seg="status"] button').forEach(b => b.classList.toggle('on', b.dataset.val === (n.status || 'todo')));
    body.querySelectorAll('[data-seg="prio"] button').forEach(b => b.classList.toggle('on', Number(b.dataset.val) === (n.prio || 0)));
    body.querySelectorAll('[data-icon]').forEach(b => b.classList.toggle('on', (n.icon || '') === b.dataset.icon));
    body.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', (n.color || '') === b.dataset.color));
    const fsEl = body.querySelector('[data-fs]');
    if (fsEl) fsEl.textContent = n.fs ? (n.fs > 0 ? '+' : '') + n.fs + ' px' : '';
    const v = body.querySelector('[data-votes]');
    if (v) v.textContent = votesOf(id) + ' gesamt';
    const mv = body.querySelector('[data-myvotes]');
    if (mv) { const own = doc.votes[id + '|' + myId()]; mv.textContent = `deine: ${own ? own.n : 0}`; }
    const deps = body.querySelector('[data-deps]');
    if (deps) {
      deps.innerHTML = (n.deps || []).filter(d => doc.nodes[d]).map(d =>
        `<span class="dep-chip">${esc(label(d))}<button type="button" data-dep-del="${esc(d)}" title="entfernen">×</button></span>`).join('') || '<span class="insp-hint">keine</span>';
      const selEl = body.querySelector('[data-act="add-dep"]');
      if (selEl && selEl !== active) {
        const exclude = new Set([id, ...descendants(id, false), ...ancestors(id), ...(n.deps || [])]);
        const opts = treeOrder().filter(t => isTask(t) && !exclude.has(t));
        selEl.innerHTML = '<option value="">+ Vorgänger hinzufügen …</option>' + opts.map(t => `<option value="${esc(t)}">${esc(label(t))}</option>`).join('');
      }
    }
  }
}

// ── Ereignisse ──────────────────────────────────────────────────────
function wireInspector(body) {
  body.querySelectorAll('[data-field]').forEach(el => {
    const f = el.dataset.field;
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const id = sel.size === 1 ? [...sel][0] : null;
      if (!id || !doc.nodes[id]) return;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      mutate('Eigenschaft ändern', () => {
        const n = doc.nodes[id];
        if (f === 'task') {
          if (v) { n.task = true; if (!n.status) n.status = 'todo'; } else { delete n.task; delete n.status; }
        } else if (f === 'dur') {
          const d = Math.max(1, parseInt(v, 10) || 1);
          if (!n.start) n.start = n.due ? addDays(n.due, -(d - 1)) : todayISO();
          n.due = addDays(n.start, d - 1);
        } else if (f === 'shape') {
          if (v === 'auto') delete n.shape; else n.shape = v;
        } else if (f === 'ms') {
          if (v) { n.ms = true; if (n.due) n.start = n.due; else if (n.start) n.due = n.start; } else delete n.ms;
        } else if (f === 'start' && n.ms) {
          if (v) { n.start = v; n.due = v; } else { delete n.start; }
        } else if (typeof v === 'string' && !v.trim() && f !== 'text' && f !== 'boundary') delete n[f];
        else n[f] = v;
      }, { merge: 'insp:' + id + ':' + f });
      if (f === 'task') inspectorKey = '';
    });
  });
  body.querySelectorAll('[data-lfield]').forEach(el => {
    el.addEventListener('input', () => {
      if (!selLink) return;
      const lid = selLink;
      mutate('Beschriftung', () => { doc.links[lid][el.dataset.lfield] = el.value; }, { merge: 'link:' + lid });
    });
  });
  body.querySelectorAll('[data-mfield]').forEach(el => {
    el.addEventListener('input', () => {
      mutate('Titel', () => { M()[el.dataset.mfield] = el.value; }, { merge: 'meta:' + el.dataset.mfield });
    });
  });
  body.querySelectorAll('[data-seg]').forEach(seg => {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const name = seg.dataset.seg, val = b.dataset.val;
      const ids = [...sel];
      mutate('Ändern', () => {
        for (const id of ids) {
          const n = doc.nodes[id];
          if (!n) continue;
          if (name === 'status' || name === 'm-status') { n.task = true; n.status = val; }
          else if (name === 'prio' || name === 'm-prio') { if (Number(val)) n.prio = Number(val); else delete n.prio; }
          else if (name === 'm-task') { if (val === 'on') { n.task = true; if (!n.status) n.status = 'todo'; } else { delete n.task; delete n.status; } }
        }
      });
    });
  });
  body.querySelectorAll('[data-icon]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.icon;
    mutate('Symbol', () => { for (const id of sel) { if (v) doc.nodes[id].icon = v; else delete doc.nodes[id].icon; } });
  }));
  body.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.color;
    mutate('Farbe', () => { for (const id of sel) { if (v) doc.nodes[id].color = v; else delete doc.nodes[id].color; } });
  }));
  body.querySelectorAll('[data-act]').forEach(el => {
    const act = el.dataset.act;
    const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'click';
    el.addEventListener(ev, () => inspectorAction(act, el));
  });
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-dep-del]');
    if (!b) return;
    const id = [...sel][0], d = b.dataset.depDel;
    mutate('Abhängigkeit entfernen', () => {
      const n = doc.nodes[id];
      n.deps = (n.deps || []).filter(x => x !== d);
      if (!n.deps.length) delete n.deps;
    });
  });
}

function inspectorAction(act, el) {
  const id = sel.size === 1 ? [...sel][0] : null;
  switch (act) {
    case 'open-link': if (id) openNodeLink(id); break;
    case 'child': addChild(id); break;
    case 'sibling': addSibling(id); break;
    case 'link': startLinkMode(id); if (currentView !== 'map') switchView('map'); break;
    case 'delete': deleteSelection(); break;
    case 'group': groupSelection(); break;
    case 'boundary':
      if (!id) break;
      mutate('Rahmen', () => { if (el.checked) doc.nodes[id].boundary = ''; else delete doc.nodes[id].boundary; });
      inspectorKey = ''; updateInspector();
      break;
    case 'img-add': pickImage(id); break;
    case 'img-del': mutate('Bild entfernen', () => { delete doc.nodes[id].img; }); break;
    case 'fs+': case 'fs-': case 'fs0': {
      const ids = [...sel];
      mutate('Schriftgröße', () => {
        for (const k of ids) {
          const n = doc.nodes[k];
          const v = act === 'fs0' ? 0 : Math.max(-6, Math.min(24, (n.fs || 0) + (act === 'fs+' ? 2 : -2)));
          if (v) n.fs = v; else delete n.fs;
        }
      }, { merge: 'fs' });
      break;
    }
    case 'vote+': castVote(id, 1); break;
    case 'vote-': castVote(id, -1); break;
    case 'add-dep':
      if (!el.value || !id) break;
      { const d = el.value;
        mutate('Abhängigkeit', () => { const n = doc.nodes[id]; n.deps = [...new Set([...(n.deps || []), d])]; }); }
      el.value = '';
      break;
    case 'm-owner-set': {
      const inp = document.querySelector('[data-act="m-owner"]');
      const v = inp ? inp.value.trim() : '';
      mutate('Zuständig', () => { for (const k of sel) { const n = doc.nodes[k]; n.task = true; if (!n.status) n.status = 'todo'; if (v) n.owner = v; else delete n.owner; } });
      break;
    }
    case 'link-rev':
      if (selLink) mutate('Richtung', () => { const l = doc.links[selLink]; [l.from, l.to] = [l.to, l.from]; });
      break;
  }
}

/** Bild wählen, verkleinern (max. 480 px) und als data:-URL speichern. */
function pickImage(id) {
  if (!id) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 480 / img.width, 480 / img.height);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const png = f.type === 'image/png' || f.type === 'image/gif';
        const url = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85);
        mutate('Bild', () => { doc.nodes[id].img = url; });
      };
      img.onerror = () => showModal('Bild', 'Das Bild konnte nicht gelesen werden.');
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  inp.click();
}

// ════════════════════════════════════════════════════════════════════
// Ideen sammeln (Eingabefeld in der linken Leiste)
// ════════════════════════════════════════════════════════════════════
function captureTarget() {
  const p = primary();
  return p && doc.nodes[p] ? p : (layoutRoot || index().rid);
}
function updateCaptureTarget() {
  const el = $('capture-target');
  if (!el) return;
  const t = captureTarget();
  el.textContent = isRoot(t) ? 'als neuer Hauptast' : 'unter „' + label(t).slice(0, 40) + '“';
}
function submitCapture() {
  const inp = $('capture-input');
  if (!inp) return;
  const text = inp.value;
  if (!text.trim()) return;
  const target = captureTarget();
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length > 1) {
    const data = parseIndentedText(text);
    let out = [];
    mutate('Ideen', () => { out = insertSubtrees(data, target); });
    flashStatus(`${out.length} Ideen hinzugefügt`);
  } else {
    let nid = null;
    mutate('Idee', () => { nid = createChild(target, lines[0]); });
    if (nid && currentView === 'map') { requestRender(true); setTimeout(() => ensureVisible(nid), 30); }
    flashStatus('Idee hinzugefügt');
  }
  inp.value = '';
  inp.style.height = '';
  inp.focus();
}

// ════════════════════════════════════════════════════════════════════
// Brainstorming-Timer (läuft beim gemeinsamen Bearbeiten bei allen)
// ════════════════════════════════════════════════════════════════════
let timerTick = null;
let timerBeeped = 0;
let serverOffset = 0;   // Server-Zeit minus lokale Zeit (aus mm-collab.js)
function nowSynced() { return Date.now() + serverOffset; }

function startTimer(min) {
  mutate('Timer', () => { M().timerEnd = nowSynced() + min * 60000; M().timerDur = min; }, { noUndo: true });
}
function stopTimer() {
  mutate('Timer', () => { delete M().timerEnd; delete M().timerDur; }, { noUndo: true });
}
function updateTimer() {
  const end = M().timerEnd;
  const disp = $('timer-display'), chip = $('timer-chip');
  const box = $('timer-box');
  if (!end) {
    if (disp) disp.textContent = '';
    if (chip) chip.style.display = 'none';
    if (box) box.classList.remove('running');
    clearInterval(timerTick); timerTick = null;
    return;
  }
  const left = Math.max(0, Math.round((end - nowSynced()) / 1000));
  const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  if (disp) disp.textContent = txt;
  if (chip) { chip.style.display = 'inline-flex'; chip.textContent = '⏱ ' + txt; chip.classList.toggle('over', left === 0); }
  if (box) box.classList.add('running');
  if (left === 0 && timerBeeped !== end) {
    timerBeeped = end;
    flashStatus('Zeit ist um!', 6000);
    beep();
  }
  if (!timerTick) timerTick = setInterval(updateTimer, 500);
}
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    [0, 0.25, 0.5].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.15, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.18);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
    });
  } catch (e) { /* kein Ton möglich */ }
}

// ════════════════════════════════════════════════════════════════════
// Punktevergabe (Dot-Voting) in der Phase „Ordnen“
// ════════════════════════════════════════════════════════════════════
function myVotesUsed() {
  const me = myId();
  let s = 0;
  for (const k in doc.votes) if (doc.votes[k].voter === me) s += doc.votes[k].n || 0;
  return s;
}
function castVote(id, delta) {
  if (!id || readOnly) return;
  const me = myId();
  const key = id + '|' + me;
  const cur = doc.votes[key] ? doc.votes[key].n : 0;
  const limit = M().voteLimit || 3;
  if (delta > 0 && myVotesUsed() >= limit) { flashStatus(`Alle ${limit} Punkte vergeben – mit Alt-Klick oder „−“ zurücknehmen`); return; }
  if (delta < 0 && !cur) return;
  mutate('Punkt', () => {
    const n = cur + delta;
    if (n <= 0) delete doc.votes[key];
    else doc.votes[key] = { id: key, node: id, voter: me, name: myName() || undefined, n };
  });
}
function resetVotes(all) {
  const me = myId();
  mutate(all ? 'Alle Punkte löschen' : 'Eigene Punkte löschen', () => {
    for (const k in doc.votes) if (all || doc.votes[k].voter === me) delete doc.votes[k];
  });
}
function updateVoteBox() {
  const box = $('vote-box');
  if (!box) return;
  box.style.display = phase() === 'order' ? '' : 'none';
  const used = myVotesUsed(), limit = M().voteLimit || 3;
  const dots = $('vote-dots');
  if (dots) dots.innerHTML = Array.from({ length: limit }, (_, i) => `<i class="${i < limit - used ? 'free' : ''}"></i>`).join('');
  const lim = $('vote-limit');
  if (lim && document.activeElement !== lim) lim.value = limit;
}
