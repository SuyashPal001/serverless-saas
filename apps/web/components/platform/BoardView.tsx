'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, KanbanSquare, X, Loader2, AlertCircle } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

type Task = {
    id: string
    agentId: string
    title: string
    description?: string | null
    status: 'backlog' | 'ready' | 'in_progress' | 'review' | 'blocked' | 'done' | 'cancelled'
    estimatedHours?: string | number | null
    confidenceScore?: string | number | null
    totalSteps: number
    completedSteps: number
    createdAt: string
    planApprovedAt?: string | null
    blockedReason?: string | null
}

type TasksResponse = { data: Task[] }
type AgentsResponse = { data: { id: string; name: string; status: string }[] }

const COLUMNS: { status: Task['status']; label: string }[] = [
    { status: 'backlog',     label: 'Backlog' },
    { status: 'ready',       label: 'Ready' },
    { status: 'in_progress', label: 'In Progress' },
    { status: 'review',      label: 'Review' },
    { status: 'blocked',     label: 'Blocked' },
    { status: 'done',        label: 'Done' },
]

const createTaskSchema = z.object({
    agentId: z.string().min(1, 'Please select an agent'),
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().optional(),
    estimatedHours: z.string().optional(),
    acceptanceCriteria: z.array(z.object({ text: z.string() })),
})
type CreateTaskForm = z.infer<typeof createTaskSchema>

function ConfidenceDot({ score }: { score: number }) {
    const color = score >= 0.8 ? 'bg-green-500' : score >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
    return (
        <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full shrink-0', color)} />
            <span className="text-xs text-muted-foreground">{Math.round(score * 100)}%</span>
        </div>
    )
}

function TaskCard({ task, tenantSlug }: { task: Task; tenantSlug: string }) {
    const score = task.confidenceScore != null ? Number(task.confidenceScore) : null

    const inner = (
        <Link href={`/${tenantSlug}/dashboard/board/${task.id}`}>
            <div className={cn(
                'rounded-lg border border-border bg-card p-3 hover:shadow-md transition-shadow cursor-pointer',
                task.status === 'blocked' && 'border-l-4 border-l-amber-500',
            )}>
                <p className="font-medium text-sm text-foreground leading-snug">{task.title}</p>
                {task.description && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{task.description}</p>
                )}
                <div className="flex items-center justify-between mt-2.5">
                    <div>
                        {score !== null && <ConfidenceDot score={score} />}
                    </div>
                    {task.totalSteps > 0 && (
                        <span className="text-xs text-muted-foreground">
                            {task.completedSteps}/{task.totalSteps} steps
                        </span>
                    )}
                </div>
            </div>
        </Link>
    )

    if (task.status === 'blocked' && task.blockedReason) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <div>{inner}</div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{task.blockedReason}</TooltipContent>
            </Tooltip>
        )
    }

    return inner
}

