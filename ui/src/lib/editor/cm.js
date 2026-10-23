// CodeMirror 6 setup for markdown editing: theme from CSS tokens (works in both
// light/dark without reconfiguring), markdown highlighting, search, history,
// Ctrl/Cmd+click link following, annotations gutter and read-only toggling.

import { EditorState, Compartment, StateField, StateEffect, RangeSet } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, gutter, GutterMarker, ViewPlugin, Decoration, placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { mentionAt } from '../links.js';

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', height: '100%', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { padding: '14px 0 40vh', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 20px 0 12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 26%, transparent) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--panel-hover)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-3)', border: 'none', userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '44px', fontSize: '11px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 18%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 28%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--warn) 55%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--panel-active)', outline: '1px solid var(--border-strong)' },
  '.cm-panels': { backgroundColor: 'var(--panel-solid)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-search': { padding: '8px 12px', fontFamily: 'var(--font)', fontSize: '12.5px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-2)' },
  '.cm-textfield': { background: 'var(--inset)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text)', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '12px' },
  '.cm-button': { background: 'var(--panel-hover)', backgroundImage: 'none', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text)', padding: '3px 9px', fontSize: '12px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--text-3)', fontSize: '16px', right: '8px' },
  '.cm-tooltip': { background: 'var(--panel-solid)', border: '1px solid var(--border-strong)', borderRadius: '8px' },
  '.cm-placeholder': { color: 'var(--text-3)' },
  '.cm-annot-gutter': { width: '18px' },
  '.cm-annot-gutter .cm-gutterElement': { cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-annot-gutter .cm-gutterElement:hover:empty::after': { content: '"+"', color: 'var(--accent)', fontWeight: '700', fontSize: '13px', fontFamily: 'var(--font)' },
  '.cm-annot': { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' },
  '.cm-annot.resolved': { background: 'var(--text-3)', boxShadow: 'none' },
  '.cm-mdlink': { textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--accent) 45%, transparent)', textUnderlineOffset: '3px' },
  '&.mod-down .cm-mdlink': { cursor: 'pointer', textDecorationColor: 'var(--accent)', color: 'var(--accent)' },
  '.cm-conflict': { backgroundColor: 'color-mix(in srgb, var(--err) 14%, transparent)' },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.25em', color: 'var(--text)' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.12em', color: 'var(--text)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '650', color: 'var(--text)' },
  { tag: t.processingInstruction, color: 'var(--text-3)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--accent-2)' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [t.list, t.contentSeparator], color: 'var(--text-3)' },
  { tag: t.meta, color: 'var(--text-3)' },
  { tag: t.comment, color: 'var(--text-3)', fontStyle: 'italic' },
  { tag: [t.keyword, t.atom, t.bool], color: 'var(--accent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: [t.number, t.literal], color: 'var(--warn)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--info)' },
  { tag: t.labelName, color: 'var(--info)' },
]);

// --- link-ish ranges (md links, wiki, @imports, backticked paths) underlined
const LINK_RE = /\[[^\]\n]*\]\(([^)\s]+)[^)]*\)|\[\[[^\]\n]+\]\]|(?:^|\s)@(?:~\/|\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+|`[^`\n]*[./][^`\n]*`/g;
const linkMark = Decoration.mark({ class: 'cm-mdlink' });
function linkDecos(view) {
  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      LINK_RE.lastIndex = 0;
      for (const m of line.text.matchAll(LINK_RE)) {
        let s = line.from + m.index;
        if (/^\s/.test(m[0])) s++;
        ranges.push(linkMark.range(s, line.from + m.index + m[0].length));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}
const linkPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = linkDecos(view);
    }
    update(u) {
      if (u.docChanged || u.viewportChanged) this.decorations = linkDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// --- annotations gutter
export const setAnnotations = StateEffect.define();
class AnnotMarker extends GutterMarker {
  constructor(resolved, title) {
    super();
    this.resolved = resolved;
    this.title = title;
  }
  eq(o) {
    return o.resolved === this.resolved && o.title === this.title;
  }
  toDOM() {
    const d = document.createElement('span');
    d.className = 'cm-annot' + (this.resolved ? ' resolved' : '');
    d.title = this.title;
    return d;
  }
}
const annotField = StateField.define({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setAnnotations)) {
        const doc = tr.state.doc;
        const byLine = new Map();
        for (const a of e.value || []) {
          if (a.line < 1 || a.line > doc.lines) continue;
          const prev = byLine.get(a.line);
          byLine.set(a.line, { resolved: (prev ? prev.resolved : true) && a.resolved, text: (prev ? prev.text + '\n' : '') + a.text });
        }
        const ranges = [...byLine.entries()].sort((x, y) => x[0] - y[0]).map(([l, v]) => new AnnotMarker(v.resolved, v.text).range(doc.line(l).from));
        set = RangeSet.of(ranges);
      }
    }
    return set;
  },
});

