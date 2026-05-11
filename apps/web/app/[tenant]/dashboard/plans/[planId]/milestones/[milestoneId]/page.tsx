'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format, isPast } from 'date-fns'
import { ChevronRight, CalendarDays, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { pmKeys } from '@/lib/query-keys/pm'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BoardView, CreateTaskDialog } from '@/components/platform/BoardView'

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
    totalTasks?: number
    completedTasks?: number
}

type MilestoneTask = {
    id: string
    sequenceId: number | null
    title: string
    status: string
    priority: Priority
    assigneeId: string | null
    dueDate: string | null
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

// ─── ListTab ──────────────────────────────────────────────────────────────────

function ListTab({ milestoneId, tenantSlug }: { milestoneId: string; tenantSlug: string }) {
    const router = useRouter()

    const { data, isLoading } = useQuery<{ data: MilestoneTask[] }>({
        queryKey: pmKeys.milestoneTasks(milestoneId),
        queryFn: () => api.get(`/api/v1/milestones/${milestoneId}/tasks`),
    })

    const tasks = data?.data ?? []

    if (isLoading) return (
        <div className="space-y-2 pt-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
    )

    if (tasks.length === 0) return (
        <p className="text-sm text-muted-foreground py-8 text-center">No tasks in this milestone yet</p>
    )

    return (
        <div className="pt-4 border border-[#1e1e1e] rounded-lg divide-y divide-[#1e1e1e]">
            {tasks.map(t => {
                const dotColor = TASK_STATUS_COLORS[t.status] ?? '#6B7280'
                const isOverdue = t.dueDate && t.status !== 'done' && isPast(new Date(t.dueDate))
                return (
                    <button
                        key={t.id}
                        onClick={() => router.push(`/${tenantSlug}/dashboard/board/${t.id}`)}
                        className="flex items-center gap-3 w-full text-left px-4 py-2.5 hover:bg-[#111] transition-colors"
                    >
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                        {t.sequenceId && (
                            <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-tighter shrink-0">
                                TASK-{t.sequenceId}
                            </span>
                        )}
                        <span className="text-sm text-foreground/80 flex-1 truncate">{t.title}</span>
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_CONFIG[t.priority]?.color ?? '#6B7280' }} />
                        {t.dueDate && (
                            <span className={cn('text-xs shrink-0', isOverdue ? 'text-red-400' : 'text-muted-foreground/50')}>
                                {format(new Date(t.dueDate), 'MMM d')}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

// ─── MilestoneDetailPage ──────────────────────────────────────────────────────

export default function MilestoneDetailPage() {
    const params = useParams()
    const tenantSlug = params.tenant as string
    const planId = params.planId as string
    const milestoneId = params.milestoneId as string
    const [createOpen, setCreateOpen] = useState(false)

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
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground/50 uppercase tracking-tighter">MST-{milestone.sequenceId}</span>
                        <span className={cn('text-xs px-2 py-0.5 rounded font-medium', msCfg.bg, msCfg.color)}>
                            {msCfg.label}
                        </span>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PRIORITY_CONFIG[milestone.priority].color }} />
                        <span className="text-xs text-muted-foreground/60">{PRIORITY_CONFIG[milestone.priority].label}</span>
                    </div>
                    <h1 className="text-xl font-semibold text-foreground">{milestone.title}</h1>
                    {milestone.description && (
                        <p className="text-sm text-muted-foreground/70 mt-1">{milestone.description}</p>
                    )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {milestone.targetDate && (
                        <span className={cn('text-xs flex items-center gap-1', isOverdue ? 'text-red-400' : 'text-muted-foreground/60')}>
                            <CalendarDays className="w-3.5 h-3.5" />
                            {format(new Date(milestone.targetDate), 'MMM d, yyyy')}
                        </span>
                    )}
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="w-4 h-4 mr-1.5" /> New Task
                    </Button>
                </div>
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

            <CreateTaskDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                defaultMilestoneId={milestoneId}
                defaultPlanId={planId}
            />
        </div>
    )
}
