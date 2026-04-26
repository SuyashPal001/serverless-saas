'use client'

import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTaskStream } from '@/hooks/useTaskStream'
import { toast } from 'sonner'
import {
    ArrowUp, ArrowDown, ChevronRight, CheckCircle, Play, XCircle, Target, LayoutList,
    Bot, User, Settings, ChevronDown, ChevronUp, Wrench, Loader2, AlertCircle,
    CheckSquare, MoreHorizontal, Trash2, Clock, Calendar, CalendarClock, Link2, Paperclip, FileText, Check, AlertTriangle,
    Bold, Italic, List, Type, ListOrdered, Code, Quote, Plus, X, ThumbsUp, ThumbsDown, RefreshCw, Zap, MessageSquare, Pencil, Sparkles
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from './RichTextEditor'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'


// --- TYPES ---
type AcceptanceCriterion = { text: string; checked: boolean }
type Attachment = { fileId: string; name: string; size: number; type: string }

type Task = {
    id: string
    agentId: string | null
    assigneeId: string | null
    title: string
    description?: string | null
    referenceText?: string | null
    status: 'backlog' | 'todo' | 'planning' | 'awaiting_approval' | 'ready' | 'in_progress' | 'review' | 'blocked' | 'done' | 'cancelled'
    priority: 'low' | 'medium' | 'high' | 'urgent'
    estimatedHours?: string | number | null
    confidenceScore?: string | number | null
    acceptanceCriteria?: AcceptanceCriterion[] | null
    planApprovedAt?: string | null
    blockedReason?: string | null
    createdAt: string
    updatedAt: string
    dueDate?: string | null
    startedAt?: string | null
    upvotes: number
    downvotes: number
    links: string[]
    attachmentFileIds: string[]
}

type AgentsResponse = { data: { id: string; name: string; status: string }[] }
type MembersResponse = { members: { userId: string; userName: string | null; userEmail: string; roleName: string }[] }

type Assignee = { type: 'agent'; id: string; name: string } | { type: 'member'; id: string; name: string }

type Step = {
    id: string
    stepNumber: number
    title: string
    description?: string | null
    toolName?: string | null
    reasoning?: string | null
    estimatedHours?: string | number | null
    confidenceScore?: string | number | null
    status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
    humanFeedback?: string | null
    agentOutput?: string | null
    feedbackHistory?: { date: string; content: string }[] | null
}

type TaskEvent = {
    id: string
    actorType: 'agent' | 'human' | 'system'
    actorName?: string
    eventType: string
    payload?: Record<string, any>
    createdAt: string
}

type TaskComment = {
    id: string
    taskId: string
    authorId: string
    authorType: 'member' | 'agent'
    authorName: string
    content: string
    parentId: string | null
    createdAt: string
    updatedAt: string
}

type TaskDetailResponse = {
    data: {
        task: Task
        steps: Step[]
        events: TaskEvent[]
        agent?: { name: string }
        assignee?: { name: string }
    }
}

// --- CONSTANTS ---

const STATUS_CONFIG = {
    backlog:          { label: 'Backlog',           color: '#6B7280', bg: 'bg-gray-500/10',    text: 'text-gray-400' },
    todo:             { label: 'Todo',              color: '#3B82F6', bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    planning:         { label: 'Planning',          color: '#F59E0B', bg: 'bg-amber-500/10',   text: 'text-amber-400' },
    awaiting_approval:{ label: 'Awaiting Approval', color: '#8B5CF6', bg: 'bg-purple-500/10',  text: 'text-purple-400' },
    in_progress:      { label: 'In Progress',       color: '#F59E0B', bg: 'bg-amber-500/10',   text: 'text-amber-400' },
    review:           { label: 'Review',            color: '#8B5CF6', bg: 'bg-purple-500/10',  text: 'text-purple-400' },
    blocked:          { label: 'Blocked',           color: '#EF4444', bg: 'bg-red-500/10',     text: 'text-red-400' },
    done:             { label: 'Done',              color: '#10B981', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    ready:            { label: 'Ready',             color: '#3B82F6', bg: 'bg-primary/10',     text: 'text-primary' },
    cancelled:        { label: 'Cancelled',         color: '#6B7280', bg: 'bg-gray-500/10',    text: 'text-gray-400' },
} as const

const PRIORITY_CONFIG = {
    low:    { label: 'Low',    color: '#6B7280', text: 'text-gray-400' },
    medium: { label: 'Medium', color: '#3B82F6', text: 'text-blue-400' },
    high:   { label: 'High',   color: '#F59E0B', text: 'text-amber-400' },
    urgent: { label: 'Urgent', color: '#EF4444', text: 'text-red-400' },
} as const

// --- HELPER FUNCTIONS ---
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

const StatusIcon = ({ status, className }: { status: string; className?: string }) => {
  const configs = {
    backlog: <circle cx="12" cy="12" r="9" stroke="#6B7280" strokeWidth="1.5" strokeDasharray="4 2" fill="none"/>,
    todo: <circle cx="12" cy="12" r="9" stroke="#3B82F6" strokeWidth="1.5" fill="none"/>,
    ready: <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>,
    in_progress: <>
      <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="1.5" fill="none"/>
      <circle cx="12" cy="12" r="4" fill="#F59E0B"/>
    </>,
    review: <circle cx="12" cy="12" r="9" stroke="#8B5CF6" strokeWidth="1.5" fill="none"/>,
    blocked: <circle cx="12" cy="12" r="9" stroke="#EF4444" strokeWidth="1.5" fill="none"/>,
    done: <>
      <circle cx="12" cy="12" r="9" fill="#10B981"/>
      <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>,
    cancelled: <circle cx="12" cy="12" r="9" stroke="#6B7280" strokeWidth="1.5" fill="none"/>,
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className}>
      {configs[status as keyof typeof configs] ?? configs.backlog}
    </svg>
  )
}

const PriorityIcon = ({ priority, className }: { priority: string; className?: string }) => {
  return (
    <div className={cn("w-2 h-2 rounded-full", className)} style={{ backgroundColor: PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG]?.color }} />
  )
}

// --- SUB-COMPONENTS ---
function StepReasoning({ reasoning }: { reasoning: string }) {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <div>
            <button
                className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Why this step?
            </button>
            {isOpen && (
                <div className="text-xs text-muted-foreground/80 mt-2 bg-[#0d0d0d] rounded-lg p-3 leading-relaxed">
                    {reasoning}
                </div>
            )}
        </div>
    )
}

