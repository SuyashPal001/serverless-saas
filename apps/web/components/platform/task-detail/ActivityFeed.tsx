'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
    Bot, User, Settings, MessageSquare, Check, CheckCircle, XCircle, RefreshCw, Loader2,
    ChevronDown, ChevronRight, Sparkles, ExternalLink,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '../RichTextEditor'
import type { TaskComment, TaskEvent } from '@/types/task'
import { parseAgentOutput, renderInlineMarkdown, extractDomain } from './outputHelpers'

function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString)
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d`
    return date.toLocaleDateString('en-us', { month: 'short', day: 'numeric' })
}

function cleanAgentComment(content: string): string {
    return content
        .split('\n')
        .map(line => {
            // Strip ```json ... ``` fenced blocks within a line
            let cleaned = line.replace(/```json[\s\S]*?```/g, '').trim()
            // Strip inline JSON objects { ... } from end of line
            // Keep the part before the first { if that part is
            // non-empty human text
            const jsonStart = cleaned.indexOf('{')
            if (jsonStart > 0) {
                const before = cleaned.slice(0, jsonStart).trim()
                // Only strip if what's before looks like step text
                // (ends with : or is a numbered item)
                if (before.match(/:\s*$/) || before.match(/^\d+\./)) {
                    cleaned = before.replace(/:\s*$/, '').trim()
                }
            }
            return cleaned
        })
        .filter(line => line.length > 0)
        .join('\n')
}

interface ActivityFeedProps {
    taskId: string
    events: TaskEvent[]
}

function StructuredOutput({
    parsed,
    preText,
    thinkingOpen,
    onToggleThinking,
}: {
    parsed: NonNullable<ReturnType<typeof parseAgentOutput>>
    preText?: string
    thinkingOpen: boolean
    onToggleThinking: () => void
}) {
    const hasThinking = !!(parsed.reasoning || parsed.toolRationale)
    return (
        <div className="space-y-2.5">
            {preText && (
                <p className="text-sm text-foreground/85 leading-relaxed">{preText}</p>
            )}
            {hasThinking && (
                <button
                    onClick={onToggleThinking}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors group"
                >
                    {thinkingOpen
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />}
                    <Sparkles className="w-3 h-3" />
                    <span>Thinking</span>
                </button>
            )}
            {hasThinking && thinkingOpen && (
                <div className="text-[12px] text-muted-foreground/50 italic leading-relaxed border-l border-primary/20 pl-3">
                    {parsed.reasoning || parsed.toolRationale}
                </div>
            )}
            {parsed.summary && (
                <p className="text-sm text-foreground/85 leading-relaxed">
                    {renderInlineMarkdown(parsed.summary)}
                </p>
            )}
            {parsed.results && parsed.results.length > 0 && (
                <div className="mt-1 space-y-1.5">
                    {parsed.results.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 py-1.5 px-2 rounded bg-[#0f0f0f] border border-[#1e1e1e]">
                            <span className="text-[11px] text-muted-foreground/40 mt-0.5 w-4 shrink-0 text-right">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-foreground/80 leading-snug">{r.title}</span>
                                {r.company && (
                                    <span className="ml-2 text-[11px] text-muted-foreground/50">{r.company}</span>
                                )}
                                {r.description && (
                                    <p className="text-[11px] text-muted-foreground/50 mt-0.5 line-clamp-2 leading-snug">{r.description}</p>
                                )}
                            </div>
                            {r.url && (
                                <a
                                    href={r.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-primary/50 hover:text-primary transition-colors"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {!preText && !parsed.summary && (!parsed.results || parsed.results.length === 0) && (
                <p className="text-sm text-muted-foreground/60 italic">Agent completed the task.</p>
            )}
        </div>
    )
}

function AgentCommentBody({ content }: { content: string }) {
    const [thinkingOpen, setThinkingOpen] = useState(false)

    // Case 1: entire content is JSON (or fenced JSON)
    const parsed = parseAgentOutput(content)
    if (parsed) {
        return (
            <StructuredOutput
                parsed={parsed}
                thinkingOpen={thinkingOpen}
                onToggleThinking={() => setThinkingOpen(v => !v)}
            />
        )
    }

    // Case 2: text prefix + embedded ```json ... ``` block
    // e.g. "✅ All steps completed. Here's what I did:\n```json\n{...}\n```"
    const fencedMatch = content.match(/^([\s\S]*?)```(?:json)?\s*([\s\S]+?)```([\s\S]*)$/)
    if (fencedMatch) {
        const preText = fencedMatch[1].trim()
        const parsedFromFence = parseAgentOutput(fencedMatch[2].trim())
        if (parsedFromFence) {
            return (
                <StructuredOutput
                    parsed={parsedFromFence}
                    preText={preText || undefined}
                    thinkingOpen={thinkingOpen}
                    onToggleThinking={() => setThinkingOpen(v => !v)}
                />
            )
        }
    }

    // Case 3: plain text / markdown fallback
    return (
        <div className="prose prose-invert prose-sm max-w-none prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cleanAgentComment(content)}
            </ReactMarkdown>
        </div>
    )
}

export function ActivityFeed({ taskId, events }: ActivityFeedProps) {
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<'All' | 'Activity' | 'Events'>('All')
    const [commentText, setCommentText] = useState('')

    const { data: commentsData } = useQuery<{ data: TaskComment[] }>({
        queryKey: ['task-comments', taskId],
        queryFn: () => api.get<{ data: TaskComment[] }>(`/api/v1/tasks/${taskId}/comments`),
    })
    const comments = commentsData?.data ?? []

    const addComment = useMutation({
        mutationFn: (content: string) => api.post(`/api/v1/tasks/${taskId}/comments`, { content }),
        onMutate: async (content) => {
            await queryClient.cancelQueries({ queryKey: ['task-comments', taskId] })
            const prev = queryClient.getQueryData<{ data: TaskComment[] }>(['task-comments', taskId])
            const optimistic: TaskComment = {
                id: `optimistic-${Date.now()}`,
                taskId,
                authorId: 'me',
                authorType: 'member',
                authorName: 'You',
                content,
                parentId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            queryClient.setQueryData<{ data: TaskComment[] }>(['task-comments', taskId], old => ({
                data: [...(old?.data ?? []), optimistic],
            }))
            return { prev }
        },
        onError: (err: any, _, context) => {
            if (context?.prev) queryClient.setQueryData(['task-comments', taskId], context.prev)
            toast.error(err.message || 'Failed to post comment')
        },
        onSuccess: () => {
            setCommentText('')
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['task-comments', taskId] })
        },
    })

    return (
        <div className="mt-8 border-t border-[#1e1e1e] pt-4">
            <div className="flex items-center gap-6 mb-6">
                <button onClick={() => setActiveTab('All')} className={cn("text-sm pb-2 transition-colors", activeTab === 'All' ? 'text-foreground border-b-2 border-white font-medium' : 'text-muted-foreground hover:text-foreground/80')}>All</button>
                <button onClick={() => setActiveTab('Activity')} className={cn("text-sm pb-2 transition-colors", activeTab === 'Activity' ? 'text-foreground border-b-2 border-white font-medium' : 'text-muted-foreground hover:text-foreground/80')}>Activity</button>
                <button onClick={() => setActiveTab('Events')} className={cn("text-sm pb-2 transition-colors", activeTab === 'Events' ? 'text-foreground border-b-2 border-white font-medium' : 'text-muted-foreground hover:text-foreground/80')}>Events</button>
            </div>
            <div className="space-y-6 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-[#1e1e1e] ml-1">
                {events.filter(e => {
                    if (activeTab === 'Activity') return e.actorType !== 'system'
                    if (activeTab === 'Events') return e.actorType === 'system'
                    return true
                }).map(event => {
                    const ActorIcon = event.actorType === 'agent' ? Bot : event.actorType === 'human' ? User : Settings
                    const actorName = event.actorType === 'human' ? 'You' : event.actorType === 'agent' ? 'Agent' : 'System'

                    let description = event.eventType.replace(/_/g, ' ')
                    let Icon = ActorIcon

                    if (event.eventType === 'status_changed') {
                        Icon = RefreshCw
                        description = `Status changed to ${event.payload?.to || 'unknown'}`
                    } else if (event.eventType === 'comment_added') {
                        Icon = MessageSquare
                        description = 'Added a comment'
                    } else if (event.eventType === 'plan_approved') {
                        Icon = CheckCircle
                        description = 'Approved the execution plan'
                    } else if (event.eventType === 'plan_rejected') {
                        Icon = XCircle
                        description = 'Requested changes to the plan'
                    } else if (event.eventType === 'clarification_requested') {
                        Icon = MessageSquare
                        description = 'Requested clarification'
                    } else if (event.eventType === 'clarification_answered') {
                        Icon = Check
                        description = 'Provided clarification'
                    }

                    return (
                        <div key={event.id} className="relative pl-9">
                            <div className="absolute left-1 top-0.5 w-4 h-4 rounded-full bg-[#0f0f0f] border border-[#1e1e1e] flex items-center justify-center z-10">
                                <Icon className={cn("w-2.5 h-2.5", event.actorType === 'agent' ? 'text-primary' : 'text-muted-foreground')} />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[13px] text-foreground/90 font-medium">{actorName}</span>
                                    <span className="text-[13px] text-muted-foreground/60">{description}</span>
                                </div>
                                <span className="text-[11px] text-muted-foreground/30">{formatRelativeTime(event.createdAt)} ago</span>

                                {event.eventType === 'comment' && event.payload?.comment && (
                                    <div className="mt-2 bg-[#161616] border border-[#1e1e1e] p-3 rounded-lg text-sm text-foreground/80 leading-relaxed">
                                        <RichTextEditor value={event.payload.comment} isReadOnly />
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Comments section */}
            <div className="mt-8 border-t border-[#1e1e1e] pt-6">
                <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    Comments
                    {comments.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60 bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#2a2a2a]">{comments.length}</span>
                    )}
                </h3>

                {comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground/40 italic py-4">No comments yet. Be the first to leave a note.</p>
                ) : (
                    <div className="space-y-4 mb-6">
                        {comments.map(c => (
                            <div
                                key={c.id}
                                className={cn(
                                    'flex items-start gap-3',
                                    c.authorType === 'agent' && 'pl-3 border-l-2 border-primary/20',
                                )}
                            >
                                {c.authorType === 'agent' ? (
                                    <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                                        <Bot className="w-3.5 h-3.5 text-primary" />
                                    </div>
                                ) : (
                                    <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-foreground">
                                        {(c.authorName ?? 'U').charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium text-foreground">{c.authorName ?? 'Unknown'}</span>
                                        <span className="text-[10px] text-muted-foreground/50">{formatRelativeTime(c.createdAt)} ago</span>
                                    </div>
                                    <div className={cn(
                                        'text-sm text-foreground/80 leading-relaxed rounded-lg px-3 py-2',
                                        c.authorType === 'agent'
                                            ? 'bg-primary/5 border border-primary/10'
                                            : 'bg-[#161616] border border-[#1e1e1e]',
                                    )}>
                                        {c.authorType === 'agent' ? (
                                            <AgentCommentBody content={c.content} />
                                        ) : (
                                            c.content
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex items-start gap-3 pt-4 border-t border-[#1e1e1e]">
                    <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-foreground mt-0.5">
                        U
                    </div>
                    <div className="flex-1">
                        <textarea
                            value={commentText}
                            onChange={e => setCommentText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commentText.trim()) {
                                    addComment.mutate(commentText.trim())
                                }
                            }}
                            placeholder="Add a comment… (⌘+Enter to send)"
                            rows={2}
                            className="w-full bg-[#111] border border-[#1e1e1e] focus:border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none resize-none transition-colors"
                        />
                        <div className="flex justify-end mt-2">
                            <Button
                                size="sm"
                                disabled={!commentText.trim() || addComment.isPending}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-7 px-3"
                                onClick={() => addComment.mutate(commentText.trim())}
                            >
                                {addComment.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Comment'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
