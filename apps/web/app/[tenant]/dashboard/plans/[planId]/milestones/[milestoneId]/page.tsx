'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isPast } from 'date-fns'
import { ChevronRight, CalendarDays, Plus, X, Clock, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/platform/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { pmKeys } from '@/lib/query-keys/pm'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BoardView } from '@/components/platform/BoardView'

// ─── Types ────────────────────────────────────────────────────────────────────

type MilestoneStatus = 'backlog' | 'in_progress' | 'completed' | 'cancelled'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

type Plan = { id: string; sequenceId: number; title: string }

type Milestone = {
    id: string
    sequenceId: number
    title: string
    description: string | null
    status: MilestoneStatus
    targetDate: string | null
    priority: Priority
    acceptanceCriteria: { text: string; checked: boolean }[]
    estimatedHours: string | null
    totalTasks?: number
    completedTasks?: number
}

type AcItem = { text: string; checked?: boolean }

type MilestoneTask = {
    id: string
    sequenceId: number | null
    title: string
    description: string | null
    status: string
    priority: Priority
    assigneeId: string | null
    dueDate: string | null
    acceptanceCriteria?: AcItem[]
    estimatedHours?: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MILESTONE_STATUS_CONFIG: Record<MilestoneStatus, { label: string; color: string; bg: string }> = {
    backlog:     { label: 'Backlog',     color: 'text-gray-400',    bg: 'bg-gray-500/10' },
    in_progress: { label: 'In Progress', color: 'text-blue-400',    bg: 'bg-blue-500/10' },
    completed:   { label: 'Completed',   color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    cancelled:   { label: 'Cancelled',   color: 'text-red-400',     bg: 'bg-red-500/10' },
}

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
    low:    { label: 'Low',    color: '#6B7280' },
    medium: { label: 'Medium', color: '#3B82F6' },
    high:   { label: 'High',   color: '#F59E0B' },
    urgent: { label: 'Urgent', color: '#EF4444' },
}

const TASK_STATUS_COLORS: Record<string, string> = {
    backlog:           '#6B7280',
    todo:              '#3B82F6',
    in_progress:       '#8B5CF6',
    awaiting_approval: '#F59E0B',
    review:            '#F59E0B',
    blocked:           '#EF4444',
    done:              '#10B981',
    cancelled:         '#6B7280',
}

// ─── DefinitionOfDone ─────────────────────────────────────────────────────────

type AcCriterion = { text: string; checked: boolean }

function DefinitionOfDone({
    initial,
    onSave,
}: {
    milestoneId: string
    planId: string
    initial: AcCriterion[]
    onSave: (items: AcCriterion[]) => void
}) {
    const [items, setItems] = useState<AcCriterion[]>(initial)

    const commit = (next: AcCriterion[]) => {
        setItems(next)
        onSave(next.filter(c => c.text.trim()))
    }
    const toggle = (i: number) => commit(items.map((c, j) => j === i ? { ...c, checked: !c.checked } : c))
    const remove = (i: number) => commit(items.filter((_, j) => j !== i))
    const updateText = (i: number, text: string) => setItems(p => p.map((c, j) => j === i ? { ...c, text } : c))
    const handleBlur = (i: number) => {
        const trimmed = items[i].text.trim()
        if (!trimmed) { commit(items.filter((_, j) => j !== i)) } else { commit(items) }
    }

    return (
        <div className="mt-4 border-t border-[#1e1e1e] pt-4">
            <p className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">Definition of Done</p>
            {items.length === 0 ? (
                <p className="text-xs text-muted-foreground/30 italic mb-2">No criteria yet</p>
            ) : (
                <div className="space-y-1.5">
                    {items.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 group">
                            <button onClick={() => toggle(i)} className={cn('w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center text-[8px] transition-colors', item.checked ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'border-[#2a2a2a]')}>
                                {item.checked && '✓'}
                            </button>
                            <input
                                autoFocus={item.text === ''}
                                value={item.text}
                                onChange={e => updateText(i, e.target.value)}
                                onBlur={() => handleBlur(i)}
                                placeholder="Criterion…"
                                className={cn('flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/30', item.checked ? 'line-through text-muted-foreground/40' : 'text-foreground/80')}
                            />
                            <button onClick={() => remove(i)} className="opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-destructive transition-all">
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <button onClick={() => setItems(p => [...p, { text: '', checked: false }])} className="mt-2 flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <Plus className="w-3 h-3" /> Add criterion
            </button>
        </div>
    )
}

// ─── ListTab ──────────────────────────────────────────────────────────────────

function ListTab({ milestoneId, tenantSlug }: { milestoneId: string; tenantSlug: string }) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

    const { data, isLoading } = useQuery<{ data: MilestoneTask[] }>({
        queryKey: pmKeys.milestoneTasks(milestoneId),
        queryFn: () => api.get(`/api/v1/milestones/${milestoneId}/tasks`),
    })

    const deleteTask = useMutation({
        mutationFn: (taskId: string) => api.del(`/api/v1/tasks/${taskId}`),
        onError: () => toast.error('Failed to delete a task'),
    })

    const handleBulkDelete = async () => {
        for (const id of selected) {
            await deleteTask.mutateAsync(id)
        }
        queryClient.invalidateQueries({ queryKey: pmKeys.milestoneTasks(milestoneId) })
        toast.success(`${selected.size} task${selected.size !== 1 ? 's' : ''} deleted`)
        setSelected(new Set())
        setBulkDeleteOpen(false)
    }

    const toggleOne = (id: string) => setSelected(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
    })

    const tasks = data?.data ?? []
    const ids = tasks.map(t => t.id)
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id))
    const someSelected = ids.some(id => selected.has(id))

    if (isLoading) return (
        <div className="space-y-2 pt-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
    )

    if (tasks.length === 0) return (
        <p className="text-sm text-muted-foreground py-8 text-center">No tasks in this milestone yet</p>
    )

    return (
        <div className="pt-4 pb-20">
            <div className="border border-[#1e1e1e] rounded-lg divide-y divide-[#1e1e1e]">
                {/* Select-all header row */}
                <div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d0d] rounded-t-lg">
                    <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={() => {
                            const next = new Set(selected)
                            if (allSelected) ids.forEach(id => next.delete(id))
                            else ids.forEach(id => next.add(id))
                            setSelected(next)
                        }}
                        className="shrink-0"
                    />
                    <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Select all</span>
                </div>
                {tasks.map(t => {
                    const dotColor = TASK_STATUS_COLORS[t.status] ?? '#6B7280'
                    const isOverdue = t.dueDate && t.status !== 'done' && isPast(new Date(t.dueDate))
                    const isOpen = expandedId === t.id
                    const isSelected = selected.has(t.id)
                    return (
                        <div key={t.id} className={cn(isSelected && 'bg-primary/5')}>
                            <div className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-[#111] transition-colors group">
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleOne(t.id)}
                                    className="shrink-0 opacity-0 group-hover:opacity-100 data-[state=checked]:opacity-100 transition-opacity"
                                />
                                <button
                                    onClick={() => setExpandedId(isOpen ? null : t.id)}
                                    className="shrink-0 text-muted-foreground/30 hover:text-muted-foreground transition-colors"
                                >
                                    <ChevronRight className={cn('w-3.5 h-3.5 transition-transform duration-150', isOpen && 'rotate-90')} />
                                </button>
                                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                                {t.sequenceId && (
                                    <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-tighter shrink-0">
                                        TASK-{t.sequenceId}
                                    </span>
                                )}
                                <button
                                    onClick={() => router.push(`/${tenantSlug}/dashboard/board/${t.id}`)}
                                    className="text-sm text-foreground/80 flex-1 truncate text-left hover:text-foreground transition-colors"
                                >
                                    {t.title}
                                </button>
                                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_CONFIG[t.priority]?.color ?? '#6B7280' }} />
                                {t.dueDate && (
                                    <span className={cn('text-xs shrink-0', isOverdue ? 'text-red-400' : 'text-muted-foreground/50')}>
                                        {format(new Date(t.dueDate), 'MMM d')}
                                    </span>
                                )}
                            </div>
                            {isOpen && (
                                <div className="px-10 pb-3 pt-2 bg-[#0a0a0a] border-t border-[#1e1e1e] space-y-3">
                                    {t.description && (
                                        <p className="text-xs text-muted-foreground/60 leading-relaxed">{t.description}</p>
                                    )}
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1.5">Acceptance Criteria</p>
                                        {(t.acceptanceCriteria ?? []).map(ac => typeof ac === 'string' ? { text: ac, checked: false } : ac).filter(ac => ac.text?.trim()).length === 0 ? (
                                            <p className="text-xs text-muted-foreground/30 italic">No criteria defined</p>
                                        ) : (
                                            <div className="space-y-1">
                                                {(t.acceptanceCriteria ?? []).map(ac => typeof ac === 'string' ? { text: ac, checked: false } : ac).filter(ac => ac.text?.trim()).map((ac, i) => (
                                                    <div key={i} className="flex items-center gap-2">
                                                        <div className="w-3.5 h-3.5 rounded border border-[#2a2a2a] shrink-0" />
                                                        <span className="text-xs text-muted-foreground/60">{ac.text}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 pt-0.5">
                                        <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PRIORITY_CONFIG[t.priority]?.color ?? '#6B7280' }} />
                                            {PRIORITY_CONFIG[t.priority]?.label ?? t.priority}
                                        </span>
                                        <span className="text-xs text-muted-foreground/40">
                                            {t.estimatedHours && Number(t.estimatedHours) > 0 ? `${Number(t.estimatedHours)}h` : '—'}
                                        </span>
                                        <button
                                            onClick={() => router.push(`/${tenantSlug}/dashboard/board/${t.id}`)}
                                            className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors ml-auto"
                                        >
                                            Open in Board →
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Bulk action toolbar */}
            {selected.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5 shadow-2xl">
                    <span className="text-sm text-foreground font-medium">{selected.size} selected</span>
                    <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)} disabled={deleteTask.isPending}>
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Delete
                    </Button>
                    <button onClick={() => setSelected(new Set())} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <ConfirmDialog
                open={bulkDeleteOpen}
                onOpenChange={setBulkDeleteOpen}
                title={`Delete ${selected.size} task${selected.size !== 1 ? 's' : ''}?`}
                description="Selected tasks will be permanently deleted. This cannot be undone."
                confirmLabel="Delete"
                onConfirm={handleBulkDelete}
                loading={deleteTask.isPending}
            />
        </div>
    )
}

// ─── MilestoneDetailPage ──────────────────────────────────────────────────────

export default function MilestoneDetailPage() {
    const params = useParams()
    const tenantSlug = params.tenant as string
    const planId = params.planId as string
    const milestoneId = params.milestoneId as string
    const queryClient = useQueryClient()

    const [editingTitle, setEditingTitle] = useState(false)
    const [editingDesc, setEditingDesc] = useState(false)
    const [editingHours, setEditingHours] = useState(false)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftDesc, setDraftDesc] = useState('')
    const [draftHours, setDraftHours] = useState('')

    const patchMilestone = useMutation({
        mutationFn: (updates: { title?: string; description?: string | null; estimatedHours?: number | null; acceptanceCriteria?: AcCriterion[] }) =>
            api.patch(`/api/v1/milestones/${milestoneId}`, updates),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: pmKeys.milestones(planId) }),
        onError: () => toast.error('Failed to save milestone'),
    })

    const { data: planData } = useQuery<{ data: Plan }>({
        queryKey: pmKeys.plan(planId),
        queryFn: () => api.get(`/api/v1/plans/${planId}`),
    })

    // Fetch milestone from the milestones list — avoids an extra endpoint
    const { data: milestonesData, isLoading } = useQuery<{ data: Milestone[] }>({
        queryKey: pmKeys.milestones(planId),
        queryFn: () => api.get(`/api/v1/plans/${planId}/milestones`),
    })

    const plan = planData?.data
    const milestone = milestonesData?.data?.find(m => m.id === milestoneId)

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-7 w-48" />
            </div>
        )
    }

    if (!milestone) {
        return <p className="text-sm text-destructive">Milestone not found.</p>
    }

    const msCfg = MILESTONE_STATUS_CONFIG[milestone.status]
    const isOverdue = milestone.targetDate && milestone.status !== 'completed' && isPast(new Date(milestone.targetDate))

    return (
        <div className="flex flex-col">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
                <Link href={`/${tenantSlug}/dashboard/plans`} className="hover:text-foreground transition-colors">Plans</Link>
                <ChevronRight className="w-3 h-3" />
                <Link href={`/${tenantSlug}/dashboard/plans/${planId}`} className="hover:text-foreground transition-colors">
                    {plan?.title ?? 'Plan'}
                </Link>
                <ChevronRight className="w-3 h-3" />
                <span className="text-foreground">{milestone.title}</span>
            </nav>

            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-1">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground/50 uppercase tracking-tighter">MST-{milestone.sequenceId}</span>
                        <span className={cn('text-xs px-2 py-0.5 rounded font-medium', msCfg.bg, msCfg.color)}>
                            {msCfg.label}
                        </span>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PRIORITY_CONFIG[milestone.priority].color }} />
                        <span className="text-xs text-muted-foreground/60">{PRIORITY_CONFIG[milestone.priority].label}</span>
                        <span className="text-muted-foreground/30">·</span>
                        {editingHours ? (
                            <input
                                autoFocus
                                type="number"
                                min="0"
                                step="0.5"
                                value={draftHours}
                                onChange={e => setDraftHours(e.target.value)}
                                onBlur={() => {
                                    const h = draftHours === '' ? null : Number(draftHours)
                                    patchMilestone.mutate({ estimatedHours: h })
                                    setEditingHours(false)
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { const h = draftHours === '' ? null : Number(draftHours); patchMilestone.mutate({ estimatedHours: h }); setEditingHours(false) }
                                    if (e.key === 'Escape') setEditingHours(false)
                                }}
                                className="w-14 text-xs bg-transparent outline-none border-b border-primary/50 text-muted-foreground/60"
                            />
                        ) : (
                            <button
                                onClick={() => { setDraftHours(milestone.estimatedHours ? String(Number(milestone.estimatedHours)) : ''); setEditingHours(true) }}
                                className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                            >
                                <Clock className="w-3 h-3" />
                                <span>Estimated: {milestone.estimatedHours && Number(milestone.estimatedHours) > 0 ? `${Number(milestone.estimatedHours)}h` : '0h'}</span>
                            </button>
                        )}
                    </div>
                    {editingTitle ? (
                        <input
                            autoFocus
                            value={draftTitle}
                            onChange={e => setDraftTitle(e.target.value)}
                            onBlur={() => { const t = draftTitle.trim(); if (t && t !== milestone.title) patchMilestone.mutate({ title: t }); setEditingTitle(false) }}
                            onKeyDown={e => { if (e.key === 'Enter') { const t = draftTitle.trim(); if (t && t !== milestone.title) patchMilestone.mutate({ title: t }); setEditingTitle(false) } if (e.key === 'Escape') setEditingTitle(false) }}
                            className="text-xl font-semibold bg-transparent outline-none border-b border-primary/50 pb-0.5 w-full text-foreground"
                        />
                    ) : (
                        <h1
                            className="text-xl font-semibold text-foreground cursor-text hover:opacity-80 transition-opacity"
                            onClick={() => { setDraftTitle(milestone.title); setEditingTitle(true) }}
                        >
                            {milestone.title}
                        </h1>
                    )}
                    {editingDesc ? (
                        <textarea
                            autoFocus
                            value={draftDesc}
                            onChange={e => setDraftDesc(e.target.value)}
                            onBlur={() => { const d = draftDesc.trim(); if (d !== (milestone.description ?? '')) patchMilestone.mutate({ description: d || null }); setEditingDesc(false) }}
                            onKeyDown={e => { if (e.key === 'Escape') setEditingDesc(false) }}
                            rows={2}
                            placeholder="Add description…"
                            className="w-full mt-1 text-sm bg-transparent outline-none border-b border-primary/50 text-muted-foreground/70 resize-none placeholder:text-muted-foreground/30"
                        />
                    ) : (
                        <p
                            className="text-sm text-muted-foreground/70 mt-1 cursor-text hover:opacity-80 transition-opacity"
                            onClick={() => { setDraftDesc(milestone.description ?? ''); setEditingDesc(true) }}
                        >
                            {milestone.description || <span className="italic text-muted-foreground/30">Add description…</span>}
                        </p>
                    )}
                    <DefinitionOfDone
                        milestoneId={milestoneId}
                        planId={planId}
                        initial={milestone.acceptanceCriteria ?? []}
                        onSave={(criteria) => patchMilestone.mutate({ acceptanceCriteria: criteria })}
                    />
                </div>
                {milestone.targetDate && (
                    <span className={cn('text-xs shrink-0 flex items-center gap-1', isOverdue ? 'text-red-400' : 'text-muted-foreground/60')}>
                        <CalendarDays className="w-3.5 h-3.5" />
                        {format(new Date(milestone.targetDate), 'MMM d, yyyy')}
                    </span>
                )}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="board" className="mt-5">
                <TabsList className="bg-[#111] border border-[#1e1e1e]">
                    <TabsTrigger value="board">Board</TabsTrigger>
                    <TabsTrigger value="list">List</TabsTrigger>
                </TabsList>

                <TabsContent value="board" className="mt-4">
                    <BoardView
                        defaultMilestoneId={milestoneId}
                        defaultPlanId={planId}
                    />
                </TabsContent>

                <TabsContent value="list">
                    <ListTab milestoneId={milestoneId} tenantSlug={tenantSlug} />
                </TabsContent>
            </Tabs>

        </div>
    )
}