function CreateTaskDialog({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
}) {
    const queryClient = useQueryClient()

    const { data: agentsData } = useQuery<AgentsResponse>({
        queryKey: ['agents'],
        queryFn: () => api.get<AgentsResponse>('/api/v1/agents'),
        enabled: open,
    })

    const agents = agentsData?.data?.filter(a => a.status === 'active') ?? []

    const {
        register,
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<CreateTaskForm>({
        resolver: zodResolver(createTaskSchema),
        defaultValues: { acceptanceCriteria: [] as { text: string }[] },
    })

    const { fields, append, remove } = useFieldArray({ control, name: 'acceptanceCriteria' })

    const { mutate, isPending } = useMutation({
        mutationFn: (payload: {
            agentId: string
            title: string
            description?: string
            estimatedHours?: number
            acceptanceCriteria: { text: string; checked: boolean }[]
        }) => api.post('/api/v1/tasks', payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task created — agent is planning')
            reset()
            onOpenChange(false)
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to create task')
        },
    })

    const onSubmit = (data: CreateTaskForm) => {
        const hours = data.estimatedHours ? parseFloat(data.estimatedHours) : undefined
        mutate({
            agentId: data.agentId,
            title: data.title,
            description: data.description || undefined,
            estimatedHours: hours && !isNaN(hours) ? hours : undefined,
            acceptanceCriteria: data.acceptanceCriteria
                .filter(c => c.text.trim())
                .map(c => ({ text: c.text.trim(), checked: false })),
        })
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New Task</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="ct-title">Title *</Label>
                        <Input
                            id="ct-title"
                            placeholder="What should the agent do?"
                            {...register('title')}
                        />
                        {errors.title && (
                            <p className="text-xs text-destructive">{errors.title.message}</p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="ct-desc">Description</Label>
                        <Textarea
                            id="ct-desc"
                            placeholder="Additional context..."
                            rows={3}
                            {...register('description')}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>Agent *</Label>
                        <Controller
                            control={control}
                            name="agentId"
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select an agent" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {agents.map(agent => (
                                            <SelectItem key={agent.id} value={agent.id}>
                                                {agent.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.agentId && (
                            <p className="text-xs text-destructive">{errors.agentId.message}</p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="ct-hours">Estimated Hours</Label>
                        <Input
                            id="ct-hours"
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="e.g. 2"
                            {...register('estimatedHours')}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Acceptance Criteria</Label>
                        <div className="space-y-2">
                            {fields.map((field, index) => (
                                <div key={field.id} className="flex items-center gap-2">
                                    <Input
                                        placeholder={`Criterion ${index + 1}`}
                                        {...register(`acceptanceCriteria.${index}.text`)}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0"
                                        onClick={() => remove(index)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => append({ text: '' })}
                        >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Add criterion
                        </Button>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => { reset(); onOpenChange(false) }}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending
                                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Planning...</>
                                : 'Create Task'
                            }
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export function BoardView() {
    const params = useParams()
    const tenantSlug = params.tenant as string
    const [createOpen, setCreateOpen] = useState(false)

    const { data, isLoading, isError, error } = useQuery<TasksResponse>({
        queryKey: ['tasks'],
        queryFn: () => api.get<TasksResponse>('/api/v1/tasks'),
    })

    const tasks = data?.data ?? []

    if (isError) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Board</h1>
                    <p className="text-muted-foreground mt-2">Assign tasks to your AI agents and track progress</p>
                </div>
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        {error instanceof Error ? error.message : 'Failed to load tasks. Please try again.'}
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Board</h1>
                    <p className="text-muted-foreground mt-2">Assign tasks to your AI agents and track progress</p>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4">
                    {COLUMNS.map(col => (
                        <div key={col.status} className="w-64 shrink-0">
                            <Skeleton className="h-7 w-28 mb-3" />
                            <div className="space-y-2">
                                <Skeleton className="h-20 w-full rounded-lg" />
                                <Skeleton className="h-20 w-full rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (tasks.length === 0) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Board</h1>
                        <p className="text-muted-foreground mt-2">Assign tasks to your AI agents and track progress</p>
                    </div>
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Task
                    </Button>
                </div>
                <div className="flex h-[350px] shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20">
                    <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-4">
                            <KanbanSquare className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold text-foreground">No tasks yet</h3>
                        <p className="mb-6 mt-2 text-sm text-muted-foreground">
                            Create your first task and assign it to an agent
                        </p>
                        <Button onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-2 h-4 w-4" />
                            New Task
                        </Button>
                    </div>
                </div>
                <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
            </div>
        )
    }

    return (
        <TooltipProvider>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Board</h1>
                        <p className="text-muted-foreground mt-2">Assign tasks to your AI agents and track progress</p>
                    </div>
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Task
                    </Button>
                </div>

                <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
                    {COLUMNS.map(col => {
                        const colTasks = tasks.filter(t => t.status === col.status)
                        return (
                            <div key={col.status} className="w-64 shrink-0 flex flex-col">
                                <div className="flex items-center gap-2 mb-3 px-0.5">
                                    <span className="text-sm font-semibold text-foreground">{col.label}</span>
                                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                                        {colTasks.length}
                                    </Badge>
                                </div>
                                <div className="flex flex-col gap-2 min-h-[120px]">
                                    {colTasks.map(task => (
                                        <TaskCard key={task.id} task={task} tenantSlug={tenantSlug} />
                                    ))}
                                    {col.status === 'backlog' && (
                                        <button
                                            onClick={() => setCreateOpen(true)}
                                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Add Task
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>

                <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
            </div>
        </TooltipProvider>
    )
}
