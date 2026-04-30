'use client'

import { useState } from 'react'
import {
    Bot, User, ChevronDown, Clock, Target, LayoutList, Calendar,
    Link2, Paperclip, FileText, CheckCircle, Play, XCircle, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Task, Step } from '@/types/task'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
    backlog:           { label: 'Backlog',           color: '#6B7280', bg: 'bg-gray-500/10',    text: 'text-gray-400' },
    todo:              { label: 'Todo',              color: '#3B82F6', bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    planning:          { label: 'Planning',          color: '#F59E0B', bg: 'bg-amber-500/10',   text: 'text-amber-400' },
    awaiting_approval: { label: 'Awaiting Approval', color: '#8B5CF6', bg: 'bg-purple-500/10',  text: 'text-purple-400' },
    in_progress:       { label: 'In Progress',       color: '#F59E0B', bg: 'bg-amber-500/10',   text: 'text-amber-400' },
    review:            { label: 'Review',            color: '#8B5CF6', bg: 'bg-purple-500/10',  text: 'text-purple-400' },
    blocked:           { label: 'Blocked',           color: '#EF4444', bg: 'bg-red-500/10',     text: 'text-red-400' },
    done:              { label: 'Done',              color: '#10B981', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    ready:             { label: 'Ready',             color: '#3B82F6', bg: 'bg-primary/10',     text: 'text-primary' },
    cancelled:         { label: 'Cancelled',         color: '#6B7280', bg: 'bg-gray-500/10',    text: 'text-gray-400' },
} as const

const PRIORITY_CONFIG = {
    low:    { label: 'Low',    color: '#6B7280', text: 'text-gray-400' },
    medium: { label: 'Medium', color: '#3B82F6', text: 'text-blue-400' },
    high:   { label: 'High',   color: '#F59E0B', text: 'text-amber-400' },
    urgent: { label: 'Urgent', color: '#EF4444', text: 'text-red-400' },
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

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
        backlog:    <circle cx="12" cy="12" r="9" stroke="#6B7280" strokeWidth="1.5" strokeDasharray="4 2" fill="none" />,
        todo:       <circle cx="12" cy="12" r="9" stroke="#3B82F6" strokeWidth="1.5" fill="none" />,
        ready:      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />,
        in_progress: <>
            <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="1.5" fill="none" />
            <circle cx="12" cy="12" r="4" fill="#F59E0B" />
        </>,
        review:    <circle cx="12" cy="12" r="9" stroke="#8B5CF6" strokeWidth="1.5" fill="none" />,
        blocked:   <circle cx="12" cy="12" r="9" stroke="#EF4444" strokeWidth="1.5" fill="none" />,
        done: <>
            <circle cx="12" cy="12" r="9" fill="#10B981" />
            <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>,
        cancelled: <circle cx="12" cy="12" r="9" stroke="#6B7280" strokeWidth="1.5" fill="none" />,
    }
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className}>
            {configs[status as keyof typeof configs] ?? configs.backlog}
        </svg>
    )
}