/**
 * @param {HTMLElement} parent
 * @param {{ doc: string, readOnly?: boolean, onChange?: (s:string)=>void, onSave?: ()=>void,
 *   onLink?: (target:string)=>void, onGutter?: (line:number)=>void, onContext?: (e:MouseEvent, info:any)=>void,
 *   onScroll?: (line:number)=>void, placeholder?: string }} opts
 */
export function createEditor(parent, opts) {
  const ro = new Compartment();
  const cbs = { ...opts };
  const extensions = [
    lineNumbers(),
    gutter({
      class: 'cm-annot-gutter',
      markers: (v) => v.state.field(annotField),
      renderEmptyElements: true,
      domEventHandlers: {
        mousedown(view, block) {
          cbs.onGutter?.(view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
    annotField,
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    indentOnInput(),
    bracketMatching(),
    search({ top: true }),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlight),
    theme,
    linkPlugin,
    cmPlaceholder(opts.placeholder || 'Start writing…'),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (cbs.onSave?.(), true) },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    ro.of([EditorState.readOnly.of(!!opts.readOnly), EditorView.editable.of(!opts.readOnly)]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) cbs.onChange?.(u.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const line = view.state.doc.lineAt(pos);
        const m = mentionAt(line.text, pos - line.from);
        if (!m) return false;
        e.preventDefault();
        cbs.onLink?.(m.target.replace(/^`|`$/g, ''));
        return true;
      },
      contextmenu(e, view) {
        if (e.shiftKey || !cbs.onContext) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const line = pos != null ? view.state.doc.lineAt(pos) : null;
        const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
        const mention = line ? mentionAt(line.text, pos - line.from) : null;
        cbs.onContext(e, { line: line?.number || 1, selection: sel, mention: mention?.target?.replace(/^`|`$/g, '') || null });
        return true;
      },
    }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: opts.doc || '', extensions }), parent });

  const onScrollDom = () => {
    if (!cbs.onScroll) return;
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 4);
    cbs.onScroll(view.state.doc.lineAt(block.from).number);
  };
  view.scrollDOM.addEventListener('scroll', onScrollDom, { passive: true });

  // Ctrl/Cmd held → links become clickable (class on the editor root)
  const onKey = (e) => view.dom.classList.toggle('mod-down', e.metaKey || e.ctrlKey);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onKey);

  return {
    view,
    get value() {
      return view.state.doc.toString();
    },
    set(text, { keepScroll = true } = {}) {
      const cur = view.state.doc.toString();
      if (cur === text) return;
      const sel = view.state.selection.main.head;
      const scroll = view.scrollDOM.scrollTop;
      view.dispatch({ changes: { from: 0, to: cur.length, insert: text }, selection: { anchor: Math.min(sel, text.length) } });
      if (keepScroll) view.scrollDOM.scrollTop = scroll;
    },
    setReadOnly(r) {
      view.dispatch({ effects: ro.reconfigure([EditorState.readOnly.of(!!r), EditorView.editable.of(!r)]) });
    },
    setAnnotations(list) {
      view.dispatch({ effects: setAnnotations.of(list || []) });
    },
    setCallbacks(c) {
      Object.assign(cbs, c);
    },
    gotoLine(n) {
      const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, n)));
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      view.focus();
    },
    selection() {
      const r = view.state.selection.main;
      return { text: view.state.sliceDoc(r.from, r.to), line: view.state.doc.lineAt(r.head).number };
    },
    focus() {
      view.focus();
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onKey);
      view.destroy();
    },
  };
}
