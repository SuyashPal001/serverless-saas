'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
    ArrowLeft,
    Bot,
    User,
    Settings,
    ChevronDown,
    ChevronUp,
    Wrench,
    Loader2,
    AlertCircle,
    CheckSquare,
    Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

type AcceptanceCriterion = { text: string; checked: boolean }

type Task = {
    id: string
    agentId: string
    title: string
    description?: string | null
    status: 'backlog' | 'ready' | 'in_progress' | 'review' | 'blocked' | 'done' | 'cancelled'
    estimatedHours?: string | number | null
    confidenceScore?: string | number | null
    acceptanceCriteria?: AcceptanceCriterion[] | null
    planApprovedAt?: string | null
    blockedReason?: string | null
    createdAt: string
}

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
}

type TaskEvent = {
    id: string
    actorType: 'agent' | 'human' | 'system'
    eventType: string
    payload?: Record<string, unknown>
    createdAt: string
}

type TaskDetailResponse = {
    data: {
        task: Task
        steps: Step[]
        events: TaskEvent[]
    }
}

const STATUS_COLORS: Record<string, string> = {
    backlog:     'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    ready:       'bg-blue-500/10 text-blue-500 border-blue-500/20',
    in_progress: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    review:      'bg-purple-500/10 text-purple-500 border-purple-500/20',
    blocked:     'bg-red-500/10 text-red-500 border-red-500/20',
    done:        'bg-green-500/10 text-green-500 border-green-500/20',
    cancelled:   'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
}

const STATUS_LABELS: Record<string, string> = {
    backlog:     'Backlog',
    ready:       'Ready',
    in_progress: 'In Progress',
    review:      'Review',
    blocked:     'Blocked',
    done:        'Done',
    cancelled:   'Cancelled',
}

const STEP_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    running: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    done:    'bg-green-500/10 text-green-500 border-green-500/20',
    skipped: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    failed:  'bg-red-500/10 text-red-500 border-red-500/20',
}

const EVENT_LABELS: Record<string, string> = {
    status_changed:          'Status changed',
    plan_proposed:           'Plan proposed',
    plan_approved:           'Plan approved',
    plan_rejected:           'Plan rejected',
    clarification_requested: 'Asked for clarification',
    clarification_answered:  'Clarification provided',
    step_completed:          'Step completed',
    step_failed:             'Step failed',
    task_cancelled:          'Task cancelled',
    comment:                 'Comment',
}

