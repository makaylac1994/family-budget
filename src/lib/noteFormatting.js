// A deliberately small, hand-rolled subset of Markdown for the Settings
// notes: bold, bullet/numbered lists, one level of indent-nesting. No
// markdown dependency needed for a handful of formats.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyInline(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Converts raw note text into safe HTML. User text is escaped before any
// tag is introduced, and the only tags ever emitted are the fixed ones this
// function controls, so the result is safe to render via
// dangerouslySetInnerHTML.
export function renderNoteHtml(text) {
  const lines = (text || '').split('\n');
  const out = [];
  const stack = []; // list-type stack, one entry per open <ul>/<ol>
  const closeTo = (level) => { while (stack.length > level) out.push(`</${stack.pop()}>`); };
  const LIST_STYLE = ['disc', 'circle', 'square'];

  lines.forEach((line) => {
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    const numbered = line.match(/^(\s*)\d+\.\s+(.*)$/);
    const item = bullet || numbered;
    if (item) {
      const level = Math.min(3, Math.floor(item[1].replace(/\t/g, '  ').length / 2)) + 1;
      const type = bullet ? 'ul' : 'ol';
      if (stack.length > level) closeTo(level);
      if (stack.length < level) {
        while (stack.length < level) {
          out.push(`<${type} style="margin:0 0 4px;padding-left:20px;list-style-type:${type === 'ul' ? LIST_STYLE[stack.length % 3] : 'decimal'}">`);
          stack.push(type);
        }
      } else if (stack[stack.length - 1] !== type) {
        out.push(`</${stack.pop()}>`);
        out.push(`<${type} style="margin:0 0 4px;padding-left:20px;list-style-type:${type === 'ul' ? 'disc' : 'decimal'}">`);
        stack.push(type);
      }
      out.push(`<li style="margin-bottom:2px">${applyInline(item[2])}</li>`);
    } else {
      closeTo(0);
      if (line.trim()) out.push(`<p style="margin:0 0 4px">${applyInline(line)}</p>`);
    }
  });
  closeTo(0);
  return out.join('');
}

export function wrapSelection(textarea, marker) {
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const selected = value.slice(s, e);
  const next = value.slice(0, s) + marker + selected + marker + value.slice(e);
  return { next, selStart: s + marker.length, selEnd: s + marker.length + selected.length };
}

export function prefixLines(textarea, prefix) {
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const block = value.slice(lineStart, lineEnd).split('\n').map((l) => prefix + l).join('\n');
  return { next: value.slice(0, lineStart) + block + value.slice(lineEnd), selStart: lineStart, selEnd: lineStart + block.length };
}

export function indentLines(textarea, delta) {
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const block = value.slice(lineStart, lineEnd).split('\n')
    .map((l) => (delta > 0 ? '  ' + l : l.replace(/^ {1,2}/, '')))
    .join('\n');
  return { next: value.slice(0, lineStart) + block + value.slice(lineEnd), selStart: lineStart, selEnd: lineStart + block.length };
}
