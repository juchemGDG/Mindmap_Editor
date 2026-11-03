'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – kleines Markdown für Karteninhalte (Notizen)
//
// Sicher von Grund auf: Der Text wird ZUERST komplett maskiert (&, <, >, ").
// Danach werden nur wenige, bekannte Muster in HTML verwandelt. Eigenes HTML
// im Text kann so nie wirksam werden – ein Sanitizer ist nicht nötig.
//
// Unterstützt: # Überschriften, **fett**, *kursiv* / _kursiv_, `Code`,
// ```Codeblock```, Listen (- * 1.), Aufgaben (- [ ] / - [x]), > Zitat,
// [Text](https://…) und nackte https://-Adressen.
// Bewusst NICHT: Bilder (externe Bilder würden die IP-Adresse an fremde
// Server verraten – sie erscheinen nur als Link), HTML, Tabellen.
// ════════════════════════════════════════════════════════════════════

function mdEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Nur http, https und mailto sind als Link-Ziel erlaubt. */
function mdSafeUrl(url) {
  const u = String(url).trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

/** Zeileninhalt (bereits maskiert) mit fett/kursiv/Code/Links versehen. */
function mdInline(s) {
  // Code und Links zuerst als Platzhalter herausnehmen, damit darin nichts
  // weiter umgewandelt wird (z. B. „_“ in einer Adresse wird nicht kursiv)
  const parts = [];
  const keep = html => { parts.push(html); return `\u0000${parts.length - 1}\u0000`; };
  const link = (url, text) => `<a href="${mdEsc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  s = s.replace(/`([^`]+)`/g, (m, c) => keep(`<code>${c}</code>`));
  // Bilder ![alt](url) → nur als Link anzeigen, nie laden
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = mdSafeUrl(url.replace(/&amp;/g, '&'));
    return u ? keep(link(u, 'Bild: ' + (alt || 'Link'))) : 'Bild: ' + alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = mdSafeUrl(url.replace(/&amp;/g, '&'));
    return u ? keep(link(u, text)) : text;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000]+)/g, (m, pre, url) => pre + keep(link(url.replace(/&amp;/g, '&'), url)));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => parts[Number(i)]);
}

/** Markdown-Text in sicheres HTML umwandeln. */
function renderMarkdown(text) {
  // \u0000 dient intern als Platzhalter-Zeichen und darf im Text nicht vorkommen
  const lines = mdEsc(String(text || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let list = null;          // 'ul' | 'ol'
  let code = null;          // gesammelte Zeilen eines Codeblocks
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw.trim())) { out.push(`<pre><code>${code.join('\n')}</code></pre>`); code = null; }
      else code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) { closeList(); code = []; continue; }
    if (!line.trim()) { closeList(); continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); const h = m[1].length + 2; out.push(`<h${h}>${mdInline(m[2])}</h${h}>`); continue; }
    if ((m = line.match(/^&gt;\s?(.*)$/))) { closeList(); out.push(`<blockquote>${mdInline(m[1])}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul class="md-tasks">'); list = 'ul'; }
      out.push(`<li><span class="md-box${m[1] === ' ' ? '' : ' on'}" aria-label="${m[1] === ' ' ? 'offen' : 'erledigt'}">${m[1] === ' ' ? '☐' : '☑'}</span> ${mdInline(m[2])}</li>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${mdInline(m[1])}</li>`); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${mdInline(m[1])}</li>`); continue;
    }
    closeList();
    out.push(`<p>${mdInline(line)}</p>`);
  }
  if (code) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  closeList();
  return out.join('');
}