const PriorityIcon = ({ priority, className }: { priority: string; className?: string }) => (
    <div
        className={cn('w-2 h-2 rounded-full', className)}
        style={{ backgroundColor: PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG]?.color }}
    />
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskSidebarProps {
    task: Task
    steps: Step[]
    editState: {
        isEditing: boolean
        draftStatus: string
        draftPriority: string
        draftAssigneeKey: string
        setDraftStatus: (v: string) => void
        setDraftPriority: (v: string) => void
        setDraftAssigneeKey: (v: string) => void
    }
    assigneeOptions: Array<{ type: 'agent' | 'member'; id: string; name: string }>
    selectedAssignee: { type: 'agent' | 'member'; id: string; name: string } | null
    isUploadingAttachment: boolean
    attachFileInputRef: React.RefObject<HTMLInputElement | null>
    newLinkInputRef: React.RefObject<HTMLInputElement | null>
    referenceTextRef: React.RefObject<HTMLTextAreaElement | null>
    taskOperations: {
        approvePlan: (opts?: { approved: boolean }) => Promise<void>
        deleteTask: () => Promise<void>
        removeLink: (url: string) => void
        addLink: (url: string) => void
        removeAttachment: (fileId: string) => void
        startTask: () => void
        saveReferenceText: (text: string | null) => void
    }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TaskSidebar({
    task,
    steps,
    editState,
    assigneeOptions,
    selectedAssignee,
    isUploadingAttachment,
    attachFileInputRef,
    newLinkInputRef,
    referenceTextRef,
    taskOperations,
}: TaskSidebarProps) {
    const { isEditing, draftStatus, draftPriority, draftAssigneeKey, setDraftStatus, setDraftPriority, setDraftAssigneeKey } = editState
    const [newLink, setNewLink] = useState('')

    const completedSteps = steps.filter(s => s.status === 'done').length

    return (
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
                {/* Status */}
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
                                        <span className={cn('font-medium', STATUS_CONFIG[draftStatus as keyof typeof STATUS_CONFIG]?.text)}>
                                            {STATUS_CONFIG[draftStatus as keyof typeof STATUS_CONFIG]?.label}
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
                            <span className={cn('font-medium', STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.text)}>
                                {STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.label ?? task.status}
                            </span>
                        )}
                    </div>
                </div>

                {/* Priority */}
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
                                        <span className={cn('font-medium', PRIORITY_CONFIG[draftPriority as keyof typeof PRIORITY_CONFIG]?.text)}>
                                            {PRIORITY_CONFIG[draftPriority as keyof typeof PRIORITY_CONFIG]?.label}
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
                            <span className={cn('font-medium', PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG]?.text)}>
                                {PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG]?.label ?? task.priority}
                            </span>
                        )}
                    </div>
                </div>

                {/* Assignee */}
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
                                    {assigneeOptions.filter(o => o.type === 'member').length > 0 && (
                                        <>
                                            <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Members</DropdownMenuLabel>
                                            {assigneeOptions.filter(o => o.type === 'member').map(m => (
                                                <DropdownMenuItem key={m.id} className="gap-1.5 text-xs" onSelect={() => setDraftAssigneeKey(`member:${m.id}`)}>
                                                    <User className="w-3.5 h-3.5" />{m.name}
                                                </DropdownMenuItem>
                                            ))}
                                        </>
                                    )}
                                    {assigneeOptions.filter(o => o.type === 'agent').length > 0 && (
                                        <>
                                            <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Agents</DropdownMenuLabel>
                                            {assigneeOptions.filter(o => o.type === 'agent').map(a => (
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

                {/* Est. Hours */}
                <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                    <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                        <Clock className="w-3.5 h-3.5 opacity-50" />
                        <span className="text-xs">Est. Hours</span>
                    </div>
                    <div className="text-xs text-foreground flex items-center gap-1.5">
                        {task.estimatedHours ? `${task.estimatedHours}h` : '—'}
                    </div>
                </div>

                {/* Confidence */}
                <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                    <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                        <Target className="w-3.5 h-3.5 opacity-50" />
                        <span className="text-xs">Confidence</span>
                    </div>
                    <div className="text-xs text-foreground flex items-center gap-1.5">
                        {task.confidenceScore ? (
                            <>
                                <div className={cn(
                                    'w-1.5 h-1.5 rounded-full',
                                    Number(task.confidenceScore) >= 0.8 ? 'bg-green-500'
                                        : Number(task.confidenceScore) >= 0.6 ? 'bg-amber-500'
                                        : 'bg-red-500',
                                )} />
                                {Math.round(Number(task.confidenceScore) * 100)}%
                            </>
                        ) : '—'}
                    </div>
                </div>

                {/* Steps */}
                <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                    <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                        <LayoutList className="w-3.5 h-3.5 opacity-50" />
                        <span className="text-xs">Steps</span>
                    </div>
                    <div className="text-xs text-foreground flex items-center gap-1.5">
                        {steps.length > 0 ? `${completedSteps} / ${steps.length} complete` : 'No steps yet'}
                    </div>
                </div>

                {/* Created */}
                <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                    <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5 opacity-50" />
                        <span className="text-xs">Created</span>
                    </div>
                    <div className="text-xs text-foreground flex items-center gap-1.5">
                        {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                </div>

                {/* Updated */}
                <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                    <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                        <Clock className="w-3.5 h-3.5 opacity-50" />
                        <span className="text-xs">Updated</span>
                    </div>
                    <div className="text-xs text-foreground flex items-center gap-1.5">
                        {formatRelativeTime(task.updatedAt)} ago
                    </div>
                </div>

                {/* Links */}
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
                                        onClick={() => taskOperations.removeLink(link)}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/10 rounded transition-all"
                                    >
                                        <X className="w-3 h-3 text-red-400" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {(!task.links || task.links.length === 0) && (
                            <span className="text-[11px] text-muted-foreground/40 italic">No links added</span>
                        )}
                    </div>
                    {isEditing && (
                        <div className="flex items-center gap-1 mt-1">
                            <input
                                ref={newLinkInputRef}
                                value={newLink}
                                onChange={(e) => setNewLink(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newLink.trim()) {
                                        taskOperations.addLink(newLink.trim())
                                        setNewLink('')
                                    }
                                }}
                                placeholder="Paste URL and press Enter…"
                                className="text-[10px] bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1 flex-1 outline-none focus:border-primary/50 transition-colors"
                            />
                        </div>
                    )}
                </div>

                {/* Attachments */}
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
                                        onClick={() => taskOperations.removeAttachment(fileId)}
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

                {/* Reference */}
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
                                    taskOperations.saveReferenceText(val || null)
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

            <div className="my-5 border-t border-[#1e1e1e]" />

            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Actions
            </div>

            <div className="space-y-1.5">
                {task.status === 'awaiting_approval' && (
                    <button
                        onClick={() => taskOperations.approvePlan({ approved: true })}
                        className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left"
                    >
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                        <span className="text-emerald-500/90 font-medium">Approve Plan</span>
                    </button>
                )}
                {task.status === 'ready' && (
                    <button
                        onClick={() => taskOperations.startTask()}
                        className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left"
                    >
                        <Play className="w-4 h-4 text-primary" />
                        <span className="text-primary/90 font-medium">Approve</span>
                    </button>
                )}
                {task.status !== 'done' && task.status !== 'cancelled' && (
                    <button
                        onClick={() => {
                            if (window.confirm('Delete this task? This cannot be undone.')) taskOperations.deleteTask()
                        }}
                        className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left"
                    >
                        <XCircle className="w-4 h-4 text-red-500" />
                        <span className="text-red-500/90 font-medium">Delete Task</span>
                    </button>
                )}
            </div>
        </div>
    )
}
