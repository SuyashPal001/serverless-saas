'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { StarterKit } from '@tiptap/starter-kit'
import { Underline } from '@tiptap/extension-underline'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Link } from '@tiptap/extension-link'
import { Heading } from '@tiptap/extension-heading'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Mention } from '@tiptap/extension-mention'
import { createLowlight, common } from 'lowlight'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
    Bold, Italic, Underline as UnderlineIcon, Strikethrough,
    Code, Heading1, Heading2, Heading3,
    List, ListOrdered, CheckSquare, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useMentionSuggestions } from '@/hooks/use-mention-suggestions'
import { createMentionSuggestion } from './mention-suggestion'

const lowlight = createLowlight(common)

// Convert legacy plain-text descriptions to HTML paragraphs
function toHtml(content: string | null | undefined): string {
    if (!content) return ''
    const trimmed = content.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('<')) return trimmed
    // Plain text — split on newlines into paragraphs
    return trimmed
        .split('\n')
        .map(line => line.trim() ? `<p>${line}</p>` : '<p></p>')
        .join('')
}

interface DescriptionEditorProps {
    taskId: string
    initialContent: string | null | undefined
    onSave?: () => void
}

export function DescriptionEditor({ taskId, initialContent, onSave }: DescriptionEditorProps) {
    const params = useParams()
    const queryClient = useQueryClient()
    const isEditingRef = useRef(false)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const allItems = useMentionSuggestions()
    const allItemsRef = useRef(allItems)

    useEffect(() => { allItemsRef.current = allItems }, [allItems])

    const patchDescription = useMutation({
        mutationFn: (descriptionHtml: string) =>
            api.patch(`/api/v1/tasks/${taskId}`, { descriptionHtml }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            onSave?.()
        },
    })

    const triggerSave = useCallback((html: string) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            patchDescription.mutate(html)
        }, 1500)
    }, [patchDescription])

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                // Disable built-in heading so we can configure it separately
                heading: false,
                // Disable built-in codeBlock since we use lowlight variant
                codeBlock: false,
            }),
            Underline,
            Heading.configure({ levels: [1, 2, 3] }),
            CodeBlockLowlight.configure({ lowlight }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Placeholder.configure({ placeholder: 'Add a description…' }),
            Link.configure({ openOnClick: false }),
            Mention.configure({
                HTMLAttributes: { class: 'mention' },
                suggestion: createMentionSuggestion(() => allItemsRef.current),
            }),
        ],
        content: toHtml(initialContent),
        editable: false,
        editorProps: {
            attributes: {
                class: 'outline-none min-h-[2rem]',
            },
        },
        onUpdate: ({ editor }) => {
            if (!isEditingRef.current) return
            triggerSave(editor.getHTML())
        },
    })

    // Re-initialise content when task changes (navigating between tasks)
    const taskIdRef = useRef(taskId)
    useEffect(() => {
        if (!editor || taskId === taskIdRef.current) return
        taskIdRef.current = taskId
        editor.commands.setContent(toHtml(initialContent), { emitUpdate: false })
        editor.setEditable(false)
        isEditingRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskId])

    // Update content when initialContent changes (after save invalidation)
    const lastSavedHtmlRef = useRef(initialContent)
    useEffect(() => {
        if (!editor || !initialContent) return
        if (initialContent === lastSavedHtmlRef.current) return
        lastSavedHtmlRef.current = initialContent
        if (!isEditingRef.current) {
            editor.commands.setContent(toHtml(initialContent), { emitUpdate: false })
        }
    }, [editor, initialContent])

    const enterEdit = useCallback(() => {
        if (!editor || isEditingRef.current) return
        editor.setEditable(true)
        isEditingRef.current = true
        editor.commands.focus()
    }, [editor])

    const exitEdit = useCallback(() => {
        if (!editor || !isEditingRef.current) return
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }
        editor.setEditable(false)
        isEditingRef.current = false
    }, [editor])

    // Escape key exits edit mode without saving
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isEditingRef.current) exitEdit()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [exitEdit])

    // Cleanup timer on unmount
    useEffect(() => () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }, [])

    if (!editor) return null

    return (
        <div
            className="group relative"
            onClick={enterEdit}
        >
            {editor && (
                <BubbleMenu
                    editor={editor}
                    options={{ placement: 'top-start' }}
                    shouldShow={({ editor: ed }) => ed.isEditable && !ed.state.selection.empty}
                >
                    <div className="flex items-center gap-0.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-1 shadow-xl">
                        <ToolbarBtn
                            active={editor.isActive('bold')}
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            title="Bold"
                        >
                            <Bold className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('italic')}
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            title="Italic"
                        >
                            <Italic className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('underline')}
                            onClick={() => editor.chain().focus().toggleUnderline().run()}
                            title="Underline"
                        >
                            <UnderlineIcon className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('strike')}
                            onClick={() => editor.chain().focus().toggleStrike().run()}
                            title="Strikethrough"
                        >
                            <Strikethrough className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('code')}
                            onClick={() => editor.chain().focus().toggleCode().run()}
                            title="Inline code"
                        >
                            <Code className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <div className="w-px h-4 bg-[#2a2a2a] mx-0.5" />
                        <ToolbarBtn
                            active={editor.isActive('heading', { level: 1 })}
                            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                            title="H1"
                        >
                            <Heading1 className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('heading', { level: 2 })}
                            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                            title="H2"
                        >
                            <Heading2 className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('heading', { level: 3 })}
                            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                            title="H3"
                        >
                            <Heading3 className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <div className="w-px h-4 bg-[#2a2a2a] mx-0.5" />
                        <ToolbarBtn
                            active={editor.isActive('bulletList')}
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                            title="Bullet list"
                        >
                            <List className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('orderedList')}
                            onClick={() => editor.chain().focus().toggleOrderedList().run()}
                            title="Numbered list"
                        >
                            <ListOrdered className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <ToolbarBtn
                            active={editor.isActive('taskList')}
                            onClick={() => editor.chain().focus().toggleTaskList().run()}
                            title="Task list"
                        >
                            <CheckSquare className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                        <div className="w-px h-4 bg-[#2a2a2a] mx-0.5" />
                        <ToolbarBtn
                            active={editor.isActive('link')}
                            onClick={() => {
                                if (editor.isActive('link')) {
                                    editor.chain().focus().unsetLink().run()
                                } else {
                                    const url = window.prompt('URL')
                                    if (url) editor.chain().focus().setLink({ href: url }).run()
                                }
                            }}
                            title="Link"
                        >
                            <Link2 className="w-3.5 h-3.5" />
                        </ToolbarBtn>
                    </div>
                </BubbleMenu>
            )}

            <EditorContent
                editor={editor}
                className={cn(
                    'text-sm text-foreground/80 leading-relaxed rounded-lg transition-all',
                    editor.isEditable
                        ? 'bg-[#111] border border-primary/30 px-3 py-2 cursor-text'
                        : 'cursor-pointer hover:bg-[#111]/50 px-1 py-0.5 -mx-1',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/30',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0',
                    '[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none',
                    '[&_.ProseMirror]:outline-none',
                    '[&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:mt-3 [&_.ProseMirror_h1]:mb-1',
                    '[&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:mt-2 [&_.ProseMirror_h2]:mb-1',
                    '[&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-medium [&_.ProseMirror_h3]:mt-2 [&_.ProseMirror_h3]:mb-0.5',
                    '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:my-1',
                    '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:my-1',
                    '[&_.ProseMirror_li]:my-0.5',
                    '[&_.ProseMirror_ul[data-type=taskList]]:list-none [&_.ProseMirror_ul[data-type=taskList]]:pl-0',
                    '[&_.ProseMirror_li[data-type=taskItem]]:flex [&_.ProseMirror_li[data-type=taskItem]]:items-start [&_.ProseMirror_li[data-type=taskItem]]:gap-2',
                    '[&_.ProseMirror_li[data-type=taskItem]_label]:mt-0.5',
                    '[&_.ProseMirror_code]:bg-[#1a1a1a] [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:text-xs [&_.ProseMirror_code]:font-mono',
                    '[&_.ProseMirror_pre]:bg-[#0d0d0d] [&_.ProseMirror_pre]:border [&_.ProseMirror_pre]:border-[#1e1e1e] [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_pre]:my-2 [&_.ProseMirror_pre]:overflow-x-auto',
                    '[&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0 [&_.ProseMirror_pre_code]:text-xs',
                    '[&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-primary/30 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground/70 [&_.ProseMirror_blockquote]:my-2',
                    '[&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline',
                    '[&_.mention]:bg-primary/10 [&_.mention]:text-primary [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:text-xs',
                )}
            />

            {editor.isEditable && (
                <p className="text-[10px] text-muted-foreground/30 mt-1 select-none">
                    Auto-saves · Esc to cancel
                </p>
            )}
        </div>
    )
}

function ToolbarBtn({
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
                'p-1.5 rounded transition-colors',
                active
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:bg-[#2a2a2a] hover:text-foreground',
            )}
        >
            {children}
        </button>
    )
}
