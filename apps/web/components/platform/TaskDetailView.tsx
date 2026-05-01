'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTaskStream } from '@/hooks/useTaskStream'
import { toast } from 'sonner'
import { AlertCircle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TaskHeader } from './task-detail/TaskHeader'
import { TaskSidebar } from './task-detail/TaskSidebar'
import { ActivityFeed } from './task-detail/ActivityFeed'
import { TaskMainContent } from './task-detail/TaskMainContent'
import type {
    Task, Step, TaskEvent, AgentsResponse, MembersResponse, Assignee, TaskDetailResponse,
} from '@/types/task'
import { validateAttachment, ATTACHMENT_ACCEPT } from '@/lib/attachmentValidation'

// Statuses at which task execution has ended — polling should stop
const STOP_POLLING_STATUSES = ['review', 'done', 'blocked', 'cancelled', 'awaiting_approval']

const normalizeUrl = (url: string): string => {
    const trimmed = url.trim()
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
const TERMINAL_STATUSES = ['done', 'cancelled', 'review']

export function TaskDetailView() {
    const params = useParams()
    const router = useRouter()
    const queryClient = useQueryClient()
    const taskId = params.taskId as string
    const tenantSlug = params.tenant as string

    useTaskStream(taskId)

    // ── Edit state ────────────────────────────────────────────────────────────
    const [isEditing, setIsEditing] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftDescription, setDraftDescription] = useState('')
    const [draftStatus, setDraftStatus] = useState<Task['status']>('backlog')
    const [draftPriority, setDraftPriority] = useState<Task['priority']>('medium')
    const [draftAssigneeKey, setDraftAssigneeKey] = useState('unassigned')
    const [draftStartedAt, setDraftStartedAt] = useState('')
    const [draftDueDate, setDraftDueDate] = useState('')
    const [draftEstimatedHours, setDraftEstimatedHours] = useState('')

    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)

    // ── Refs ──────────────────────────────────────────────────────────────────
    const attachFileInputRef = useRef<HTMLInputElement>(null)
    const newLinkInputRef = useRef<HTMLInputElement>(null)
    const referenceTextRef = useRef<HTMLTextAreaElement>(null)
    const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const previousStepsRef = useRef<Record<string, {
        liveActivity?: any[]
        liveText?: string
        agentThinking?: boolean
    }>>({})

    // ── Live-field merge selector ─────────────────────────────────────────────
    // Runs on every cache read — including window-focus refetches and mutation
    // invalidations — and restores WS-written fields that the server doesn't return.
    // Order: prefer the value from cache (set by WS handlers) over the ref backup.
    // The ref backup only kicks in when the field is undefined (i.e. after a server fetch wiped it).
    const selectWithLiveFields = useCallback((raw: TaskDetailResponse) => {
        if (!raw?.data?.steps) return raw
        return {
            ...raw,
            data: {
                ...raw.data,
                steps: raw.data.steps.map((step: any) => {
                    const prev = previousStepsRef.current[step.id]
                    if (!prev) return step
                    return {
                        ...step,
                        liveActivity: step.liveActivity ?? prev.liveActivity,
                        liveText: step.liveText ?? prev.liveText,
                        agentThinking: step.agentThinking ?? prev.agentThinking,
                    }
                }),
            },
        }
    // previousStepsRef is a stable ref — its .current is always up-to-date without
    // needing to be in the dep array, and keeping the callback stable avoids TQ
    // re-running the selector when only the ref changes (not the underlying data).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Queries ───────────────────────────────────────────────────────────────
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
        select: selectWithLiveFields,
        refetchOnWindowFocus: false,
    })

    const task = data?.data?.task
    const steps: Step[] = data?.data?.steps ?? []
    const events: TaskEvent[] = data?.data?.events ?? []
    const agent = data?.data?.agent
    const assignee = data?.data?.assignee

    // ── Polling effect — copied exactly from monolith ─────────────────────────
    useEffect(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
        }

        if (task?.status && STOP_POLLING_STATUSES.includes(task.status)) {
            if (TERMINAL_STATUSES.includes(task.status)) {
                queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            }
            return
        }

        if (!task?.id) return
        if (task.status !== 'in_progress' && task.status !== 'ready' && task.status !== 'planning') return

        pollingIntervalRef.current = setInterval(async () => {
            try {
                const fresh = await api.get<TaskDetailResponse>(`/api/v1/tasks/${taskId}`)
                const newStatus = fresh?.data?.task?.status
                // During planning, WS events own the step cache. Do NOT call setQueryData
                // with DB data here — the backend may not have cleared old steps yet (e.g.
                // after clarification answered), so writing fresh would restore stale steps.
                // Once status changes away from 'planning', write the fresh response but
                // preserve WS-streamed steps if DB hasn't committed them yet (freshSteps
                // empty while cache already has steps from task.step.created events).
                if (newStatus !== 'planning') {
                    const current = queryClient.getQueryData<any>(['task', taskId])
                    const cachedSteps = current?.data?.steps ?? []
                    const freshSteps = fresh.data?.steps ?? []
                    const mergedSteps = freshSteps.length > 0 ? freshSteps : cachedSteps
                    queryClient.setQueryData(['task', taskId], {
                        ...fresh,
                        data: { ...fresh.data, steps: mergedSteps },
                    })
                }
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

    // ── Draft sync effect — initialises all editable fields when task loads ───
    useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task?.id])

    // ── Live fields ref sync — preserve WS-written fields across server refetches ─
    useEffect(() => {
        if (!steps) return
        steps.forEach((step: any) => {
            if (['done', 'failed', 'skipped'].includes(step.status)) {
                delete previousStepsRef.current[step.id]
            } else if (step.liveActivity || step.liveText || step.agentThinking) {
                previousStepsRef.current[step.id] = {
                    liveActivity: step.liveActivity,
                    liveText: step.liveText,
                    agentThinking: step.agentThinking,
                }
            }
        })
    }, [steps])

    // ── Derived assignee ──────────────────────────────────────────────────────
    const selectedAssignee = useMemo((): Assignee | null => {
        if (!task) return null
        if (task.assigneeId) {
            return assigneeOptions.find(o => o.type === 'member' && o.id === task.assigneeId)
                ?? (assignee ? { type: 'member', id: task.assigneeId, name: assignee.name } : null)
        }
        if (task.agentId) {
            return assigneeOptions.find(o => o.type === 'agent' && o.id === task.agentId)
                ?? (agent ? { type: 'agent', id: task.agentId, name: agent.name } : null)
        }
        return null
    }, [task?.assigneeId, task?.agentId, assigneeOptions, assignee, agent])

    // ── Mutations ─────────────────────────────────────────────────────────────
    const patchTask = useMutation({
        mutationFn: (updates: Partial<{
            title: string; description: string | null; status: string; priority: string
            estimatedHours: number | null; acceptanceCriteria: { text: string; checked: boolean }[]
            dueDate: string | null; startedAt: string | null; links: string[]
            attachmentFileIds: string[]; assigneeId: string | null; agentId: string | null
            referenceText: string | null
        }>) => api.patch(`/api/v1/tasks/${taskId}`, updates),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        onError: (err: any) => toast.error(err.message || 'Failed to save change'),
    })

    const voteMutation = useMutation({
        mutationFn: (type: 'up' | 'down') => api.post(`/api/v1/tasks/${taskId}/vote`, { type }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        onError: (err: any) => toast.error(err.message || 'Failed to vote'),
    })

    const deleteTaskMutation = useMutation({
        mutationFn: () => api.del(`/api/v1/tasks/${taskId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task deleted')
            router.push(`/${tenantSlug}/dashboard/board`)
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to delete task'),
    })

    const approvePlanMutation = useMutation({
        mutationFn: (payload: { approved: boolean; feedback?: Record<string, string>; generalInstruction?: string }) => {
            const stepFeedback = payload.feedback
                ? Object.entries(payload.feedback).filter(([, text]) => text.trim()).map(([stepId, feedback]) => ({ stepId, feedback }))
                : undefined
            const extraContext = payload.generalInstruction?.trim() || undefined
            return api.put(`/api/v1/tasks/${taskId}/plan/approve`, { approved: payload.approved, stepFeedback, extraContext })
        },
        onSuccess: (_, variables) => {
            if (!variables.approved) {
                queryClient.setQueryData(['task', taskId], (old: any) => {
                    if (!old?.data) return old
                    return {
                        ...old,
                        data: { ...old.data, steps: [], task: { ...old.data.task, status: 'planning' } },
                    }
                })
                // No invalidateQueries — WS events will stream new steps as they arrive
            } else {
                queryClient.invalidateQueries({ queryKey: ['task', taskId] })
            }
            toast.success(variables.approved ? 'Plan approved' : 'Feedback sent, agent is replanning.')
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to send feedback'),
    })

    const clarifyMutation = useMutation({
        mutationFn: (answer: string) => api.post(`/api/v1/tasks/${taskId}/clarify`, { answer }),
        onSuccess: () => {
            // Clear steps immediately — the backend has not yet deleted old steps when this
            // fires, so invalidateQueries would refetch stale steps and undo the WS-driven
            // status=planning clear. New steps arrive via task.step.created WS events.
            queryClient.setQueryData(['task', taskId], (old: any) => {
                if (!old?.data) return old
                return {
                    ...old,
                    data: { ...old.data, steps: [], task: { ...old.data.task, status: 'planning' } },
                }
            })
            toast.success('Answer sent — agent is planning')
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to send answer'),
    })

    const generatePlanMutation = useMutation({
        mutationFn: () => api.post(`/api/v1/tasks/${taskId}/plan`),
        onSuccess: () => {
            queryClient.setQueryData(['task', taskId], (old: any) => {
                if (!old?.data) return old
                return {
                    ...old,
                    data: {
                        ...old.data,
                        steps: [],
                        task: { ...old.data.task, status: 'planning' },
                    },
                }
            })
        },
        onError: (err: any) => toast.error(err?.data?.error || 'Failed to generate plan'),
    })

    // ── Attachment upload ─────────────────────────────────────────────────────
    const handleAttachmentUpload = async (file: File) => {
        const validation = validateAttachment(file)
        if (!validation.valid) {
            toast.error(validation.error)
            return
        }

        setIsUploadingAttachment(true)
        try {
            const { data: fileData } = await api.post<{ data: { fileId: string; uploadUrl: string } }>(
                '/api/v1/files/upload',
                { filename: file.name, contentType: file.type || 'application/octet-stream' }
            )
            await fetch(fileData.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
            })
            await api.post(`/api/v1/files/${fileData.fileId}/confirm`, { size: file.size })
            patchTask.mutate({ attachmentFileIds: [...(task?.attachmentFileIds ?? []), fileData.fileId] })
            toast.success('File attached')
        } catch (err: any) {
            toast.error(err.message || 'Failed to upload attachment')
        } finally {
            setIsUploadingAttachment(false)
            if (attachFileInputRef.current) attachFileInputRef.current.value = ''
        }
    }

    // ── Save edits ────────────────────────────────────────────────────────────
    const saveEdits = async () => {
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
        if (draftStartedAt !== origStart) updates.startedAt = draftStartedAt ? new Date(draftStartedAt).toISOString() : null
        if (draftDueDate !== origDue) updates.dueDate = draftDueDate ? new Date(draftDueDate).toISOString() : null

        const origHours = task.estimatedHours != null ? String(task.estimatedHours) : ''
        if (draftEstimatedHours !== origHours) {
            const h = parseFloat(draftEstimatedHours)
            updates.estimatedHours = draftEstimatedHours && !isNaN(h) ? h : null
        }

        if (Object.keys(updates).length > 0) {
            await patchTask.mutateAsync(updates)
        }
    }

    // ── Task operations ───────────────────────────────────────────────────────
    const taskOperations = useMemo(() => ({
        approvePlan: async (opts?: { approved: boolean; feedback?: Record<string, string>; generalInstruction?: string }) => { await approvePlanMutation.mutateAsync(opts ?? { approved: true }) },
        rejectPlan: async (feedback?: string) => { await approvePlanMutation.mutateAsync({ approved: false, generalInstruction: feedback?.trim() || undefined }) },
        generatePlan: async () => { await generatePlanMutation.mutateAsync() },
        sendClarification: async (answer: string) => { await clarifyMutation.mutateAsync(answer) },
        markDone: async () => { await patchTask.mutateAsync({ status: 'done' }) },
        updateTitle: async (title: string) => { await patchTask.mutateAsync({ title }) },
        updateDescription: async (desc: string) => { await patchTask.mutateAsync({ description: desc || null }) },
        deleteTask: async () => { await deleteTaskMutation.mutateAsync() },
        vote: async (direction: 'up' | 'down') => { await voteMutation.mutateAsync(direction) },
        addLink: (url: string) => patchTask.mutate({ links: [...(task?.links ?? []), normalizeUrl(url)] }),
        removeLink: (url: string) => patchTask.mutate({ links: (task?.links ?? []).filter(l => l !== url) }),
        addAttachment: handleAttachmentUpload,
        removeAttachment: (fileId: string) =>
            patchTask.mutate({ attachmentFileIds: (task?.attachmentFileIds ?? []).filter(id => id !== fileId) }),
        saveReferenceText: (text: string | null) => patchTask.mutate({ referenceText: text }),
        startTask: () => patchTask.mutate({ status: 'in_progress', startedAt: new Date().toISOString() }),
        updateCriteria: (criteria: { text: string; checked: boolean }[]) =>
            patchTask.mutate({ acceptanceCriteria: criteria }),
        focusLinkInput: () => {
            document.getElementById('links-section')?.scrollIntoView({ behavior: 'smooth' })
            setTimeout(() => newLinkInputRef.current?.focus(), 300)
        },
        focusReferenceInput: () => {
            document.getElementById('reference-section')?.scrollIntoView({ behavior: 'smooth' })
            setTimeout(() => referenceTextRef.current?.focus(), 300)
        },
        triggerAttachFile: () => attachFileInputRef.current?.click(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [taskId, patchTask, voteMutation, task?.links, task?.attachmentFileIds])

    // ── Edit state object ─────────────────────────────────────────────────────
    const editState = {
        isEditing,
        isSaving,
        draftStatus,
        draftPriority,
        draftAssigneeKey,
        setDraftStatus: (v: string) => setDraftStatus(v as Task['status']),
        setDraftPriority: (v: string) => setDraftPriority(v as Task['priority']),
        setDraftAssigneeKey,
        onEdit: () => setIsEditing(true),
        onCancel: () => {
            setIsEditing(false)
            if (task) {
                setDraftStatus(task.status)
                setDraftPriority(task.priority)
                setDraftAssigneeKey(
                    task.assigneeId ? `member:${task.assigneeId}`
                    : task.agentId ? `agent:${task.agentId}`
                    : 'unassigned'
                )
            }
        },
        onSave: async () => {
            setIsSaving(true)
            try { await saveEdits() } finally { setIsSaving(false) }
            setIsEditing(false)
        },
    }

    // ── Loading / error ───────────────────────────────────────────────────────
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

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            <input
                type="file"
                ref={attachFileInputRef}
                className="hidden"
                accept={ATTACHMENT_ACCEPT}
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleAttachmentUpload(file)
                }}
            />
            <TaskHeader task={task} editState={editState} taskOperations={taskOperations} />
            <div className="flex flex-1 min-h-0 overflow-hidden">
                <TaskMainContent
                    task={task}
                    steps={steps}
                    events={events}
                    taskId={taskId}
                    taskOperations={taskOperations}
                    editState={editState}
                />
                <TaskSidebar
                    task={task}
                    steps={steps}
                    editState={editState}
                    taskOperations={taskOperations}
                    assigneeOptions={assigneeOptions}
                    selectedAssignee={selectedAssignee}
                    isUploadingAttachment={isUploadingAttachment}
                    attachFileInputRef={attachFileInputRef}
                    newLinkInputRef={newLinkInputRef}
                    referenceTextRef={referenceTextRef}
                />
            </div>
        </div>
    )
}
