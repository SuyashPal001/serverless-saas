'use client'

import { useEffect, useRef } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Link } from '@tiptap/extension-link'
import { Mention } from '@tiptap/extension-mention'
import { Bold, Italic, Code, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMentionSuggestions } from '@/hooks/use-mention-suggestions'
import { createMentionSuggestion } from './mention-suggestion'

interface CommentEditorProps {
    taskId: string
    onSubmit: (html: string) => void
    isPending?: boolean
}

export function CommentEditor({ taskId: _taskId, onSubmit, isPending }: CommentEditorProps) {
    const allItems = useMentionSuggestions()
    const allItemsRef = useRef(allItems)

    useEffect(() => { allItemsRef.current = allItems }, [allItems])

    const editor = useEditor({
        extensions: [
            StarterKit,
            Placeholder.configure({ placeholder: 'Add a comment… (⌘+Enter to send)' }),
            Link.configure({ openOnClick: false }),
            Mention.configure({
                HTMLAttributes: { class: 'mention' },
                suggestion: createMentionSuggestion(() => allItemsRef.current),
            }),
        ],
        editorProps: {
            attributes: { class: 'outline-none min-h-[2.5rem] max-h-32 overflow-y-auto' },
            handleKeyDown: (_view, event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    submit()
                    return true
                }
                return false
            },
        },
    })

    const submit = () => {
        if (!editor) return
        const html = editor.getHTML()
        const text = editor.getText().trim()
        if (!text) return
        onSubmit(html)
        editor.commands.clearContent()
    }

    // Subscribes to selection/transaction updates so active state re-renders correctly
    const editorState = useEditorState({
        editor,
        selector: (ctx) => ({
            isBold: ctx.editor?.isActive('bold') ?? false,
            isItalic: ctx.editor?.isActive('italic') ?? false,
            isCode: ctx.editor?.isActive('code') ?? false,
            isLink: ctx.editor?.isActive('link') ?? false,
        }),
    })

    const isEmpty = !editor?.getText().trim()

    return (
        <div className="flex-1">
            {/* Mini toolbar */}
            <div className="flex items-center gap-0.5 mb-1.5">
                <MiniToolbarBtn
                    active={editorState?.isBold ?? false}
                    onClick={() => editor?.chain().toggleBold().run()}
                    title="Bold"
                >
                    <Bold className="w-3 h-3" />
                </MiniToolbarBtn>
                <MiniToolbarBtn
                    active={editorState?.isItalic ?? false}
                    onClick={() => editor?.chain().toggleItalic().run()}
                    title="Italic"
                >
                    <Italic className="w-3 h-3" />
                </MiniToolbarBtn>
                <MiniToolbarBtn
                    active={editorState?.isCode ?? false}
                    onClick={() => editor?.chain().toggleCode().run()}
                    title="Inline code"
                >
                    <Code className="w-3 h-3" />
                </MiniToolbarBtn>
                <MiniToolbarBtn
                    active={editorState?.isLink ?? false}
                    onClick={() => {
                        if (!editor) return
                        if (editor.isActive('link')) {
                            editor.chain().unsetLink().run()
                        } else {
                            const url = window.prompt('URL')
                            if (url) editor.chain().setLink({ href: url }).run()
                        }
                    }}
                    title="Link"
                >
                    <Link2 className="w-3 h-3" />
                </MiniToolbarBtn>
            </div>

            <EditorContent
                editor={editor}
                className={cn(
                    'w-full bg-[#111] border border-[#1e1e1e] focus-within:border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-foreground transition-colors cursor-text',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/30',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none',
                    '[&_.ProseMirror]:outline-none',
                    '[&_.ProseMirror_code]:bg-[#1a1a1a] [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:text-xs [&_.ProseMirror_code]:font-mono',
                    '[&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline',
                    '[&_.mention]:bg-primary/10 [&_.mention]:text-primary [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:text-xs',
                )}
            />

            <div className="flex justify-end mt-2">
                <button
                    type="button"
                    disabled={isEmpty || isPending}
                    onClick={submit}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-xs h-7 px-3 rounded-md transition-colors font-medium"
                >
                    {isPending ? '…' : 'Comment'}
                </button>
            </div>
        </div>
    )
}

function MiniToolbarBtn({
    active,
    onClick,
    title,
    children,
}: {
    active: boolean
    onClick: () => void
    title: string
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onClick() }}
            title={title}
            className={cn(
                'p-1 rounded text-xs transition-colors',
                active
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-[#1a1a1a]',
            )}
        >
            {children}
        </button>
    )
}