function StepCard({ step }: { step: Step }) {
    const [showReasoning, setShowReasoning] = useState(false)
    const score = step.confidenceScore != null ? Number(step.confidenceScore) : null
    const hours = step.estimatedHours != null ? Number(step.estimatedHours) : null

    return (
        <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">#{step.stepNumber}</span>
                    <p className="font-medium text-sm text-foreground">{step.title}</p>
                </div>
                <Badge variant="outline" className={cn('text-xs shrink-0 capitalize', STEP_STATUS_COLORS[step.status])}>
                    {step.status}
                </Badge>
            </div>

            {step.description && (
                <p className="text-sm text-muted-foreground">{step.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {step.toolName && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                        <Wrench className="h-3 w-3" />
                        {step.toolName}
                    </span>
                )}
                {hours !== null && (
                    <span className="text-xs text-muted-foreground">~{hours}h</span>
                )}
            </div>

            {score !== null && (
                <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Confidence</span>
                        <span>{Math.round(score * 100)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                            className={cn(
                                'h-full rounded-full',
                                score >= 0.8 ? 'bg-green-500' : score >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                            )}
                            style={{ width: `${Math.round(score * 100)}%` }}
                        />
                    </div>
                </div>
            )}

            {step.reasoning && (
                <div>
                    <button
                        onClick={() => setShowReasoning(v => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {showReasoning
                            ? <ChevronUp className="h-3 w-3" />
                            : <ChevronDown className="h-3 w-3" />
                        }
                        Why this step?
                    </button>
                    {showReasoning && (
                        <p className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
                            {step.reasoning}
                        </p>
                    )}
                </div>
            )}

            {step.humanFeedback && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5">
                    <p className="text-xs text-amber-500 font-medium mb-1">Your feedback:</p>
                    <p className="text-xs text-muted-foreground">{step.humanFeedback}</p>
                </div>
            )}

            {step.agentOutput && (
                <div className="rounded-md bg-green-500/10 border border-green-500/20 p-2.5">
                    <p className="text-xs text-green-500 font-medium mb-1">Output:</p>
                    <p className="text-xs text-muted-foreground">{step.agentOutput}</p>
                </div>
            )}
        </div>
    )
}

function FeedbackDialog({
    open,
    onOpenChange,
    steps,
    taskId,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    steps: Step[]
    taskId: string
}) {
    const queryClient = useQueryClient()
    const [feedback, setFeedback] = useState<Record<string, string>>({})

    const { mutate, isPending } = useMutation({
        mutationFn: () =>
            api.put(`/api/v1/tasks/${taskId}/plan/approve`, {
                approved: false,
                stepFeedback: steps
                    .filter(s => feedback[s.id]?.trim())
                    .map(s => ({ stepId: s.id, feedback: feedback[s.id].trim() })),
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Feedback sent — agent is replanning')
            setFeedback({})
            onOpenChange(false)
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to submit feedback')
        },
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Request Changes</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                    <p className="text-sm text-muted-foreground">
                        Leave feedback for any steps you'd like the agent to reconsider.
                    </p>
                    {steps.map(step => (
                        <div key={step.id} className="space-y-1.5">
                            <Label className="text-sm font-medium text-foreground">
                                Step {step.stepNumber}: {step.title}
                            </Label>
                            <Textarea
                                placeholder="Feedback (optional)"
                                rows={2}
                                value={feedback[step.id] ?? ''}
                                onChange={e =>
                                    setFeedback(prev => ({ ...prev, [step.id]: e.target.value }))
                                }
                            />
                        </div>
                    ))}
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => mutate()} disabled={isPending}>
                            {isPending
                                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</>
                                : 'Submit Feedback'
                            }
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function TaskDetailView() {
    const params = useParams()
    const tenantSlug = params.tenant as string
    const taskId = params.taskId as string
    const queryClient = useQueryClient()

    const [feedbackOpen, setFeedbackOpen] = useState(false)
    const [clarificationAnswer, setClarificationAnswer] = useState('')

    const { data, isLoading, isError, error } = useQuery<TaskDetailResponse>({
        queryKey: ['task', taskId],
        queryFn: () => api.get<TaskDetailResponse>(`/api/v1/tasks/${taskId}`),
    })

    const { mutate: approvePlan, isPending: isApproving } = useMutation({
        mutationFn: () =>
            api.put(`/api/v1/tasks/${taskId}/plan/approve`, { approved: true }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Plan approved')
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to approve plan'),
    })

    const { mutate: clarify, isPending: isClarifying } = useMutation({
        mutationFn: (answer: string) =>
            api.post(`/api/v1/tasks/${taskId}/clarify`, { answer }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            toast.success('Answer sent — agent is planning')
            setClarificationAnswer('')
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to send answer'),
    })

    if (isLoading) {
        return (
            <div className="space-y-4 max-w-5xl">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-64 w-full rounded-lg" />
            </div>
        )
    }

    if (isError || !data?.data) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                    {error instanceof Error ? error.message : 'Failed to load task.'}
                </AlertDescription>
            </Alert>
        )
    }

    const { task, steps, events } = data.data
    const criteria = (task.acceptanceCriteria ?? []) as AcceptanceCriterion[]
    const estimatedHours = task.estimatedHours != null ? Number(task.estimatedHours) : null

    // Determine if clarification is pending (last relevant event is clarification_requested)
    let needsClarification = false
    let clarificationQuestions: string[] = []
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (ev.eventType === 'clarification_answered') break
        if (ev.eventType === 'clarification_requested') {
            needsClarification = true
            clarificationQuestions = (ev.payload?.questions as string[] | undefined) ?? []
            break
        }
    }

    const canApprove =
        (task.status === 'backlog' || task.status === 'blocked') &&
        steps.length > 0 &&
        !needsClarification

    return (
        <div className="max-w-5xl">
            <Link
                href={`/${tenantSlug}/dashboard/board`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to Board
            </Link>

            <div className="flex gap-8">
                {/* LEFT COLUMN */}
                <div className="flex-1 min-w-0 space-y-6">
                    {/* Header */}
                    <div className="space-y-3">
                        <Badge
                            variant="outline"
                            className={cn('text-xs', STATUS_COLORS[task.status])}
                        >
                            {STATUS_LABELS[task.status] ?? task.status}
                        </Badge>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            {task.title}
                        </h1>
                        {task.description && (
                            <p className="text-muted-foreground">{task.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <span>
                                Created{' '}
                                {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                            </span>
                            {estimatedHours !== null && (
                                <span>~{estimatedHours}h estimated</span>
                            )}
                        </div>
                    </div>

                    {/* Acceptance Criteria */}
                    {criteria.length > 0 && (
                        <div className="space-y-2">
                            <h2 className="text-sm font-semibold text-foreground">
                                Acceptance Criteria
                            </h2>
                            <ul className="space-y-1.5">
                                {criteria.map((c, i) => (
                                    <li
                                        key={i}
                                        className="flex items-start gap-2 text-sm text-muted-foreground"
                                    >
                                        {c.checked
                                            ? <CheckSquare className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                                            : <Square className="h-4 w-4 shrink-0 mt-0.5" />
                                        }
                                        <span>{c.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Plan */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-foreground">Agent's Plan</h2>

                        {steps.length === 0 ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                                {task.status === 'backlog' && (
                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                )}
                                <span>Agent is planning...</span>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {steps.map(step => (
                                    <StepCard key={step.id} step={step} />
                                ))}
                            </div>
                        )}

                        {canApprove && (
                            <div className="flex items-center gap-3 pt-2">
                                <Button
                                    onClick={() => approvePlan()}
                                    disabled={isApproving}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                    {isApproving
                                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Approving...</>
                                        : 'Approve Plan'
                                    }
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setFeedbackOpen(true)}
                                    disabled={isApproving}
                                >
                                    Request Changes
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Clarification */}
                    {needsClarification && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                                <p className="text-sm font-medium text-amber-500">
                                    Agent needs clarification
                                </p>
                            </div>
                            {clarificationQuestions.length > 0 && (
                                <ul className="space-y-1 pl-6 list-disc">
                                    {clarificationQuestions.map((q, i) => (
                                        <li key={i} className="text-sm text-muted-foreground">{q}</li>
                                    ))}
                                </ul>
                            )}
                            <div className="space-y-2">
                                <Label className="text-sm">Your answer</Label>
                                <Textarea
                                    placeholder="Provide your answer here..."
                                    rows={3}
                                    value={clarificationAnswer}
                                    onChange={e => setClarificationAnswer(e.target.value)}
                                />
                                <Button
                                    size="sm"
                                    onClick={() => clarify(clarificationAnswer)}
                                    disabled={isClarifying || !clarificationAnswer.trim()}
                                >
                                    {isClarifying
                                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</>
                                        : 'Send Answer'
                                    }
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT COLUMN — Activity */}
                <div className="w-72 shrink-0 space-y-3">
                    <h2 className="text-sm font-semibold text-foreground">Activity</h2>
                    {events.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No activity yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {events.map(event => {
                                const ActorIcon =
                                    event.actorType === 'agent' ? Bot
                                    : event.actorType === 'human' ? User
                                    : Settings

                                const payload = event.payload ?? {}
                                let payloadSummary: string | null = null
                                if (
                                    event.eventType === 'status_changed' &&
                                    payload.from !== undefined
                                ) {
                                    payloadSummary = `${String(payload.from ?? 'none')} → ${String(payload.to ?? '')}`
                                }

                                return (
                                    <div key={event.id} className="flex items-start gap-2.5">
                                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                                            <ActorIcon className="h-3 w-3 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-foreground">
                                                {EVENT_LABELS[event.eventType] ?? event.eventType}
                                            </p>
                                            {payloadSummary && (
                                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                                    {payloadSummary}
                                                </p>
                                            )}
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {formatDistanceToNow(new Date(event.createdAt), {
                                                    addSuffix: true,
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            <FeedbackDialog
                open={feedbackOpen}
                onOpenChange={setFeedbackOpen}
                steps={steps}
                taskId={taskId}
            />
        </div>
    )
}
