'use client';

import React, { useEffect, useState, forwardRef, useImperativeHandle, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Bold, Italic, List, ListOrdered, Code, Quote, Heading1, Heading2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

const lowlight = createLowlight(common);

// ─── SLASH COMMANDS UI ────────────────────────────────────────────────────────

const CommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex(i => (i + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex(i => (i + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-2xl p-1 min-w-[200px] overflow-hidden">
      {props.items.length ? (
        props.items.map((item: any, index: number) => (
          <button
            key={index}
            onClick={() => selectItem(index)}
            className={cn(
              'flex items-center gap-3 w-full px-2.5 py-2 text-xs text-left rounded-md transition-colors',
              index === selectedIndex
                ? 'bg-[#222] text-foreground'
                : 'text-muted-foreground hover:bg-[#1a1a1a]'
            )}
          >
            <div className="w-6 h-6 rounded border border-[#2a2a2a] bg-[#0d0d0d] flex items-center justify-center text-primary/70">
              {item.icon}
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{item.title}</span>
              {item.subtitle && (
                <span className="text-[10px] text-muted-foreground opacity-60">{item.subtitle}</span>
              )}
            </div>
          </button>
        ))
      ) : (
        <div className="px-2 py-1 text-xs text-muted-foreground">No matches</div>
      )}
    </div>
  );
});

CommandList.displayName = 'CommandList';

// ─── SLASH COMMANDS EXTENSION ─────────────────────────────────────────────────

const Commands = Extension.create({
  name: 'commands',
  addOptions() {
    return { suggestion: { char: '/', command: ({ editor, range, props }: any) => props.command({ editor, range }) } };
  },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

const COMMAND_ITEMS = [
  { title: 'Heading 1', subtitle: 'Big section heading', icon: <Heading1 className="w-3.5 h-3.5" />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', subtitle: 'Medium section heading', icon: <Heading2 className="w-3.5 h-3.5" />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
  { title: 'Bullet List', subtitle: 'Create a simple bulleted list', icon: <List className="w-3.5 h-3.5" />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: 'Numbered List', subtitle: 'Create a numbered list', icon: <ListOrdered className="w-3.5 h-3.5" />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: 'Code Block', subtitle: 'Insert a code block', icon: <Terminal className="w-3.5 h-3.5" />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: 'Quote', subtitle: 'Capture a quote', icon: <Quote className="w-3.5 h-3.5" />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
];

const renderItems = () => {
  let component: any;
  let popup: any;
  return {
    onStart: (props: any) => {
      component = new ReactRenderer(CommandList, { props, editor: props.editor });
      popup = tippy('body', {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        zIndex: 9999,
      });
    },
    onUpdate: (props: any) => {
      component.updateProps(props);
      if (popup?.[0]) popup[0].setProps({ getReferenceClientRect: props.clientRect });
    },
    onKeyDown: (props: any) => {
      if (props.event.key === 'Escape') { if (popup?.[0]) popup[0].hide(); return true; }
      return component.ref?.onKeyDown(props);
    },
    onExit: () => { if (popup?.[0]) popup[0].destroy(); component.destroy(); },
  };
};

// ─── CUSTOM FLOATING BUBBLE MENU ──────────────────────────────────────────────

interface BubblePosition { top: number; left: number }

function SelectionBubbleMenu({ editor }: { editor: any }) {
  const [pos, setPos] = useState<BubblePosition | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) { setPos(null); return; }
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) { setPos(null); return; }
      const range = domSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) { setPos(null); return; }
      setPos({ top: rect.top + window.scrollY - 48, left: rect.left + window.scrollX + rect.width / 2 - 90 });
    };
    editor.on('selectionUpdate', update);
    editor.on('blur', () => setPos(null));
    return () => { editor.off('selectionUpdate', update); editor.off('blur'); };
  }, [editor]);

  if (!mounted || !pos || !editor) return null;

  const buttons = [
    { key: 'bold', icon: <Bold className="w-3.5 h-3.5" />, action: () => editor.chain().focus().toggleBold().run() },
    { key: 'italic', icon: <Italic className="w-3.5 h-3.5" />, action: () => editor.chain().focus().toggleItalic().run() },
    null,
    { key: 'bulletList', icon: <List className="w-3.5 h-3.5" />, action: () => editor.chain().focus().toggleBulletList().run() },
    { key: 'code', icon: <Code className="w-3.5 h-3.5" />, action: () => editor.chain().focus().toggleCode().run() },
  ];

  return createPortal(
    <div
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="flex items-center gap-0.5 bg-[#141414] border border-[#2a2a2a] rounded-lg p-1 shadow-2xl pointer-events-auto"
      onMouseDown={(e) => e.preventDefault()} // keep editor focus
    >
      {buttons.map((btn, i) =>
        btn === null ? (
          <div key={`sep-${i}`} className="w-[1px] h-3 bg-[#2a2a2a] mx-0.5" />
        ) : (
          <Button
            key={btn.key}
            variant="ghost"
            size="icon"
            className={cn('w-7 h-7', editor.isActive(btn.key) ? 'bg-primary/20 text-primary' : 'text-muted-foreground')}
            onClick={btn.action}
          >
            {btn.icon}
          </Button>
        )
      )}
    </div>,
    document.body
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string | null | undefined;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  isReadOnly?: boolean;
  minHeight?: string;
  /** Increment to reset the editor content (e.g. after comment submit) */
  resetKey?: number;
}

const READ_ONLY_PROSE = [
  'prose prose-invert max-w-none text-[13px] leading-relaxed',
  'prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1',
  'prose-ul:list-disc prose-ul:list-outside prose-ul:ml-4',
  'prose-ol:list-decimal prose-ol:list-outside prose-ol:ml-4',
  'prose-code:bg-[#1a1a1a] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-primary prose-code:text-[12px] prose-code:font-mono prose-code:border prose-code:border-white/5 prose-code:before:content-none prose-code:after:content-none',
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-4 prose-blockquote:not-italic prose-blockquote:text-muted-foreground',
  'prose-pre:bg-[#0d0d0d] prose-pre:p-3 prose-pre:rounded-lg prose-pre:border prose-pre:border-[#1e1e1e] prose-pre:my-3',
].join(' ');

const EDITABLE_PROSE = [
  'p-3 text-sm text-foreground outline-none',
  'prose prose-invert max-w-none',
  'prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1',
  'prose-ul:list-disc prose-ul:list-outside prose-ul:ml-4',
  'prose-ol:list-decimal prose-ol:list-outside prose-ol:ml-4',
  'prose-code:bg-[#1a1a1a] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-primary prose-code:text-[12px] prose-code:font-mono prose-code:border prose-code:border-white/5 prose-code:before:content-none prose-code:after:content-none',
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-4 prose-blockquote:not-italic prose-blockquote:text-muted-foreground',
  'prose-pre:bg-[#0d0d0d] prose-pre:p-3 prose-pre:rounded-lg prose-pre:border prose-pre:border-[#1e1e1e] prose-pre:my-3 prose-pre:overflow-x-auto',
  '[&_.ProseMirror]:outline-none',
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted-foreground/30',
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left',
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none',
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0',
].join(' ');

const TOOLBAR_ITEMS = [
  { key: 'bold', icon: <Bold className="w-3.5 h-3.5" />, action: (e: any) => e.chain().focus().toggleBold().run() },
  { key: 'italic', icon: <Italic className="w-3.5 h-3.5" />, action: (e: any) => e.chain().focus().toggleItalic().run() },
  null, // divider
  { key: 'bulletList', icon: <List className="w-3.5 h-3.5" />, action: (e: any) => e.chain().focus().toggleBulletList().run() },
  { key: 'orderedList', icon: <ListOrdered className="w-3.5 h-3.5" />, action: (e: any) => e.chain().focus().toggleOrderedList().run() },
  null, // divider
  { key: 'code', icon: <Code className="w-3.5 h-3.5" />, action: (e: any) => e.chain().focus().toggleCode().run() },
  { key: 'blockquote', icon: <Quote className="w-3.5 h-3.5" />, action: (e: any) => e.chain().focus().toggleBlockquote().run() },
] as const;

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  className,
  isReadOnly = false,
  minHeight = '100px',
  resetKey,
}: RichTextEditorProps) {
  // Prevents the external sync effect from stomping on the user's mid-typing state
  const isInternalUpdate = useRef(false);

  const getMarkdown = (ed: ReturnType<typeof useEditor>): string =>
    // @ts-ignore — tiptap-markdown attaches .storage.markdown.getMarkdown()
    ed ? ((ed as any).storage?.markdown?.getMarkdown() ?? '') : '';

  const editor = useEditor({
    editable: !isReadOnly,
    immediatelyRender: false, // SSR-safe
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown,
      Placeholder.configure({ placeholder }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-primary underline cursor-pointer' },
      }),
      Commands.configure({
        suggestion: {
          items: ({ query }: { query: string }) =>
            COMMAND_ITEMS.filter(i => i.title.toLowerCase().startsWith(query.toLowerCase())),
          render: renderItems,
        },
      }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      isInternalUpdate.current = true;
      onChange?.(getMarkdown(editor));
    },
  });

  // Keep Tiptap's editable state in sync when isReadOnly changes (React may reuse
  // the same instance instead of remounting, so useEditor's initial value is stale)
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isReadOnly)
    }
  }, [editor, isReadOnly])

  // Sync external value changes in (skip if the change came from us)
  useEffect(() => {
    if (!editor) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const current = getMarkdown(editor);
    if (value !== current) {
      editor.commands.setContent(value || '');
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Imperative reset — triggered by incrementing resetKey (e.g. after comment submit)
  useEffect(() => {
    if (!editor || resetKey === undefined) return;
    editor.commands.setContent('');
    isInternalUpdate.current = false; // allow next sync
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;

  if (isReadOnly) {
    return (
      <div className={cn(READ_ONLY_PROSE, className)}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex flex-col border border-[#1e1e1e] rounded-lg overflow-hidden',
        'focus-within:border-primary/50 transition-colors bg-[#0f0f0f]',
        className
      )}
    >
      <SelectionBubbleMenu editor={editor} />

      <div style={{ minHeight }} className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className={EDITABLE_PROSE} />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-[#161616] border-t border-[#1e1e1e] flex-shrink-0">
        <div className="flex items-center gap-0.5">
          {TOOLBAR_ITEMS.map((item, i) =>
            item === null ? (
              <div key={`sep-${i}`} className="w-[1px] h-4 bg-[#1e1e1e] mx-1" />
            ) : (
              <Button
                key={item.key}
                variant="ghost"
                size="icon"
                className={cn(
                  'w-8 h-8',
                  editor.isActive(item.key) ? 'bg-[#222] text-foreground' : 'text-muted-foreground hover:bg-[#222]'
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => item.action(editor)}
              >
                {item.icon}
              </Button>
            )
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/30 font-medium px-2 italic select-none">
          Type '/' for commands
        </span>
      </div>
    </div>
  );
}