function StepInsightsModal({ 
    open, 
    onOpenChange, 
    step 
}: { 
    open: boolean; 
    onOpenChange: (v: boolean) => void; 
    step: Step 
}) {
    if (!step) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-[#0f0f0f] border border-[#1e1e1e] shadow-2xl p-0 overflow-hidden">
                <DialogHeader className="p-6 border-b border-[#1e1e1e] bg-[#141414]">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                            {step.stepNumber}
                        </div>
                        <DialogTitle className="text-lg font-bold">{step.title}</DialogTitle>
                    </div>
                </DialogHeader>
                
                <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Why this step? */}
                    <section>
                        <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                             <Target className="w-3 h-3 text-primary" /> Reasoning & Strategic Context
                        </h4>
                        <div className="bg-[#161616] p-4 rounded-xl border border-[#1e1e1e] text-sm text-foreground/80 leading-relaxed italic">
                            "{step.reasoning || "No detailed reasoning provided for this specific step yet."}"
                        </div>
                    </section>

                    {/* Tool Insights */}
                    {step.toolName && (
                        <section>
                            <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Zap className="w-3 h-3 text-primary" /> Tool Selection
                            </h4>
                            <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/10 rounded-xl">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                    <Wrench className="w-4 h-4 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-mono text-primary font-medium">{step.toolName}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">This tool was chosen to maximize execution precision based on your specific requirements.</p>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Feedback History / Changelogs */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest flex items-center gap-2">
                                <Clock className="w-3 h-3 text-primary" /> Strategy Changelog
                            </h4>
                            {step.feedbackHistory && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                                    {step.feedbackHistory.length} revisions
                                </span>
                            )}
                        </div>
                        {step.feedbackHistory && step.feedbackHistory.length > 0 ? (
                            <div className="space-y-4 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-[#1e1e1e]">
                                {step.feedbackHistory.map((h, i) => (
                                    <div key={i} className="relative pl-7">
                                        <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-[#111] border border-[#1e1e1e] flex items-center justify-center">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mb-1">{h.date} (User Feedback)</div>
                                        <div className="bg-[#111] p-3 rounded-lg border border-[#1e1e1e] text-xs text-foreground/70 leading-relaxed">
                                            {h.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground/30 italic py-6 text-center bg-[#111] rounded-xl border border-dashed border-[#1e1e1e]">
                                No feedback history yet. This step is original.
                            </div>
                        )}
                    </section>
                </div>

                <DialogFooter className="p-4 bg-[#141414] border-t border-[#1e1e1e]">
                    <Button onClick={() => onOpenChange(false)} variant="ghost" className="text-xs h-8 text-muted-foreground hover:text-foreground">Close Insight</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function parseEmailEntries(text: string): Array<{ from: string; subject: string; date: string; snippet?: string }> | null {
    if (!text.includes('**From:**')) return null
    const blocks = text.split(/\n\s*\n|\n---\n/)
    const result: Array<{ from: string; subject: string; date: string; snippet?: string }> = []
    for (const block of blocks) {
        if (!block.includes('**From:**')) continue
        const from = block.match(/\*\*From:\*\*\s*(.+)/)?.[1]?.trim() ?? ''
        const subject = block.match(/\*\*Subject:\*\*\s*(.+)/)?.[1]?.trim() ?? ''
        const date = block.match(/\*\*Date:\*\*\s*(.+)/)?.[1]?.trim() ?? ''
        const snippet = block.match(/\*\*Snippet:\*\*\s*(.+)/)?.[1]?.trim()
        if (from || subject) result.push({ from, subject, date, snippet })
    }
    return result.length > 0 ? result : null
}

function AgentOutputRenderer({ content }: { content: string }) {
    const emails = parseEmailEntries(content)
    if (emails) {
        return (
            <div className="space-y-2">
                {emails.map((email, i) => (
                    <div key={i} className="rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2.5 text-xs">
                        <div className="flex flex-col gap-0.5">
                            <div className="flex gap-2"><span className="text-muted-foreground/60 w-14 flex-shrink-0">From</span><span className="text-foreground/80 truncate">{email.from}</span></div>
                            <div className="flex gap-2"><span className="text-muted-foreground/60 w-14 flex-shrink-0">Subject</span><span className="text-foreground font-medium truncate">{email.subject}</span></div>
                            {email.date && <div className="flex gap-2"><span className="text-muted-foreground/60 w-14 flex-shrink-0">Date</span><span className="text-muted-foreground/80">{email.date}</span></div>}
                            {email.snippet && <div className="mt-1 text-muted-foreground/50 italic leading-relaxed line-clamp-2">{email.snippet}</div>}
                        </div>
                    </div>
                ))}
            </div>
        )
    }
    return (
        <div className="prose prose-invert prose-xs max-w-none text-xs leading-relaxed
            [&_p]:text-foreground/80 [&_p]:my-1
            [&_ul]:my-1 [&_ul]:pl-4 [&_li]:text-foreground/80 [&_li]:my-0.5
            [&_ol]:my-1 [&_ol]:pl-4
            [&_strong]:text-foreground [&_strong]:font-semibold
            [&_code]:bg-[#1a1a1a] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-emerald-400 [&_code]:font-mono
            [&_pre]:bg-[#1a1a1a] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto
            [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-medium
            [&_blockquote]:border-l-2 [&_blockquote]:border-[#2a2a2a] [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground/70
            [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
            [&_hr]:border-[#2a2a2a]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    )
}

// --- Post-Action Receipt helpers ---

function extractFirstSentence(text: string): string {
    if (!text) return ''
    const clean = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s+/gm, '').trim()
    const match = clean.match(/^[^.!?\n]+[.!?]/)
    return match ? match[0].trim() : clean.split('\n')[0].trim()
}

function extractAssumptions(text: string): string | null {
    const keywords = ['interpreted', 'assumed', 'treated as', 'assuming', 'assumption', 'i inferred', 'i treated']
    const paragraphs = text.split(/\n\s*\n/)
    const matched = paragraphs.filter(p => keywords.some(kw => p.toLowerCase().includes(kw)))
    if (matched.length === 0) return null
    return matched[matched.length - 1].replace(/\*\*/g, '').replace(/\*/g, '').trim()
}

function getToolInfo(toolName: string): { icon: string; label: string } {
    if (/^GMAIL/.test(toolName)) return { icon: '📧', label: 'Gmail' }
    if (/^DRIVE/.test(toolName)) return { icon: '📁', label: 'Google Drive' }
    if (/^CALENDAR/.test(toolName)) return { icon: '📅', label: 'Google Calendar' }
    if (/^ZOHO/.test(toolName)) return { icon: '🏢', label: 'Zoho CRM' }
    if (toolName === 'WEB_SEARCH') return { icon: '🔍', label: 'Web' }
    return { icon: '⚡', label: toolName }
}

function ReceiptResults({ steps }: { steps: Step[] }) {
    const [showAll, setShowAll] = useState(false)
    const allOutput = steps.map(s => s.agentOutput!).join('\n\n')
    const emails = parseEmailEntries(allOutput)

    if (emails) {
        const LIMIT = 5
        const visible = showAll ? emails : emails.slice(0, LIMIT)
        const hiddenCount = emails.length - LIMIT
        return (
            <div>
                <div className="divide-y divide-[#1a1a1a]">
                    {visible.map((e, i) => (
                        <div key={i} className="flex items-start gap-3 py-2.5 text-xs">
                            <span className="flex-shrink-0 leading-none mt-0.5">📧</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <span className="text-foreground/80 truncate max-w-[180px]">{e.from}</span>
                                    <span className="text-muted-foreground/30">·</span>
                                    <span className="text-foreground font-medium truncate">{e.subject}</span>
                                    {e.date && (
                                        <>
                                            <span className="text-muted-foreground/30">·</span>
                                            <span className="text-muted-foreground/60 flex-shrink-0">{e.date}</span>
                                        </>
                                    )}
                                </div>
                                {e.snippet && <p className="text-muted-foreground/50 mt-0.5 line-clamp-1 italic">{e.snippet}</p>}
                            </div>
                        </div>
                    ))}
                </div>
                {!showAll && hiddenCount > 0 && (
                    <button onClick={() => setShowAll(true)} className="mt-2 text-xs text-primary hover:text-primary/80 transition-colors">
                        + {hiddenCount} more
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {steps.map(step => (
                <div key={step.id}>
                    <AgentOutputRenderer content={step.agentOutput!} />
                </div>
            ))}
        </div>
    )
}

function PostActionReceipt({ task, steps, onMarkDone, isMarkingDone }: {
    task: Task
    steps: Step[]
    onMarkDone: () => void
    isMarkingDone: boolean
}) {
    const [showRaw, setShowRaw] = useState(false)

    const stepsWithOutput = steps.filter(s => s.status === 'done' && s.agentOutput)
    const toolsTouched = [...new Set(steps.filter(s => s.toolName).map(s => s.toolName!))]
    const summary = extractFirstSentence(stepsWithOutput[0]?.agentOutput ?? '')
    const allOutputText = stepsWithOutput.map(s => s.agentOutput!).join('\n\n')
    const assumptions = extractAssumptions(allOutputText)
    const rawOutput = stepsWithOutput.map(s => `### ${s.title}\n\n${s.agentOutput}`).join('\n\n---\n\n')

    return (
        <div className="rounded-2xl border border-emerald-500/20 bg-[#080d08] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-emerald-500/15 bg-emerald-500/5 flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <h2 className="text-sm font-semibold text-emerald-400">
                    {task.status === 'done' ? 'Task Complete' : 'Ready for Review'}
                </h2>
            </div>

            <div className="px-5 py-5 space-y-5">
                {/* WHAT HAPPENED */}
                <section>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">What Happened</p>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                        {summary || 'Agent completed execution — see results below.'}
                    </p>
                </section>

                {/* WHAT I TOUCHED */}
                {toolsTouched.length > 0 && (
                    <section>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">What I Touched</p>
                        <div className="flex flex-col gap-1.5">
                            {toolsTouched.map(tool => {
                                const { icon, label } = getToolInfo(tool)
                                return (
                                    <div key={tool} className="flex items-center gap-2 text-xs text-foreground/70">
                                        <span>{icon}</span>
                                        <span className="font-medium">{label}</span>
                                        <span className="text-muted-foreground/35">— via {tool}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                )}

                {/* RESULTS */}
                <section>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">Results</p>
                    {stepsWithOutput.length === 0 ? (
                        <p className="text-sm text-muted-foreground/50 italic">No output recorded</p>
                    ) : (
                        <ReceiptResults steps={stepsWithOutput} />
                    )}
                </section>

                {/* ASSUMPTIONS MADE */}
                {assumptions && (
                    <section>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">Assumptions Made</p>
                        <p className="text-sm text-amber-400/70 leading-relaxed italic">{assumptions}</p>
                    </section>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#1a1a1a] bg-[#0d0d0d] flex items-center justify-between gap-3 flex-wrap">
                <button
                    onClick={() => setShowRaw(r => !r)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showRaw ? 'Hide raw' : 'View raw'}
                </button>
                {task.status === 'review' && (
                    <Button
                        size="sm"
                        className="h-7 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={onMarkDone}
                        disabled={isMarkingDone}
                    >
                        {isMarkingDone && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
                        Mark as Done →
                    </Button>
                )}
            </div>

            {/* Raw output panel */}
            {showRaw && (
                <div className="border-t border-[#1e1e1e]">
                    <pre className="p-5 text-xs text-muted-foreground/60 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                        {rawOutput || 'No output recorded'}
                    </pre>
                </div>
            )}
        </div>
    )
}

function StepCard({ step, index }: { step: Step; index: number }) {
    const [insightsOpen, setInsightsOpen] = useState(false)
    const score = step.confidenceScore != null ? Number(step.confidenceScore) : null
    const scoreColor = score === null ? '' : score >= 0.8 ? 'bg-emerald-500' : score >= 0.6 ? 'bg-amber-500' : 'bg-red-500'
    const isRunning = step.status === 'running'

    return (
        <div className={cn(
            "border rounded-xl p-4 mb-3 transition-all group",
            isRunning ? "bg-[#0d1117] border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]" : "bg-[#111] border-[#1e1e1e]"
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Step number indicator */}
                    <div className={cn(
                        "w-6 h-6 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5 border font-medium",
                        step.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' :
                        isRunning ? 'bg-primary/10 border-primary/40 text-primary' :
                        step.status === 'failed' ? 'bg-red-500/10 border-red-500/40 text-red-400' :
                        step.status === 'skipped' ? 'bg-[#1e1e1e] border-[#2a2a2a] text-muted-foreground/30' :
                        'bg-[#1e1e1e] border-[#2a2a2a] text-muted-foreground'
                    )}>
                        {step.status === 'done' ? <Check className="w-3 h-3" /> :
                         isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> :
                         step.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                         index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-medium leading-snug", step.status === 'skipped' ? 'line-through text-muted-foreground/40' : 'text-foreground')}>{step.title}</p>
                        {step.description && <p className="mt-1 text-xs text-muted-foreground/60 leading-relaxed">{step.description}</p>}
                        
                        {/* Tool & time badges */}
                        <div className="mt-3 flex items-center gap-3 flex-wrap">
                            {step.toolName && (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono text-primary/80 bg-primary/5 border border-primary/10">
                                    <Zap className="w-2.5 h-2.5" />
                                    {step.toolName}
                                </div>
                            )}
                            {step.estimatedHours != null && (
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
                                    <Clock className="w-2.5 h-2.5" />
                                    {step.estimatedHours}h
                                </div>
                            )}
                            {score !== null && (
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                                    <div className="w-12 h-0.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                                        <div className={cn('h-full rounded-full transition-all duration-500')} style={{ width: `${score * 100}%`, backgroundColor: scoreColor.split('-')[1] }} />
                                    </div>
                                    <span>{Math.round(score * 100)}%</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge variant="outline" className={cn(
                        'capitalize text-[10px] px-1.5 py-0 h-4 min-w-[50px] justify-center',
                        step.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        isRunning ? 'bg-primary/10 text-primary border-primary/20' :
                        step.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        step.status === 'skipped' ? 'bg-muted/10 text-muted-foreground/30 border-transparent line-through' :
                        'bg-muted/10 text-muted-foreground/50 border-transparent'
                    )}>
                        {isRunning ? 'running' : step.status}
                    </Badge>
                    
                    {/* Insights Trigger moved to top right menu */}
                    <button 
                        onClick={() => setInsightsOpen(true)}
                        className="text-[10px] font-medium text-muted-foreground/40 hover:text-primary transition-colors flex items-center gap-1"
                    >
                        <MessageSquare className="w-2.5 h-2.5" />
                        Why this?
                    </button>
                </div>
            </div>

            {/* Human feedback / agent output (Inline) */}
            {(step.humanFeedback || step.agentOutput) && (
                <div className="mt-3 ml-9 space-y-2">
                    {step.humanFeedback && (
                        <div className="p-2 bg-amber-500/5 border border-amber-500/10 rounded-lg text-xs text-amber-300/60 leading-relaxed italic">
                            <span className="font-bold text-amber-500/50 mr-1 not-italic tracking-tighter uppercase text-[9px]">Feedback:</span> {step.humanFeedback}
                        </div>
                    )}
                    {step.agentOutput && (
                        <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                            <span className="block font-bold text-emerald-500/50 tracking-tighter uppercase text-[9px] mb-1.5">Result</span>
                            <AgentOutputRenderer content={step.agentOutput} />
                        </div>
                    )}
                </div>
            )}

            <StepInsightsModal open={insightsOpen} onOpenChange={setInsightsOpen} step={step} />
        </div>
    )
}

// ── Planning skeleton ─────────────────────────────────────────────────────────

function PlanningStepSkeleton() {
    return (
        <div className="border rounded-xl p-4 mb-3 bg-[#111] border-[#1e1e1e] animate-pulse">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Step number circle */}
                    <div className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5 bg-[#1e1e1e]" />
                    <div className="flex-1 min-w-0">
                        {/* Title bar ~60% */}
                        <div className="h-3.5 bg-[#1e1e1e] rounded w-3/5" />
                        {/* Description bar ~85% */}
                        <div className="h-3 bg-[#1e1e1e] rounded w-[85%] mt-2" />
                        {/* Tool badge bar ~30% */}
                        <div className="h-4 bg-[#1e1e1e] rounded-md w-[30%] mt-3" />
                    </div>
                </div>
                {/* Status badge placeholder */}
                <div className="h-4 w-12 bg-[#1e1e1e] rounded flex-shrink-0" />
            </div>
        </div>
    )
}

function PlanningSkeletonCards() {
    const [visibleCount, setVisibleCount] = useState(1)

    useEffect(() => {
        const t1 = setTimeout(() => setVisibleCount(2), 2500)
        const t2 = setTimeout(() => setVisibleCount(3), 5000)
        return () => {
            clearTimeout(t1)
            clearTimeout(t2)
        }
    }, [])

    return (
        <>
            {Array.from({ length: visibleCount }).map((_, i) => (
                <PlanningStepSkeleton key={i} />
            ))}
        </>
    )
}

function TaskStatusBanner({ task, needsClarification, onMarkDone, isMarkingDone }: { task: Task; needsClarification: boolean; onMarkDone?: () => void; isMarkingDone?: boolean }) {
    const status = task.status as string

    let content: React.ReactNode = null

    if (status === 'in_progress') {
        content = (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />
                <p className="text-sm text-primary/90 font-medium">Agent is working...</p>
            </div>
        )
    } else if (status === 'awaiting_approval') {
        content = (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <CheckCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <p className="text-sm text-amber-400/90 font-medium">Plan ready — review and approve to start execution</p>
            </div>
        )
    } else if (needsClarification) {
        content = (
            <div className="flex items-start gap-3 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <MessageSquare className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="text-sm text-amber-400/90 font-medium">Agent needs clarification</p>
                    {task.blockedReason && <p className="text-xs text-amber-400/60 mt-0.5">{task.blockedReason}</p>}
                </div>
            </div>
        )
    } else if (status === 'review') {
        content = (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <div className="flex items-center gap-3">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <p className="text-sm text-emerald-400/90 font-medium">Ready for your review</p>
                </div>
                {onMarkDone && (
                    <Button
                        size="sm"
                        className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={onMarkDone}
                        disabled={isMarkingDone}
                    >
                        {isMarkingDone ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Mark as Done'}
                    </Button>
                )}
            </div>
        )
    } else if (status === 'done') {
        content = (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <p className="text-sm text-emerald-400/90 font-medium">Complete</p>
            </div>
        )
    }

    if (!content) return null

    return (
        <div className="px-8 pt-4 pb-1 flex-shrink-0">
            {content}
        </div>
    )
}

// Agent activity simulation — shows what the agent is currently working on
function AgentActivityStream({ status, steps }: { status: string; steps: Step[] }) {
    const runningStep = steps.find(s => s.status === 'running')
    const pendingSteps = steps.filter(s => s.status === 'pending')
    const isPlanning = status === 'planning'
    const isReady = status === 'ready'
    const isWorking = status === 'in_progress'

    if (!isWorking && !isPlanning) return null

    return (
        <div className="mb-6 p-3 rounded-xl border border-[#1e1e1e] bg-[#0d0d0d] flex items-start gap-3">
            <div className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-3 h-3 text-primary animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
                {isWorking && runningStep ? (
                    <>
                        <p className="text-xs font-medium text-foreground">Agent is working on Step {runningStep.stepNumber}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{runningStep.title}</p>
                    </>
                ) : isWorking ? (
                    <>
                        <p className="text-xs font-medium text-foreground">Agent is starting execution</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Initializing environment...</p>
                    </>
                ) : (
                    <>
                        <p className="text-xs font-medium text-foreground">Agent is planning your task</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Identifying optimal strategy...</p>
                    </>
                )}
            </div>
        </div>
    )
}

// Editable acceptance criteria
function AcceptanceCriteriaEditor({ criteria, onChange }: {
    criteria: AcceptanceCriterion[]
    onChange: (updated: AcceptanceCriterion[]) => void
}) {
    const [newItem, setNewItem] = useState('')

    const addItem = () => {
        if (!newItem.trim()) return
        onChange([...criteria, { text: newItem.trim(), checked: false }])
        setNewItem('')
    }

    const removeItem = (i: number) => onChange(criteria.filter((_, idx) => idx !== i))

    const toggleItem = (i: number) => onChange(
        criteria.map((c, idx) => idx === i ? { ...c, checked: !c.checked } : c)
    )

    const completedCount = criteria.filter(c => c.checked).length
    const totalCount = criteria.length
    const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

    return (
        <div className="mb-8 mt-2">
            <div className="flex items-center justify-between mb-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-primary" />
                        <h2 className="text-sm font-semibold text-foreground tracking-tight">Definition of Done</h2>
                        <span className="text-[10px] font-bold text-muted-foreground/40 uppercase ml-1 tracking-widest">Requirements</span>
                    </div>
                </div>
                {totalCount > 0 && (
                    <div className="flex flex-col items-end gap-1.5 min-w-[80px]">
                        <span className="text-[11px] font-medium text-foreground/70">{completedCount} / {totalCount} done</span>
                        <div className="w-24 h-1 bg-[#1a1a1a] rounded-full overflow-hidden border border-[#2a2a2a]/30">
                            <div 
                                className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_8px_rgba(var(--primary-rgb),0.4)]" 
                                style={{ width: `${progress}%` }} 
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-1.5 pl-0.5">
                {criteria.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 group py-1 border-b border-transparent hover:border-[#1a1a1a] transition-all">
                        <button
                            onClick={() => toggleItem(i)}
                            className={cn(
                                "w-4 h-4 rounded-[4px] border flex items-center justify-center flex-shrink-0 transition-all duration-200",
                                c.checked 
                                    ? 'bg-primary border-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.2)]' 
                                    : 'border-[#3a3a3a] bg-transparent hover:border-primary/50'
                            )}
                        >
                            {c.checked && <Check className="w-2.5 h-2.5 text-primary-foreground stroke-[3]" />}
                        </button>
                        <span className={cn(
                            "text-[13px] flex-1 leading-none py-1 transition-all",
                            c.checked ? 'text-muted-foreground/60 line-through' : 'text-foreground/90 font-medium'
                        )}>{c.text}</span>
                        <button
                            onClick={() => removeItem(i)}
                            className="opacity-0 group-hover:opacity-100 transition-all text-muted-foreground/30 hover:text-red-400 p-1 hover:bg-red-400/5 rounded"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Integrated 'Add new item' */}
            <div className="flex items-center gap-3 mt-3.5 group">
                <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground/30">
                    <Plus className="w-3 h-3" />
                </div>
                <div className="relative flex-1">
                    <input
                        value={newItem}
                        onChange={e => setNewItem(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addItem()}
                        placeholder="Add a target outcome or requirement..."
                        className="w-full text-[13px] bg-transparent text-foreground placeholder:text-muted-foreground/20 outline-none border-b border-[#1a1a1a] group-focus-within:border-primary/30 pb-1.5 transition-all"
                    />
                </div>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={addItem}
                    disabled={!newItem.trim()}
                    className="h-7 text-[11px] px-2 text-muted-foreground/50 hover:text-primary hover:bg-primary/5 disabled:opacity-0 transition-all"
                >
                    Add Requirement
                </Button>
            </div>
            {totalCount === 0 && (
                <p className="text-[11px] text-muted-foreground/30 italic mt-2 ml-7">No specific requirements defined yet. Add one to guide the agent.</p>
            )}
        </div>
    )
}

function FeedbackDialog({ open, onOpenChange, steps, onSubmitFeedback }: { open: boolean, onOpenChange: (v: boolean) => void, steps: Step[], onSubmitFeedback: (feedback: Record<string, string>) => void }) {
    const [feedback, setFeedback] = useState<Record<string, string>>({})
    
    const handleSubmit = () => {
        onSubmitFeedback(feedback)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg bg-[#0f0f0f] border border-[#1e1e1e]">
                <DialogHeader>
                    <DialogTitle>Request Changes</DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto space-y-4 p-1">
                    {steps.map(step => (
                        <div key={step.id} className="space-y-1.5">
                            <Label htmlFor={`feedback-${step.id}`} className="text-sm font-medium">
                                Step {step.stepNumber}: {step.title}
                            </Label>
                            <Textarea
                                id={`feedback-${step.id}`}
                                placeholder="Your feedback..."
                                value={feedback[step.id] ?? ''}
                                onChange={(e) => setFeedback(p => ({ ...p, [step.id]: e.target.value }))}
                                className="bg-[#1a1a1a] border-[#2a2a2a] rounded-lg text-sm p-2"
                            />
                        </div>
                    ))}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} className="bg-primary hover:bg-primary/90 text-primary-foreground">Send Feedback</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// Statuses at which task execution has ended — polling should stop
const STOP_POLLING_STATUSES = ['review', 'done', 'blocked', 'cancelled']

// --- MAIN COMPONENT ---
export function TaskDetailView() {
    const params = useParams()
    const router = useRouter()
    const queryClient = useQueryClient()
    const taskId = params.taskId as string
    const tenantSlug = params.tenant as string

    useTaskStream(taskId)

    const [activeTab, setActiveTab] = useState<'All' | 'Activity' | 'Events'>('All')
    const [feedbackOpen, setFeedbackOpen] = useState(false)
    const [clarificationAnswer, setClarificationAnswer] = useState('')

    // Inline edit states
    const [isEditingTitle, setIsEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState('')
    const [isEditingDescription, setIsEditingDescription] = useState(false)
    const [descriptionValue, setDescriptionValue] = useState('')
    const [commentText, setCommentText] = useState('')
    const [localCriteria, setLocalCriteria] = useState<AcceptanceCriterion[]>([])
    const [isEditingHours, setIsEditingHours] = useState(false)
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
    const [newLink, setNewLink] = useState('')
    const startDateRef = useRef<HTMLInputElement>(null)
    const dueDateRef = useRef<HTMLInputElement>(null)
    const attachFileInputRef = useRef<HTMLInputElement>(null)
    const newLinkInputRef = useRef<HTMLInputElement>(null)
    const referenceTextRef = useRef<HTMLTextAreaElement>(null)
    const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Edit mode
    const [isEditing, setIsEditing] = useState(false)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftDescription, setDraftDescription] = useState('')
    const [draftStatus, setDraftStatus] = useState<Task['status']>('backlog')
    const [draftPriority, setDraftPriority] = useState<Task['priority']>('medium')
    const [draftAssigneeKey, setDraftAssigneeKey] = useState('unassigned')
    const [draftStartedAt, setDraftStartedAt] = useState('')
    const [draftDueDate, setDraftDueDate] = useState('')
    const [draftEstimatedHours, setDraftEstimatedHours] = useState('')

    const { data: agentsData } = useQuery<AgentsResponse>({
        queryKey: ['agents'],
        queryFn: () => api.get<AgentsResponse>('/api/v1/agents'),
    })

    const { data: membersData } = useQuery<MembersResponse>({
        queryKey: ['members'],
        queryFn: () => api.get<MembersResponse>('/api/v1/members'),
    })

    const activeAgents = agentsData?.data?.filter(a => a.status === 'active') ?? []
    const members = membersData?.members ?? []

    const assigneeOptions: Assignee[] = [
        ...members.map(m => ({ type: 'member' as const, id: m.userId, name: m.userName || m.userEmail })),
        ...activeAgents.map(a => ({ type: 'agent' as const, id: a.id, name: a.name })),
    ]

    const { data, isLoading, isError, error } = useQuery<TaskDetailResponse>({
        queryKey: ['task', taskId],
        queryFn: () => api.get<TaskDetailResponse>(`/api/v1/tasks/${taskId}`),
        refetchInterval: 30000,
    })

    const { task, steps, events, agent, assignee } = data?.data ?? {}

    // Only fade-in when transitioning from planning → real steps.
    // All other cases (navigating to an existing task) show steps immediately.
    const enteredFromPlanning = useRef(false)
    const [stepsVisible, setStepsVisible] = useState(true)

    useEffect(() => {
        if (task?.status === 'planning') {
            enteredFromPlanning.current = true
            setStepsVisible(false)
        }
    }, [task?.status])

    useEffect(() => {
        if (enteredFromPlanning.current && steps && steps.length > 0) {
            setStepsVisible(true)
        }
    }, [steps?.length])

    const [selectedAssignee, setSelectedAssignee] = useState<Assignee | null>(null)

    // Sync local state when task data loads
    useEffect(() => {
        if (task) {
            setTitleValue(task.title)
            setDescriptionValue(task.description || '')
            setLocalCriteria(task.acceptanceCriteria ?? [])

            if (task.assigneeId) {
                const opt = assigneeOptions.find(o => o.type === 'member' && o.id === task.assigneeId)
                if (opt) setSelectedAssignee(opt)
                else if (assignee) setSelectedAssignee({ type: 'member', id: task.assigneeId, name: assignee.name })
            } else if (task.agentId) {
                const opt = assigneeOptions.find(o => o.type === 'agent' && o.id === task.agentId)
                if (opt) setSelectedAssignee(opt)
                else if (agent) setSelectedAssignee({ type: 'agent', id: task.agentId, name: agent.name })
            } else {
                setSelectedAssignee(null)
            }
        }
    }, [task?.id, task?.title, task?.description, task?.acceptanceCriteria, task?.assigneeId, task?.agentId, assignee?.name, agent?.name, assigneeOptions.length])

    const patchTask = useMutation({
        mutationFn: (updates: Partial<{
            title: string
            description: string | null
            status: string
            priority: string
            estimatedHours: number | null
            acceptanceCriteria: { text: string; checked: boolean }[]
            dueDate: string | null
            startedAt: string | null
            links: string[]
            attachmentFileIds: string[]
            assigneeId: string | null
            agentId: string | null
            referenceText: string | null
        }>) => {
            console.log('[patchTask]', updates, new Error().stack)
            return api.patch(`/api/v1/tasks/${taskId}`, updates)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        onError: (err: any) => toast.error(err.message || 'Failed to save change'),
    })

    // Log initial status on mount/load
    useEffect(() => {
        if (task?.id) {
            console.log('[TaskDetail mount] task.status:', task?.status)
        }
    }, [task?.id])

    // Fix 1: Auto-reload while in_progress. WebSocket (useTaskStream) is the fast path;
    // this 5-second interval is the fallback. When the WS fires task.status.changed the
    // status in the cache updates, this effect re-runs, clears the interval, and (if the
    // new status is terminal) triggers a full refetch to pull fresh step output.
    useEffect(() => {
        // Clear any existing interval whenever status changes
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
        }

        // If we just reached a terminal state (possibly via WS), do a full refetch so
        // steps and events are up to date (WS only patches the task.status field).
        if (task?.status && STOP_POLLING_STATUSES.includes(task.status)) {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            return
        }

        if (!task?.id || task.status !== 'in_progress') return

        pollingIntervalRef.current = setInterval(async () => {
            try {
                const fresh = await api.get<TaskDetailResponse>(`/api/v1/tasks/${taskId}`)
                const newStatus = fresh?.data?.task?.status
                queryClient.setQueryData(['task', taskId], fresh)
                if (newStatus && STOP_POLLING_STATUSES.includes(newStatus)) {
                    if (pollingIntervalRef.current) {
                        clearInterval(pollingIntervalRef.current)
                        pollingIntervalRef.current = null
                    }
                }
            } catch {
                // ignore transient fetch errors — will retry on next tick
            }
        }, 5000)

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current)
                pollingIntervalRef.current = null
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task?.status, task?.id, taskId])

    const voteMutation = useMutation({
        mutationFn: (type: 'up' | 'down') => api.post(`/api/v1/tasks/${taskId}/vote`, { type }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        onError: (err: any) => toast.error(err.message || 'Failed to vote'),
    })

    const handleAttachmentUpload = async (file: File) => {
        setIsUploadingAttachment(true)
        try {
            const { data } = await api.post<{ data: { fileId: string; uploadUrl: string } }>(
                '/api/v1/files/upload',
                { filename: file.name, contentType: file.type || 'application/octet-stream' }
            )
            await fetch(data.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
            })
            await api.post(`/api/v1/files/${data.fileId}/confirm`, { size: file.size })
            patchTask.mutate({
                attachmentFileIds: [...(task?.attachmentFileIds ?? []), data.fileId],
            })
            toast.success('File attached')
        } catch (err: any) {
            toast.error(err.message || 'Failed to upload attachment')
        } finally {
            setIsUploadingAttachment(false)
            if (attachFileInputRef.current) attachFileInputRef.current.value = ''
        }
    }

    const focusLinkInput = () => {
        document.getElementById('links-section')?.scrollIntoView({ behavior: 'smooth' })
        setTimeout(() => newLinkInputRef.current?.focus(), 300)
    }

    const focusReferenceInput = () => {
        document.getElementById('reference-section')?.scrollIntoView({ behavior: 'smooth' })
        setTimeout(() => referenceTextRef.current?.focus(), 300)
    }

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

    const { mutate: approvePlan } = useMutation({
        mutationFn: (payload: { approved: boolean; feedback?: Record<string, string> }) => {
            const stepFeedback = payload.feedback ? Object.entries(payload.feedback)
                .filter(([, text]) => text.trim())
                .map(([stepId, feedback]) => ({ stepId, feedback })) : undefined;
            return api.put(`/api/v1/tasks/${taskId}/plan/approve`, { approved: payload.approved, stepFeedback })
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            toast.success(variables.approved ? 'Plan approved' : 'Feedback sent, agent is replanning.')
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to send feedback'),
    })

    const { mutate: clarify, isPending: isClarifying } = useMutation({
        mutationFn: (answer: string) => api.post(`/api/v1/tasks/${taskId}/clarify`, { answer }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            toast.success('Answer sent — agent is planning')
            setClarificationAnswer('')
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to send answer'),
    })
    
    const enterEditMode = () => {
        if (!task) return
        setDraftTitle(task.title)
        setDraftDescription(task.description || '')
        setDraftStatus(task.status)
        setDraftPriority(task.priority)
        setDraftAssigneeKey(
            task.assigneeId ? `member:${task.assigneeId}`
            : task.agentId ? `agent:${task.agentId}`
            : 'unassigned'
        )
        setDraftStartedAt(task.startedAt ? new Date(task.startedAt).toISOString().split('T')[0] : '')
        setDraftDueDate(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '')
        setDraftEstimatedHours(task.estimatedHours != null ? String(task.estimatedHours) : '')
        setIsEditing(true)
    }

    const cancelEdit = () => setIsEditing(false)

    const saveEdits = () => {
        if (!task) return
        const updates: Record<string, any> = {}

        if (draftTitle.trim() && draftTitle.trim() !== task.title) updates.title = draftTitle.trim()
        if (draftDescription !== (task.description || '')) updates.description = draftDescription || null
        if (draftStatus !== task.status) updates.status = draftStatus
        if (draftPriority !== task.priority) updates.priority = draftPriority

        const origKey = selectedAssignee ? `${selectedAssignee.type}:${selectedAssignee.id}` : 'unassigned'
        if (draftAssigneeKey !== origKey) {
            if (draftAssigneeKey === 'unassigned') {
                updates.assigneeId = null; updates.agentId = null
            } else {
                const colonIdx = draftAssigneeKey.indexOf(':')
                const type = draftAssigneeKey.slice(0, colonIdx)
                const id = draftAssigneeKey.slice(colonIdx + 1)
                if (type === 'member') { updates.assigneeId = id; updates.agentId = null }
                else { updates.agentId = id; updates.assigneeId = null }
            }
        }

        const origStart = task.startedAt ? new Date(task.startedAt).toISOString().split('T')[0] : ''
        const origDue = task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
        if (draftStartedAt !== origStart)
            updates.startedAt = draftStartedAt ? new Date(draftStartedAt).toISOString() : null
        if (draftDueDate !== origDue)
            updates.dueDate = draftDueDate ? new Date(draftDueDate).toISOString() : null

        const origHours = task.estimatedHours != null ? String(task.estimatedHours) : ''
        if (draftEstimatedHours !== origHours) {
            const h = parseFloat(draftEstimatedHours)
            updates.estimatedHours = draftEstimatedHours && !isNaN(h) ? h : null
        }

        if (Object.keys(updates).length > 0) {
            patchTask.mutate(updates, { onSuccess: () => setIsEditing(false) })
        } else {
            setIsEditing(false)
        }
    }

    const generatePlan = useMutation({
        mutationFn: () => {
            console.log('Generate Plan clicked, taskId:', taskId, 'task.id:', task?.id, 'status:', task?.status, 'agentId:', task?.agentId)
            return api.post(`/api/v1/tasks/${taskId}/plan`)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        onError: (err: any) => {
            console.error('Generate Plan error:', err)
            toast.error(err?.data?.error || 'Failed to generate plan')
        },
    })

    const { mutate: deleteTask } = useMutation({
        mutationFn: () => api.del(`/api/v1/tasks/${taskId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task deleted')
            router.push(`/${tenantSlug}/dashboard/board`)
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to delete task'),
    })

    const handleCriteriaChange = (updated: AcceptanceCriterion[]) => {
        setLocalCriteria(updated)
        patchTask.mutate({ acceptanceCriteria: updated })
    }

    const needsClarification = task?.status === 'blocked'
    const clarificationQuestions = needsClarification
        ? ((events?.find(e => e.eventType === 'clarification_requested')?.payload?.questions as string[] | undefined)?.filter(Boolean) ?? (
              task?.blockedReason?.startsWith('Agent needs clarification:')
                  ? [task.blockedReason.replace(/^Agent needs clarification:\s*/, '')]
                  : []
          ))
        : []
    const completedSteps = steps?.filter(s => s.status === 'done').length ?? 0

    if (isLoading) return <div className="p-8"><Skeleton className="h-[calc(100vh-120px)] w-full" /></div>
    if (isError || !task || !steps || !events) {
        return (
            <div className="p-8">
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error instanceof Error ? error.message : 'Failed to load task.'}</AlertDescription>
                </Alert>
            </div>
        )
    }

    return (
        <div className="flex h-[calc(100vh-60px)] overflow-hidden bg-background">
            {/* Left Column */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {/* TOP NAV BAR */}
                <div className="flex items-center justify-between px-8 py-3 border-b border-[#1e1e1e] flex-shrink-0">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
                        <Link href={`/${tenantSlug}/dashboard/board`} className="hover:text-foreground">Board</Link>
                        <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5" />
                        <span>Work Items</span>
                        <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5" />
                        <span className="text-foreground">TASK-{task.id.slice(0,6).toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => voteMutation.mutate('up')}
                            disabled={voteMutation.isPending}
                            className="rounded-md bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-1 text-xs flex items-center gap-1 text-muted-foreground hover:bg-[#222] transition-colors disabled:opacity-50"
                        >
                            <ArrowUp className={cn("w-3 h-3", voteMutation.isPending && "animate-pulse")} /> {task.upvotes || 0}
                        </button>
                        <button
                            onClick={() => voteMutation.mutate('down')}
                            disabled={voteMutation.isPending}
                            className="rounded-md bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-1 text-xs flex items-center gap-1 text-muted-foreground hover:bg-[#222] transition-colors disabled:opacity-50"
                        >
                            <ArrowDown className={cn("w-3 h-3", voteMutation.isPending && "animate-pulse")} /> {task.downvotes || 0}
                        </button>
                        {isEditing ? (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2 text-muted-foreground"
                                    onClick={cancelEdit}
                                    disabled={patchTask.isPending}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90"
                                    onClick={saveEdits}
                                    disabled={patchTask.isPending}
                                >
                                    {patchTask.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 gap-1.5 text-muted-foreground hover:text-foreground"
                                onClick={enterEditMode}
                            >
                                <Pencil className="w-3 h-3" /> Edit
                            </Button>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onClick={() => {
                                        if (window.confirm('Delete this task? This cannot be undone.')) deleteTask()
                                    }}
                                    className="text-red-500 focus:text-red-400 focus:bg-red-500/10 cursor-pointer"
                                >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                
                {/* STATUS BANNER */}
                <TaskStatusBanner
                    task={task}
                    needsClarification={!!needsClarification}
                    onMarkDone={() => patchTask.mutate({ status: 'done' })}
                    isMarkingDone={patchTask.isPending}
                />

                {/* MAIN CONTENT AREA */}
                <div className="px-8 py-6 flex-1 overflow-y-auto">
                    {isEditing ? (
                        <input
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            className="text-3xl font-semibold bg-transparent border-b border-primary/40 outline-none w-full text-foreground mb-6 pb-1"
                            autoFocus
                        />
                    ) : isEditingTitle ? (
                        <div className="flex items-center gap-2 mb-6">
                            <input
                                value={titleValue}
                                onChange={(e) => setTitleValue(e.target.value)}
                                className="text-3xl font-semibold bg-transparent border-none outline-none flex-1 text-foreground focus:ring-0"
                                autoFocus
                            />
                            <Button
                                size="sm"
                                disabled={patchTask.isPending}
                                onClick={() => {
                                    patchTask.mutate({ title: titleValue })
                                    setIsEditingTitle(false)
                                }}
                            >
                                {patchTask.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                            </Button>
                        </div>
                    ) : (
                        <h1
                            onClick={() => setIsEditingTitle(true)}
                            className="text-3xl font-semibold text-foreground mb-6 leading-tight cursor-pointer hover:bg-[#1a1a1a] rounded px-1 -ml-1 transition-colors"
                        >
                            {task?.title}
                        </h1>
                    )}
                    
                    <div className="flex flex-wrap items-center gap-2 mb-6 mt-2">
                      
                      {/* Status pill */}
                      {isEditing ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[#1e1e1e] bg-[#1a1a1a] hover:bg-[#222] transition-colors cursor-pointer select-none outline-none">
                              <StatusIcon status={draftStatus} />
                              <span className={STATUS_CONFIG[draftStatus]?.text}>{STATUS_CONFIG[draftStatus]?.label}</span>
                              <ChevronDown className="w-3 h-3 opacity-40" />
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-[#141414] border-[#2a2a2a]" align="start">
                            {(['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'] as const).map((s) => (
                              <DropdownMenuItem key={s} className="gap-2 text-xs cursor-pointer" onSelect={() => setDraftStatus(s)}>
                                <StatusIcon status={s} /><span className={STATUS_CONFIG[s].text}>{STATUS_CONFIG[s].label}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground border border-[#1e1e1e]">
                          <StatusIcon status={task.status} />
                          <span className={STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.text ?? 'text-muted-foreground'}>
                            {STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.label ?? task.status}
                          </span>
                        </div>
                      )}

                      {/* Assignee pill */}
                      {isEditing ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[#1e1e1e] bg-[#1a1a1a] hover:bg-[#222] transition-colors cursor-pointer select-none outline-none">
                              {draftAssigneeKey.startsWith('agent:') ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                              <span>
                                {draftAssigneeKey === 'unassigned'
                                  ? 'No Assignee'
                                  : assigneeOptions.find(o => `${o.type}:${o.id}` === draftAssigneeKey)?.name ?? 'No Assignee'}
                              </span>
                              <ChevronDown className="w-3 h-3 opacity-40" />
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-[#1a1a1a] border-[#2a2a2a] text-xs" align="start">
                            <DropdownMenuItem className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey('unassigned')}>
                              <User className="w-3.5 h-3.5" /> No Assignee
                            </DropdownMenuItem>
                            {members.length > 0 && (
                              <>
                                <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Members</DropdownMenuLabel>
                                {members.map(m => (
                                  <DropdownMenuItem key={m.userId} className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey(`member:${m.userId}`)}>
                                    <User className="w-3.5 h-3.5" />{m.userName || m.userEmail}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                            {activeAgents.length > 0 && (
                              <>
                                <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Agents</DropdownMenuLabel>
                                {activeAgents.map(a => (
                                  <DropdownMenuItem key={a.id} className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey(`agent:${a.id}`)}>
                                    <Bot className="w-3.5 h-3.5" />{a.name}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground border border-[#1e1e1e]">
                          {selectedAssignee?.type === 'agent' ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                          <span>{selectedAssignee?.name ?? 'No Assignee'}</span>
                        </div>
                      )}

                      {/* Est. Hours pill */}
                      <div className="relative">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#1e1e1e] bg-[#1a1a1a]">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={draftEstimatedHours}
                              onChange={(e) => setDraftEstimatedHours(e.target.value)}
                              placeholder="hours"
                              className="w-16 text-xs bg-transparent outline-none text-foreground"
                            />
                          </div>
                        ) : isEditingHours ? (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            defaultValue={task.estimatedHours ? Number(task.estimatedHours) : undefined}
                            placeholder="hours"
                            className="w-24 px-2.5 py-1 text-xs bg-[#1a1a1a] border border-primary/50 rounded-md outline-none text-foreground"
                            autoFocus
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value)
                              if (!isNaN(val) && val > 0) {
                                patchTask.mutate({ estimatedHours: val })
                              } else if (e.target.value === '') {
                                patchTask.mutate({ estimatedHours: null })
                              }
                              setIsEditingHours(false)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur()
                              if (e.key === 'Escape') setIsEditingHours(false)
                            }}
                          />
                        ) : (
                          <div
                            onClick={() => setIsEditingHours(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>{task.estimatedHours ? `${task.estimatedHours}h` : 'Est. hours'}</span>
                          </div>
                        )}
                      </div>

                      {/* Start date pill */}
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground border border-[#1e1e1e] bg-[#1a1a1a]">
                          <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                          <input
                            type="date"
                            value={draftStartedAt}
                            onChange={(e) => setDraftStartedAt(e.target.value)}
                            className="bg-transparent outline-none text-xs text-foreground cursor-pointer"
                            placeholder="Start date"
                          />
                        </div>
                      ) : (
                        <div className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]">
                          <Calendar className="w-3.5 h-3.5 pointer-events-none" />
                          <span className="pointer-events-none">
                            {task.startedAt ? new Date(task.startedAt).toLocaleDateString() : 'Start date'}
                          </span>
                          <input
                            ref={startDateRef}
                            type="date"
                            className="absolute inset-0 opacity-0 cursor-pointer w-full"
                            value={task.startedAt ? new Date(task.startedAt).toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              if (e.target.value) patchTask.mutate({ startedAt: new Date(e.target.value).toISOString() })
                              else patchTask.mutate({ startedAt: null })
                            }}
                          />
                        </div>
                      )}

                      {/* Due date pill */}
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground border border-[#1e1e1e] bg-[#1a1a1a]">
                          <CalendarClock className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                          <input
                            type="date"
                            value={draftDueDate}
                            onChange={(e) => setDraftDueDate(e.target.value)}
                            className="bg-transparent outline-none text-xs text-foreground cursor-pointer"
                            placeholder="Due date"
                          />
                        </div>
                      ) : (
                        <div className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]">
                          <CalendarClock className="w-3.5 h-3.5 pointer-events-none" />
                          <span className="pointer-events-none">
                            {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'Due date'}
                          </span>
                          <input
                            ref={dueDateRef}
                            type="date"
                            className="absolute inset-0 opacity-0 cursor-pointer w-full"
                            value={task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              if (e.target.value) patchTask.mutate({ dueDate: new Date(e.target.value).toISOString() })
                              else patchTask.mutate({ dueDate: null })
                            }}
                          />
                        </div>
                      )}

                    </div>
                    
                    {isEditing ? (
                        <div className="mb-6">
                            <RichTextEditor
                                value={draftDescription}
                                onChange={setDraftDescription}
                                placeholder="Add description..."
                                minHeight="160px"
                            />
                        </div>
                    ) : isEditingDescription ? (
                        <div className="mb-6">
                            <RichTextEditor
                                value={descriptionValue}
                                onChange={setDescriptionValue}
                                placeholder="Add description..."
                                minHeight="160px"
                            />
                            <div className="flex items-center justify-end gap-2 mt-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => {
                                        setDescriptionValue(task?.description || '')
                                        setIsEditingDescription(false)
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-7 px-3"
                                    disabled={patchTask.isPending}
                                    onClick={() => {
                                        patchTask.mutate({ description: descriptionValue })
                                        setIsEditingDescription(false)
                                    }}
                                >
                                    {patchTask.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div
                            onClick={() => setIsEditingDescription(true)}
                            className="text-sm text-foreground/80 leading-relaxed mb-6 cursor-pointer hover:bg-[#1a1a1a] rounded p-2 -ml-2 transition-colors min-h-[40px]"
                        >
                            {task?.description ? (
                                <RichTextEditor value={task.description} isReadOnly />
                            ) : (
                                <span className="text-muted-foreground/40 italic">Add description...</span>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap py-3 border-y border-[#1e1e1e] mb-6">
                        <button
                            onClick={focusLinkInput}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]"
                        >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>Link</span>
                        </button>
                        <button
                            onClick={() => attachFileInputRef.current?.click()}
                            disabled={isUploadingAttachment}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isUploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                            <span>{isUploadingAttachment ? 'Uploading…' : 'Attach'}</span>
                        </button>
                        <button
                            onClick={focusReferenceInput}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]"
                        >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Reference</span>
                        </button>
                        {/* Hidden file input for attachment uploads */}
                        <input
                            ref={attachFileInputRef}
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleAttachmentUpload(file)
                            }}
                        />
                    </div>

                    {/* ── DEFINITION OF DONE (Guardrails) ── */}
                    <AcceptanceCriteriaEditor criteria={localCriteria} onChange={handleCriteriaChange} />

                    {/* ── AGENT PLANNING SECTION ── */}
                    {/* Fix 2: hide during review/done — PostActionReceipt takes over */}
                    {!['review', 'done'].includes(task.status) && (
                    <div className="mb-8 pt-6 border-t border-[#1e1e1e]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Bot className="w-4 h-4 text-muted-foreground" />
                                <h2 className="text-sm font-medium text-foreground">Agent's Plan</h2>
                                {steps.length > 0 && <span className="bg-[#1a1a1a] border border-[#2a2a2a] px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/80 font-medium">{steps.length} steps</span>}
                            </div>
                            {task.status === 'blocked' && task.blockedReason?.includes('Planning failed') && (
                                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => approvePlan({ approved: false })}>
                                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                                </Button>
                            )}
                        </div>

                        {/* Activity stream */}
                        <AgentActivityStream status={task.status} steps={steps} />

                        {/* Clarification — shown ABOVE the steps */}
                        {needsClarification && (
                            <div className="mb-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                                <div className="flex items-center gap-2 mb-3">
                                    <MessageSquare className="w-4 h-4 text-amber-500" />
                                    <h3 className="text-sm font-medium text-amber-400">Agent has questions before proceeding</h3>
                                </div>
                                <div className="space-y-1.5 text-sm text-amber-400/80 mb-4">
                                    {clarificationQuestions.map((q, i) => <p key={i} className="flex gap-2"><span className="text-amber-500/50 font-mono text-xs mt-0.5">{i + 1}.</span>{q}</p>)}
                                </div>
                                <div className="border border-[#1e1e1e] rounded-lg overflow-hidden focus-within:border-amber-500/40 transition-colors bg-[#0f0f0f]">
                                    <textarea
                                        placeholder="Type your answer here..."
                                        value={clarificationAnswer}
                                        onChange={(e) => setClarificationAnswer(e.target.value)}
                                        className="w-full bg-transparent p-3 text-sm text-foreground outline-none min-h-[80px] resize-none placeholder:text-muted-foreground/30"
                                    />
                                    <div className="flex justify-end px-2 py-1.5 bg-[#161616] border-t border-[#1e1e1e]">
                                        <Button size="sm" onClick={() => clarify(clarificationAnswer)} disabled={task.status === 'in_progress' || isClarifying || !clarificationAnswer.trim()}
                                            className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 px-3">
                                            {isClarifying ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Sending...</> : 'Send Answer'}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Planning failed — Redesigned as an informative insight */}
                        {steps.length === 0 && task.status === 'blocked' && task.blockedReason?.includes('Planning failed') && (
                            <div className="bg-[#161212] border border-red-900/20 rounded-xl p-5">
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                                        <AlertTriangle className="w-5 h-5 text-red-500" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-medium text-red-400">Planning Interrupted</h3>
                                        <p className="text-xs text-red-400/70 mt-1 leading-relaxed">
                                            The agent encountered an issue while generating the execution plan: 
                                            <span className="text-red-400 font-mono italic ml-1 underline decoration-red-500/30">"{task.blockedReason}"</span>
                                        </p>
                                        <div className="mt-4 flex flex-col gap-3 p-3 bg-red-500/5 rounded-lg border border-red-500/10">
                                            <p className="text-[11px] text-red-400/60 uppercase tracking-wider font-semibold">Suggested Fixes</p>
                                            <ul className="text-xs text-red-300/60 space-y-2">
                                                <li className="flex items-start gap-2">• Add more specific **Acceptance Criteria** below to guide the agent.</li>
                                                <li className="flex items-start gap-2">• Clarify the **Task Description** to reduce ambiguity.</li>
                                            </ul>
                                        </div>
                                        <div className="mt-5 flex items-center gap-3">
                                            <Button 
                                                size="sm" 
                                                className="bg-red-600 hover:bg-red-700 text-white text-[11px] h-8 gap-2 px-4 shadow-lg shadow-red-900/20" 
                                                onClick={() => approvePlan({ approved: false })}
                                            >
                                                <RefreshCw className="w-3 h-3" /> Retry Planning
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Planning in progress — streaming skeleton */}
                        {steps.length === 0 && task.status === 'planning' && (
                            <>
                                {events?.some((e: TaskEvent) => e.eventType === 'plan_rejected') && (
                                    <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15 text-xs text-amber-400/70">
                                        <RefreshCw className="w-3 h-3 shrink-0" />
                                        Saarthi is replanning based on your feedback...
                                    </div>
                                )}
                                <PlanningSkeletonCards />
                            </>
                        )}

                        {/* No plan yet — backlog */}
                        {steps.length === 0 && task.status === 'backlog' && (
                            <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-8 flex flex-col items-center justify-center text-center">
                                <Bot className="w-8 h-8 text-muted-foreground/20 mb-2" />
                                <p className="text-sm text-muted-foreground/60">No plan yet</p>
                                <p className="text-xs text-muted-foreground/40 mt-1">Move to Todo to generate a plan</p>
                            </div>
                        )}

                        {/* Generate Plan — available once task is in todo with an agent assigned */}
                        {steps.length === 0 && task.status === 'todo' && task.agentId && (
                            <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3">
                                <Bot className="w-8 h-8 text-muted-foreground/30" />
                                <div>
                                    <p className="text-sm text-muted-foreground/80 font-medium">Ready to plan</p>
                                    <p className="text-xs text-muted-foreground/40 mt-1">The agent will analyse the task and propose a step-by-step execution plan.</p>
                                </div>
                                <Button
                                    size="sm"
                                    className="mt-1 gap-2"
                                    disabled={generatePlan.isPending}
                                    onClick={() => generatePlan.mutate()}
                                >
                                    {generatePlan.isPending
                                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                                        : <><Sparkles className="w-3.5 h-3.5" /> Generate Plan</>
                                    }
                                </Button>
                            </div>
                        )}

                        {/* No agent assigned — prompt user to assign one */}
                        {steps.length === 0 && task.status === 'todo' && !task.agentId && (
                            <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-8 flex flex-col items-center justify-center text-center gap-2">
                                <Bot className="w-8 h-8 text-muted-foreground/20" />
                                <p className="text-sm text-muted-foreground/60">Assign an agent (not a member) to generate a plan</p>
                            </div>
                        )}

                        {/* Steps list */}
                        {steps.length > 0 && (
                            <div className={cn('transition-opacity duration-300', stepsVisible ? 'opacity-100' : 'opacity-0')}>
                                {steps.map((step, i) => <StepCard key={step.id} step={step} index={i} />)}

                                {/* Approve / Reject bar — only show when plan not yet approved and agent not executing */}
                                {(!task.planApprovedAt) && (task.status === 'backlog' || task.status === 'awaiting_approval') && (
                                    <div className="mt-4 p-3 rounded-xl border border-[#1e1e1e] bg-[#0f0f0f] flex items-center justify-between gap-3">
                                        <p className="text-xs text-muted-foreground">Review the {steps.length}-step plan above and approve or request changes.</p>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5 border-[#2a2a2a] hover:border-red-500/40 hover:text-red-400" onClick={() => setFeedbackOpen(true)}>
                                                <ThumbsDown className="w-3.5 h-3.5" /> Request Changes
                                            </Button>
                                            <Button size="sm" className="text-xs h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => approvePlan({ approved: true })}>
                                                <ThumbsUp className="w-3.5 h-3.5" /> Approve Plan
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {task.planApprovedAt && (
                                    <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-500/70">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                        {task.status === 'ready' ? 'Plan approved · Awaiting execution' : 
                                         task.status === 'in_progress' ? 'Agent is executing' : 
                                         'Plan approved'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    )}

                    {/* ── POST-ACTION RECEIPT ── */}
                    {(task.status === 'review' || task.status === 'done') && (
                        <div className="mb-8 pt-6 border-t border-[#1e1e1e]">
                            <PostActionReceipt
                                task={task}
                                steps={steps}
                                onMarkDone={() => patchTask.mutate({ status: 'done' })}
                                isMarkingDone={patchTask.isPending}
                            />
                        </div>
                    )}

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
                                const ActorIcon = event.actorType === 'agent' ? Bot : event.actorType === 'human' ? User : Settings;
                                const actorName = event.actorType === 'human' ? 'You' : event.actorType === 'agent' ? 'Agent' : 'System';
                                
                                // Map event types to readable descriptions and icons
                                let description = event.eventType.replace(/_/g, ' ');
                                let Icon = ActorIcon;
                                
                                if (event.eventType === 'status_changed') {
                                    Icon = RefreshCw;
                                    description = `Status changed to ${event.payload?.to || 'unknown'}`;
                                } else if (event.eventType === 'comment_added') {
                                    Icon = MessageSquare;
                                    description = 'Added a comment';
                                } else if (event.eventType === 'plan_approved') {
                                    Icon = CheckCircle;
                                    description = 'Approved the execution plan';
                                } else if (event.eventType === 'plan_rejected') {
                                    Icon = XCircle;
                                    description = 'Requested changes to the plan';
                                } else if (event.eventType === 'clarification_requested') {
                                    Icon = MessageSquare;
                                    description = 'Requested clarification';
                                } else if (event.eventType === 'clarification_answered') {
                                    Icon = Check;
                                    description = 'Provided clarification';
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
                        {/* ── COMMENTS SECTION ── */}
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
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-invert prose-sm max-w-none prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5">
                                                            {c.content}
                                                        </ReactMarkdown>
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
                </div>
            </div>

            {/* Right Sidebar */}
            <div className="w-[300px] border-l border-[#1e1e1e] flex-shrink-0 flex flex-col overflow-y-auto px-5 py-6">
                <div className="flex items-center justify-between mb-5">
                    <h3 className="text-sm font-semibold text-foreground">Properties</h3>
                    <p className="text-[11px] text-muted-foreground/50">Updated {formatRelativeTime(task.updatedAt)} ago</p>
                </div>
                
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 cursor-default">
                    Details
                    <ChevronDown className="w-3.5 h-3.5" />
                </div>
                
                <div className="flex flex-col">
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <StatusIcon status={task.status} />
                            <span className="text-xs">Status</span>
                        </div>
                        <div className="text-xs text-foreground flex-1">
                            {isEditing ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 outline-none select-none">
                                            <span className={cn("font-medium", STATUS_CONFIG[draftStatus]?.text)}>
                                                {STATUS_CONFIG[draftStatus]?.label}
                                            </span>
                                            <ChevronDown className="w-3 h-3 opacity-40" />
                                        </div>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="bg-[#1a1a1a] border-[#2a2a2a]" align="start">
                                        {(['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'] as const).map((s) => (
                                            <DropdownMenuItem key={s} className="text-xs cursor-pointer gap-2" onSelect={() => setDraftStatus(s)}>
                                                <StatusIcon status={s} />
                                                <span className={STATUS_CONFIG[s].text}>{STATUS_CONFIG[s].label}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <span className={cn("font-medium", STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.text)}>
                                    {STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.label ?? task.status}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <PriorityIcon priority={isEditing ? draftPriority : task.priority} />
                            <span className="text-xs">Priority</span>
                        </div>
                        <div className="text-xs text-foreground flex-1">
                            {isEditing ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 outline-none select-none">
                                            <span className={cn("font-medium", PRIORITY_CONFIG[draftPriority]?.text)}>
                                                {PRIORITY_CONFIG[draftPriority]?.label}
                                            </span>
                                            <ChevronDown className="w-3 h-3 opacity-40" />
                                        </div>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="bg-[#1a1a1a] border-[#2a2a2a]" align="start">
                                        {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                                            <DropdownMenuItem key={p} className="text-xs cursor-pointer gap-2" onSelect={() => setDraftPriority(p)}>
                                                <PriorityIcon priority={p} />
                                                <span className={PRIORITY_CONFIG[p].text}>{PRIORITY_CONFIG[p].label}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <span className={cn("font-medium", PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG]?.text)}>
                                    {PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG]?.label ?? task.priority}
                                </span>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            {selectedAssignee?.type === 'agent'
                                ? <Bot className="w-3.5 h-3.5 opacity-50" />
                                : <User className="w-3.5 h-3.5 opacity-50" />}
                            <span className="text-xs">Assignee</span>
                        </div>
                        <div className="text-xs text-foreground flex-1">
                            {isEditing ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 outline-none select-none">
                                            <span>
                                                {draftAssigneeKey === 'unassigned' ? 'No Assignee' : assigneeOptions.find(o => `${o.type}:${o.id}` === draftAssigneeKey)?.name ?? 'No Assignee'}
                                            </span>
                                            <ChevronDown className="w-3 h-3 opacity-40" />
                                        </div>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="bg-[#1a1a1a] border-[#2a2a2a] text-xs" align="start">
                                        <DropdownMenuItem className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey('unassigned')}>
                                            <User className="w-3.5 h-3.5" /> No Assignee
                                        </DropdownMenuItem>
                                        {members.length > 0 && (
                                            <>
                                                <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                                <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Members</DropdownMenuLabel>
                                                {members.map(m => (
                                                    <DropdownMenuItem key={m.userId} className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey(`member:${m.userId}`)}>
                                                        <User className="w-3.5 h-3.5" />{m.userName || m.userEmail}
                                                    </DropdownMenuItem>
                                                ))}
                                            </>
                                        )}
                                        {activeAgents.length > 0 && (
                                            <>
                                                <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                                <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Agents</DropdownMenuLabel>
                                                {activeAgents.map(a => (
                                                    <DropdownMenuItem key={a.id} className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey(`agent:${a.id}`)}>
                                                        <Bot className="w-3.5 h-3.5" />{a.name}
                                                    </DropdownMenuItem>
                                                ))}
                                            </>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <span className="font-medium">{selectedAssignee?.name ?? 'No Assignee'}</span>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Est. Hours</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">{task.estimatedHours ? `${task.estimatedHours}h` : '—'}</div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Target className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Confidence</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">
                           {task.confidenceScore ? (
                               <>
                                 <div className={cn("w-1.5 h-1.5 rounded-full", (Number(task.confidenceScore) >= 0.8) ? 'bg-green-500' : (Number(task.confidenceScore) >= 0.6) ? 'bg-amber-500' : 'bg-red-500')} /> 
                                 {Math.round(Number(task.confidenceScore)*100)}%
                               </>
                           ) : '—'}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <LayoutList className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Steps</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">{steps.length > 0 ? `${completedSteps} / ${steps.length} complete` : 'No steps yet'}</div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Created</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">{new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Updated</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">{formatRelativeTime(task.updatedAt)} ago</div>
                    </div>
                    
                    <div id="links-section" className="flex flex-col py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Link2 className="w-3.5 h-3.5 opacity-50" /> 
                                <span className="text-xs">Links</span>
                            </div>
                        </div>
                        <div className="space-y-1.5 mb-2">
                            {task.links?.map((link, i) => (
                                <div key={i} className="flex items-center justify-between group">
                                    <a href={link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline truncate flex-1">
                                        {link}
                                    </a>
                                    {isEditing && (
                                        <button
                                            onClick={() => patchTask.mutate({ links: task.links.filter((_, idx) => idx !== i) })}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/10 rounded transition-all"
                                        >
                                            <X className="w-3 h-3 text-red-400" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {(!task.links || task.links.length === 0) && <span className="text-[11px] text-muted-foreground/40 italic">No links added</span>}
                        </div>
                        {isEditing && (
                            <div className="flex items-center gap-1 mt-1">
                                <input
                                    ref={newLinkInputRef}
                                    value={newLink}
                                    onChange={(e) => setNewLink(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newLink.trim()) {
                                            patchTask.mutate({ links: [...(task.links || []), newLink.trim()] })
                                            setNewLink('')
                                        }
                                    }}
                                    placeholder="Paste URL and press Enter…"
                                    className="text-[10px] bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1 flex-1 outline-none focus:border-primary/50 transition-colors"
                                />
                            </div>
                        )}
                    </div>
                    
                    <div className="flex flex-col py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Paperclip className="w-3.5 h-3.5 opacity-50" />
                                <span className="text-xs">Attachments</span>
                            </div>
                            <button
                                onClick={() => attachFileInputRef.current?.click()}
                                disabled={isUploadingAttachment}
                                className="text-[10px] text-muted-foreground hover:text-foreground bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#2a2a2a] disabled:cursor-not-allowed transition-colors"
                            >
                                {isUploadingAttachment ? '…' : '+ Add'}
                            </button>
                        </div>
                        {task.attachmentFileIds?.length > 0 ? (
                            <div className="space-y-1">
                                {task.attachmentFileIds.map((fileId, i) => (
                                    <div key={fileId} className="flex items-center justify-between group/att">
                                        <button
                                            className="text-[11px] text-primary hover:underline truncate flex-1 text-left"
                                            onClick={async () => {
                                                try {
                                                    const res = await api.get<{ data: { downloadUrl: string } }>(`/api/v1/files/${fileId}/download`)
                                                    window.open(res.data.downloadUrl, '_blank')
                                                } catch {
                                                    toast.error('Failed to open attachment')
                                                }
                                            }}
                                        >
                                            Attachment {i + 1}
                                        </button>
                                        <button
                                            onClick={() => patchTask.mutate({
                                                attachmentFileIds: task.attachmentFileIds.filter(id => id !== fileId)
                                            })}
                                            className="opacity-0 group-hover/att:opacity-100 p-0.5 hover:bg-red-500/10 rounded transition-all ml-1"
                                        >
                                            <X className="w-3 h-3 text-red-400" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-[11px] text-muted-foreground/40 italic">No attachments</span>
                        )}
                    </div>

                    <div id="reference-section" className="flex flex-col py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 text-muted-foreground mb-2">
                            <FileText className="w-3.5 h-3.5 opacity-50" />
                            <span className="text-xs">Reference</span>
                        </div>
                        {isEditing ? (
                            <textarea
                                ref={referenceTextRef}
                                defaultValue={task.referenceText ?? ''}
                                onBlur={(e) => {
                                    const val = e.target.value.trim()
                                    if (val !== (task.referenceText ?? '').trim()) {
                                        patchTask.mutate({ referenceText: val || null })
                                    }
                                }}
                                placeholder="Add reference notes, markdown content, or context…"
                                rows={3}
                                className="text-[11px] text-foreground/80 leading-relaxed bg-[#111] border border-[#1e1e1e] rounded-lg p-2.5 outline-none focus:border-primary/40 resize-none w-full placeholder:text-muted-foreground/30 transition-colors"
                            />
                        ) : (
                            <p className="text-[11px] text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
                                {task.referenceText || <span className="text-muted-foreground/40 italic">No reference added</span>}
                            </p>
                        )}
                    </div>
                </div>
                
                <div className="my-5 border-t border-[#1e1e1e]"></div>
                
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Actions
                </div>
                
                <div className="space-y-1.5">
                    {task.status === 'backlog' && steps.length > 0 && (
                        <button onClick={() => approvePlan({ approved: true })} className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left">
                            <CheckCircle className="w-4 h-4 text-emerald-500" /> <span className="text-emerald-500/90 font-medium">Approve Plan</span>
                        </button>
                    )}
                    {task.status === 'ready' && (
                        <button 
                            onClick={() => patchTask.mutate({ status: 'in_progress', startedAt: new Date().toISOString() })}
                            disabled={patchTask.isPending}
                            className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left disabled:opacity-50"
                        >
                            <Play className={cn("w-4 h-4 text-primary", patchTask.isPending && "animate-spin")} /> <span className="text-primary/90 font-medium">Start Task</span>
                        </button>
                    )}
                    {task.status !== 'done' && task.status !== 'cancelled' && (
                        <button
                            onClick={() => {
                                if (window.confirm('Delete this task? This cannot be undone.')) deleteTask()
                            }}
                            className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left"
                        >
                            <XCircle className="w-4 h-4 text-red-500" /> <span className="text-red-500/90 font-medium">Delete Task</span>
                        </button>
                    )}
                </div>
            </div>
            
            <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} steps={steps} onSubmitFeedback={(feedback) => approvePlan({ approved: false, feedback })} />
        </div>
    )
}

