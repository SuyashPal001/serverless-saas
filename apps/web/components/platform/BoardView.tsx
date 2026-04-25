'use client'

import React, { useState, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
    Plus, X, Loader2, AlertCircle,
    AlertTriangle, Bot, LayoutList, GripVertical, Search,
    Maximize2, MoreHorizontal, Clock, ChevronDown, ChevronUp,
    Link2, Paperclip, FileText, User,
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
    DialogDescription,
    DialogFooter,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type Task = {
    id: string
    agentId: string | null
    assigneeId: string | null
    title: string
    description?: string | null
    status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'blocked' | 'done' | 'cancelled'
    priority: 'low' | 'medium' | 'high' | 'urgent'
    estimatedHours?: string | number | null
    confidenceScore?: string | number | null
    totalSteps: number
    completedSteps: number
    createdAt: string
    planApprovedAt?: string | null
    blockedReason?: string | null
    dueDate?: string | null
    upvotes: number
    downvotes: number
    links: string[]
    sortOrder: number
}

type TasksResponse = { data: Task[] }
type AgentsResponse = { data: { id: string; name: string; status: string }[] }
type MembersResponse = { data: { userId: string; userName: string | null; userEmail: string; roleName: string }[] }

type Assignee = { type: 'agent'; id: string; name: string } | { type: 'member'; id: string; name: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
    backlog:     { label: 'Backlog',     color: '#6B7280', bg: 'bg-gray-500/10',    text: 'text-gray-400' },
    todo:        { label: 'Todo',        color: '#3B82F6', bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    in_progress: { label: 'In Progress', color: '#8B5CF6', bg: 'bg-purple-500/10',  text: 'text-purple-400' },
    review:      { label: 'Review',      color: '#F59E0B', bg: 'bg-amber-500/10',   text: 'text-amber-400' },
    blocked:     { label: 'Blocked',     color: '#EF4444', bg: 'bg-red-500/10',     text: 'text-red-400' },
    done:        { label: 'Done',        color: '#10B981', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    cancelled:   { label: 'Cancelled',   color: '#6B7280', bg: 'bg-gray-500/10',    text: 'text-gray-400' },
} as const

const PRIORITY_CONFIG = {
    low:    { label: 'Low',    color: '#6B7280', text: 'text-gray-400' },
    medium: { label: 'Medium', color: '#3B82F6', text: 'text-blue-400' },
    high:   { label: 'High',   color: '#F59E0B', text: 'text-amber-400' },
    urgent: { label: 'Urgent', color: '#EF4444', text: 'text-red-400' },
} as const

const COLUMNS: Task['status'][] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked']

// ─── Schema ───────────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().optional(),
    estimatedHours: z.string().optional(),
    acceptanceCriteria: z.array(z.object({ text: z.string() })),
})
type CreateTaskForm = z.infer<typeof createTaskSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString)
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

const StatusIcon = ({ status }: { status: string }) => {
  const configs = {
    backlog: <circle cx="12" cy="12" r="9" stroke="#6B7280" strokeWidth="1.5" strokeDasharray="4 2" fill="none"/>,
    todo: <circle cx="12" cy="12" r="9" stroke="#3B82F6" strokeWidth="1.5" fill="none"/>,
    in_progress: <>
      <circle cx="12" cy="12" r="9" stroke="#8B5CF6" strokeWidth="1.5" fill="none"/>
      <circle cx="12" cy="12" r="4" fill="#8B5CF6"/>
    </>,
    review: <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="1.5" fill="none"/>,
    blocked: <circle cx="12" cy="12" r="9" stroke="#EF4444" strokeWidth="1.5" fill="none"/>,
    done: <>
      <circle cx="12" cy="12" r="9" fill="#10B981"/>
      <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>,
    cancelled: <circle cx="12" cy="12" r="9" stroke="#6B7280" strokeWidth="1.5" fill="none"/>,
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      {configs[status as keyof typeof configs] ?? configs.backlog}
    </svg>
  )
}

function TaskCard({ 
    task, 
    tenantSlug, 
    taskNumber,
    members,
    agents
}: { 
    task: Task; 
    tenantSlug: string; 
    taskNumber: number;
    members: MembersResponse['data'];
    agents: AgentsResponse['data'];
}) {
    const score = task.confidenceScore != null ? Number(task.confidenceScore) : null
    const dotColor = score === null ? '' : score >= 0.8 ? 'bg-green-500' : score >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
    const statusLabel = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]?.label ?? 'Unknown';

    // Resolve assignee
    let assigneeInfo: { name: string; type: 'member' | 'agent' } | null = null
    if (task.assigneeId) {
        const member = members.find(m => m.userId === task.assigneeId)
        if (member) {
            assigneeInfo = { name: member.userName || member.userEmail, type: 'member' }
        }
    } else if (task.agentId) {
        const agent = agents.find(a => a.id === task.agentId)
        if (agent) {
            assigneeInfo = { name: agent.name, type: 'agent' }
        }
    }

    const getInitials = (name: string) => {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }

    const card = (
        <Link 
            href={`/${tenantSlug}/dashboard/board/${task.id}`} 
            className="block"
            draggable={true}
            onDragStart={(e) => {
                e.dataTransfer.setData('taskId', task.id)
                e.currentTarget.style.opacity = '0.4'
            }}
            onDragEnd={(e) => {
                e.currentTarget.style.opacity = '1'
            }}
        >
            <div className="group bg-[#1C1C1E] border border-transparent rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-border transition-colors relative">
                {/* Row 1 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={cn("w-1.5 h-1.5 rounded-full", task.priority === 'urgent' && "animate-pulse")} style={{ backgroundColor: PRIORITY_CONFIG[task.priority]?.color }} />
                        <span className="text-xs text-muted-foreground/60 font-medium uppercase tracking-tighter">TASK-{taskNumber}</span>
                    </div>
                    <MoreHorizontal className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Row 2: Title */}
                <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 mt-1">
                    {task.title}
                </p>

                {/* Row 3: status + metadata pills */}
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted/50 text-muted-foreground">
                        <StatusIcon status={task.status} />
                        <span>{statusLabel}</span>
                    </div>
                    {task.estimatedHours && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted/50 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{task.estimatedHours}h</span>
                        </div>
                    )}
                    {score !== null && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted/50 text-muted-foreground">
                            <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
                            <span>{Math.round(score * 100)}%</span>
                        </div>
                    )}
                </div>

                {/* Row 4: bottom metadata */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {task.totalSteps > 0 && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted/50 text-muted-foreground">
                            <LayoutList className="w-3.5 h-3.5" />
                            <span>{task.completedSteps}/{task.totalSteps} steps</span>
                        </div>
                    )}
                </div>

                {/* Assignee Avatar - Absolute Position Bottom Right */}
                {assigneeInfo && (
                    <div className="absolute bottom-3 right-3">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={cn(
                                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border border-[#2a2a2a] overflow-hidden",
                                    assigneeInfo.type === 'agent' 
                                        ? "bg-indigo-500/20 text-indigo-400" 
                                        : "bg-[#2a2a2a] text-muted-foreground"
                                )}>
                                    {assigneeInfo.type === 'agent' ? (
                                        <Bot className="w-3 h-3" />
                                    ) : (
                                        <span>{getInitials(assigneeInfo.name)}</span>
                                    )}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <p className="text-[11px] font-medium">{assigneeInfo.name}</p>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                )}
            </div>
        </Link>
    )

    if (task.status === 'blocked' && task.blockedReason) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <div>{card}</div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{task.blockedReason}</TooltipContent>
            </Tooltip>
        )
    }

    return card
}

// ─── CreateTaskDialog ─────────────────────────────────────────────────────────

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

    const { data: membersData } = useQuery<MembersResponse>({
        queryKey: ['members'],
        queryFn: () => api.get<MembersResponse>('/api/v1/members'),
        enabled: open,
    })

    const activeAgents = agentsData?.data?.filter(a => a.status === 'active') ?? []
    const members = membersData?.data ?? []

    const assigneeOptions: Assignee[] = [
        ...members.map(m => ({ type: 'member' as const, id: m.userId, name: m.userName || m.userEmail })),
        ...activeAgents.map(a => ({ type: 'agent' as const, id: a.id, name: a.name })),
    ]

    const [selectedAssignee, setSelectedAssignee] = useState<Assignee | null>(null)
    const [hoursEditing, setHoursEditing] = useState(false)

    const {
        register,
        control,
        handleSubmit,
        reset,
        watch,
        formState: { errors },
    } = useForm<CreateTaskForm>({
        resolver: zodResolver(createTaskSchema),
        defaultValues: { acceptanceCriteria: [] as { text: string }[] },
    })

    const estimatedHoursVal = watch('estimatedHours')

    const [criteriaExpanded, setCriteriaExpanded] = useState(false)
    const [links, setLinks] = useState<{ url: string; title: string }[]>([])
    const [linkDialogOpen, setLinkDialogOpen] = useState(false)
    const [references, setReferences] = useState<string[]>([])
    const [referenceDialogOpen, setReferenceDialogOpen] = useState(false)
    const [attachmentFileIds, setAttachmentFileIds] = useState<{ fileId: string; name: string; size: number; type: string }[]>([])
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
    const attachFileInputRef = useRef<HTMLInputElement>(null)

    const { fields, append, remove } = useFieldArray({ control, name: 'acceptanceCriteria' })

    const handleAttachmentUpload = async (file: File) => {
        setIsUploadingAttachment(true)
        try {
            // 1. Get signed URL
            const { data } = await api.post<{ data: { fileId: string; uploadUrl: string } }>(
                '/api/v1/files/upload',
                { filename: file.name, contentType: file.type || 'application/octet-stream' }
            )

            // 2. Upload to S3/Storage
            const uploadRes = await fetch(data.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
            })

            if (!uploadRes.ok) throw new Error('Upload failed')

            // 3. Confirm upload
            await api.post(`/api/v1/files/confirm/${data.fileId}`, {})

            setAttachmentFileIds(prev => [...prev, {
                fileId: data.fileId,
                name: file.name,
                size: file.size,
                type: file.type
            }])
            toast.success(`Attached ${file.name}`)
        } catch (error) {
            console.error('Upload failed:', error)
            toast.error('Failed to upload attachment')
        } finally {
            setIsUploadingAttachment(false)
        }
    }

    const { mutate, isPending } = useMutation({
        mutationFn: (payload: {
            agentId?: string
            assigneeId?: string
            title: string
            description?: string
            estimatedHours?: number
            acceptanceCriteria: { text: string; checked: boolean }[]
            links?: string[]
            attachmentFileIds?: { fileId: string; name: string; size: number; type: string }[]
        }) => api.post('/api/v1/tasks', payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task created')
            reset()
            setLinks([])
            setReferences([])
            setAttachmentFileIds([])
            setSelectedAssignee(null)
            onOpenChange(false)
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to create task')
        },
    })

    const onSubmit = (data: CreateTaskForm) => {
        const hours = data.estimatedHours ? parseFloat(data.estimatedHours) : undefined
        mutate({
            agentId: selectedAssignee?.type === 'agent' ? selectedAssignee.id : undefined,
            assigneeId: selectedAssignee?.type === 'member' ? selectedAssignee.id : undefined,
            title: data.title,
            description: data.description || undefined,
            estimatedHours: hours && !isNaN(hours) ? hours : undefined,
            acceptanceCriteria: data.acceptanceCriteria
                .filter(c => c.text.trim())
                .map(c => ({ text: c.text.trim(), checked: false })),
            links: [...links.map(l => l.url), ...references],
            attachmentFileIds: attachmentFileIds,
        })
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onOpenChange(v) } }}>
            <DialogContent className="max-w-2xl bg-[#0f0f0f] border-[#1e1e1e] rounded-xl p-0 gap-0 overflow-hidden [&>button]:hidden shadow-2xl">
                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col">
                    {/* Section 1 - Title */}
                    <input
                        placeholder="Task title"
                        className="w-full bg-transparent text-xl font-medium text-foreground placeholder:text-muted-foreground/30 border-none outline-none resize-none px-6 pt-6 pb-2"
                        {...register('title')}
                        autoFocus
                    />

                    {/* Section 2 - Properties row */}
                    <div className="flex items-center gap-2 px-6 py-3 border-y border-[#1e1e1e] flex-wrap">
                        {/* Assignee picker — members + agents combined */}
                        <Select
                            value={selectedAssignee ? `${selectedAssignee.type}:${selectedAssignee.id}` : 'unassigned'}
                            onValueChange={(val) => {
                                if (!val || val === 'unassigned') { setSelectedAssignee(null); return }
                                const colonIdx = val.indexOf(':')
                                const type = val.slice(0, colonIdx) as 'agent' | 'member'
                                const id = val.slice(colonIdx + 1)
                                const opt = assigneeOptions.find(o => o.type === type && o.id === id)
                                if (opt) setSelectedAssignee(opt)
                            }}
                        >
                            <SelectTrigger className="h-auto px-2.5 py-1 text-xs border-[#1e1e1e] bg-transparent w-auto gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-50">
                                {selectedAssignee?.type === 'agent'
                                    ? <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    : <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                                <span className="text-muted-foreground">{selectedAssignee?.name ?? 'No Assignee'}</span>
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1a1a] border-[#2a2a2a]">
                                <SelectItem value="unassigned">
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <User className="w-3.5 h-3.5" />
                                        No Assignee
                                    </div>
                                </SelectItem>
                                {members.length > 0 && (
                                    <>
                                        <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Members</div>
                                        {members.map(m => (
                                            <SelectItem key={m.userId} value={`member:${m.userId}`}>
                                                <div className="flex items-center gap-1.5">
                                                    <User className="w-3.5 h-3.5" />
                                                    {m.userName || m.userEmail}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </>
                                )}
                                {activeAgents.length > 0 && (
                                    <>
                                        <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Agents</div>
                                        {activeAgents.map(a => (
                                            <SelectItem key={a.id} value={`agent:${a.id}`}>
                                                <div className="flex items-center gap-1.5">
                                                    <Bot className="w-3.5 h-3.5" />
                                                    {a.name}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </>
                                )}
                            </SelectContent>
                        </Select>

                        {/* Status pill */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground border border-[#1e1e1e]">
                            <StatusIcon status="backlog" />
                            <span>Backlog</span>
                        </div>

                        {/* Est. hours — toggle between pill and inline input */}
                        {hoursEditing ? (
                            <input
                                type="number"
                                min="0"
                                step="0.5"
                                placeholder="hours"
                                autoFocus
                                className="w-20 bg-transparent text-xs text-foreground border border-[#3a3a3a] rounded-md px-2.5 py-1 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                {...register('estimatedHours')}
                                onBlur={() => setHoursEditing(false)}
                            />
                        ) : (
                            <div
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]"
                                onClick={() => setHoursEditing(true)}
                            >
                                <Clock className="w-3.5 h-3.5" />
                                <span>{estimatedHoursVal ? `${estimatedHoursVal}h` : 'Est. hours'}</span>
                            </div>
                        )}

                        {/* Link pill */}
                        <div
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]"
                            onClick={() => setLinkDialogOpen(true)}
                        >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>{links.length > 0 ? `${links.length} link${links.length > 1 ? 's' : ''}` : 'Add link'}</span>
                        </div>

                        {/* Attachment */}
                        <div
                            className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]",
                                isUploadingAttachment && "opacity-50 cursor-wait"
                            )}
                            onClick={() => !isUploadingAttachment && attachFileInputRef.current?.click()}
                        >
                            {isUploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                            <span>{attachmentFileIds.length > 0 ? `${attachmentFileIds.length} file${attachmentFileIds.length > 1 ? 's' : ''}` : 'Attach'}</span>
                        </div>
                        <input
                            type="file"
                            ref={attachFileInputRef}
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleAttachmentUpload(file)
                                e.target.value = ''
                            }}
                        />

                        {/* References */}
                        <div
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]"
                            onClick={() => setReferenceDialogOpen(true)}
                        >
                            <FileText className="w-3.5 h-3.5" />
                            <span>{references.length > 0 ? `${references.length} ref${references.length > 1 ? 's' : ''}` : 'Add reference'}</span>
                        </div>
                    </div>

                    {/* Section 3 - Description */}
                    <textarea
                        placeholder="Add description..."
                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/30 border-none outline-none resize-none px-6 py-4 min-h-[100px]"
                        {...register('description')}
                    />

                    {/* Section 4 - Acceptance Criteria */}
                    <div className="pb-4">
                        <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs text-muted-foreground px-6 py-2 hover:text-foreground outline-none border-none bg-transparent"
                            onClick={() => setCriteriaExpanded(!criteriaExpanded)}
                        >
                            {criteriaExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            Acceptance Criteria {fields.length > 0 && `(${fields.length})`}
                        </button>

                        {criteriaExpanded && (
                            <div className="space-y-2 mt-1">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="flex items-center gap-2 px-6 group/item">
                                        <div className="w-3.5 h-3.5 rounded-[3px] border border-[#3a3a3a] bg-transparent flex-shrink-0" />
                                        <input
                                            type="text"
                                            placeholder="Add acceptance criterion..."
                                            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/30"
                                            {...register(`acceptanceCriteria.${index}.text`)}
                                        />
                                        <button
                                            type="button"
                                            className="text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover/item:opacity-100 transition-opacity"
                                            onClick={() => remove(index)}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <div className="px-6 pt-1">
                                    <button
                                        type="button"
                                        className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1.5 bg-transparent border-none"
                                        onClick={() => append({ text: '' })}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add criterion
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section 5 - Footer */}
                    <div className="flex items-center justify-between px-6 py-4 border-t border-[#1e1e1e]">
                        <div className="flex flex-col">
                            <span className="text-xs text-muted-foreground/40 flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5" />
                                Move to Todo to start planning
                            </span>
                            {errors.title && (
                                <span className="text-[10px] text-destructive mt-1">
                                    {errors.title.message}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-sm text-muted-foreground hover:text-foreground"
                                onClick={() => { reset(); onOpenChange(false) }}
                            >
                                Cancel
                            </Button>
                            <Button 
                                type="submit" 
                                disabled={isPending}
                                className="bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-sm px-4 py-2 rounded-lg font-medium"
                            >
                                {isPending ? (
                                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</>
                                ) : (
                                    'Create Task'
                                )}
                            </Button>
                        </div>
                    </div>
                </form>
            </DialogContent>
            <AddLinkDialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen} onAddLink={link => setLinks(p => [...p, link])} />
            <AddReferenceDialog open={referenceDialogOpen} onOpenChange={setReferenceDialogOpen} onAddReference={ref => setReferences(p => [...p, ref])} existingReferences={references} setReferences={setReferences} />
        </Dialog>
    )
}

function AddLinkDialog({ open, onOpenChange, onAddLink }: { open: boolean, onOpenChange: (v: boolean) => void, onAddLink: (link: { url: string, title: string }) => void }) {
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')

    const handleAdd = () => {
        if (url) {
            onAddLink({ url, title })
            setUrl('')
            setTitle('')
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-[#1a1a1a] border border-[#2a2a2a]">
                <DialogHeader>
                    <DialogTitle>Add link</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Input
                        placeholder="Type or paste a URL"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm px-3 py-2 w-full"
                    />
                    <div className="relative">
                        <Input
                            placeholder="Display title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm px-3 py-2 w-full"
                        />
                         <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Optional</span>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700">Add Link</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function AddReferenceDialog({ open, onOpenChange, onAddReference, existingReferences, setReferences }: { open: boolean, onOpenChange: (v: boolean) => void, onAddReference: (ref: string) => void, existingReferences: string[], setReferences: (refs: string[]) => void }) {
    const [ref, setRef] = useState('')

    const handleAdd = () => {
        if (ref) {
            onAddReference(ref)
            setRef('')
        }
    }
    
    const handleRemove = (index: number) => {
        setReferences(existingReferences.filter((_, i) => i !== index));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-[#1a1a1a] border border-[#2a2a2a]">
                <DialogHeader>
                    <DialogTitle>Add reference</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Input
                        placeholder="Paste a URL or add a note"
                        value={ref}
                        onChange={(e) => setRef(e.target.value)}
                        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm px-3 py-2 w-full"
                    />
                    <div className="flex flex-wrap gap-2">
                        {existingReferences.map((r, i) => (
                             <Badge key={i} variant="secondary" className="flex items-center gap-1.5">
                                {r}
                               <button onClick={() => handleRemove(i)} className="rounded-full hover:bg-muted-foreground/20">
                                    <X className="h-3 w-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAdd}>Add</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({
    status,
    tasks,
    tenantSlug,
    taskNumberMap,
    members,
    agents,
    onAddTask,
    onDropTask,
}: {
    status: Task['status']
    tasks: Task[]
    tenantSlug: string
    taskNumberMap: Map<string, number>
    members: MembersResponse['data']
    agents: AgentsResponse['data']
    onAddTask: () => void
    onDropTask: (taskId: string, status: Task['status'], targetTaskId?: string, position?: 'before' | 'after') => void
}) {
    const cfg = STATUS_CONFIG[status]
    const [isOver, setIsOver] = useState(false)
    const [dropIndicator, setDropIndicator] = useState<{ taskId: string; position: 'before' | 'after' } | null>(null)

    const handleDragOver = (e: React.DragEvent, targetTaskId?: string) => {
        e.preventDefault()
        e.stopPropagation()
        setIsOver(true)

        if (targetTaskId) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const mid = rect.top + rect.height / 2
            const pos = e.clientY < mid ? 'before' : 'after'
            setDropIndicator({ taskId: targetTaskId, position: pos })
        } else {
            setDropIndicator(null)
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsOver(false)
        const taskId = e.dataTransfer.getData('taskId')
        if (taskId) {
            onDropTask(taskId, status, dropIndicator?.taskId, dropIndicator?.position)
        }
        setDropIndicator(null)
    }

    return (
        <div 
            className={cn(
                "w-[300px] min-w-[300px] flex-shrink-0 flex flex-col rounded-xl p-3 min-h-[500px] bg-[#111111] border transition-colors",
                isOver ? "border-primary/50 bg-[#161616]" : "border-[#222222]"
            )}
            onDragOver={(e) => handleDragOver(e)}
            onDragLeave={() => {
                setIsOver(false)
                setDropIndicator(null)
            }}
            onDrop={handleDrop}
        >
            {/* Column header */}
            <div className="flex items-center gap-2 px-2 py-3 mb-2">
                <StatusIcon status={status} />
                <span className="text-sm font-medium text-foreground">{cfg.label}</span>
                <span className="text-sm text-muted-foreground ml-1">{tasks.length}</span>
                <Maximize2 className="w-4 h-4 text-muted-foreground cursor-default ml-auto" />
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto bg-transparent">
                <div className="flex flex-col gap-2">
                    {tasks.length === 0 && (
                        <div className="h-24 border-2 border-dashed border-[#222] rounded-lg flex items-center justify-center text-xs text-muted-foreground/30">
                            Empty
                        </div>
                    )}
                    {tasks.map(task => (
                        <div 
                            key={task.id}
                            onDragOver={(e) => handleDragOver(e, task.id)}
                            className="relative"
                        >
                            {dropIndicator?.taskId === task.id && dropIndicator.position === 'before' && (
                                <div className="h-1 bg-primary/60 rounded-full mb-1 animate-pulse" />
                            )}
                            <TaskCard 
                                task={task} 
                                tenantSlug={tenantSlug} 
                                taskNumber={taskNumberMap.get(task.id) || 1} 
                                members={members}
                                agents={agents}
                            />
                            {dropIndicator?.taskId === task.id && dropIndicator.position === 'after' && (
                                <div className="h-1 bg-primary/60 rounded-full mt-1 animate-pulse" />
                            )}
                        </div>
                    ))}
                    {status === 'backlog' && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 w-full text-xs text-muted-foreground h-8 hover:text-foreground justify-start px-2"
                            onClick={onAddTask}
                        >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Add Task
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── BoardView ────────────────────────────────────────────────────────────────

export function BoardView() {
    const params = useParams()
    const tenantSlug = params.tenant as string
    const queryClient = useQueryClient()
    const [createOpen, setCreateOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState<Task['status'] | 'all'>('all')
    const [agentFilter, setAgentFilter] = useState<string>('all')

    const { data, isLoading, isError, error } = useQuery<TasksResponse>({
        queryKey: ['tasks'],
        queryFn: () => api.get<TasksResponse>('/api/v1/tasks'),
    })

    const updateTaskStatus = useMutation({
        mutationFn: ({ taskId, status, sortOrder }: { taskId: string, status: Task['status'], sortOrder?: number }) => 
            api.patch(`/api/v1/tasks/${taskId}`, { status, sortOrder }),
        onMutate: async ({ taskId, status, sortOrder }) => {
            await queryClient.cancelQueries({ queryKey: ['tasks'] })
            const previousTasks = queryClient.getQueryData<TasksResponse>(['tasks'])
            if (previousTasks) {
                queryClient.setQueryData<TasksResponse>(['tasks'], {
                    ...previousTasks,
                    data: previousTasks.data.map((t: Task) => 
                        t.id === taskId ? { ...t, status, sortOrder: sortOrder ?? t.sortOrder } : t
                    )
                })
            }
            return { previousTasks }
        },
        onError: (err, __, context) => {
            if (context?.previousTasks) {
                queryClient.setQueryData(['tasks'], context.previousTasks)
            }
            toast.error('Failed to move task')
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
        }
    })

    const onDropTask = (taskId: string, newStatus: Task['status'], targetTaskId?: string, position?: 'before' | 'after') => {
        const tasks = queryClient.getQueryData<TasksResponse>(['tasks'])?.data ?? []
        const taskToMove = tasks.find(t => t.id === taskId)
        if (!taskToMove) return

        // Filter tasks in target column
        const targetColumnTasks = tasks
            .filter(t => t.status === newStatus && t.id !== taskId)
            .sort((a, b) => a.sortOrder - b.sortOrder)

        let newSortOrder = 0

        if (targetTaskId) {
            const targetIdx = targetColumnTasks.findIndex(t => t.id === targetTaskId)
            if (position === 'before') {
                const prevTask = targetColumnTasks[targetIdx - 1]
                const targetTask = targetColumnTasks[targetIdx]
                if (prevTask) {
                    newSortOrder = (prevTask.sortOrder + targetTask.sortOrder) / 2
                } else {
                    newSortOrder = targetTask.sortOrder - 1000
                }
            } else {
                const targetTask = targetColumnTasks[targetIdx]
                const nextTask = targetColumnTasks[targetIdx + 1]
                if (nextTask) {
                    newSortOrder = (targetTask.sortOrder + nextTask.sortOrder) / 2
                } else {
                    newSortOrder = targetTask.sortOrder + 1000
                }
            }
        } else {
            // Drop in empty column or at the end
            const lastTask = targetColumnTasks[targetColumnTasks.length - 1]
            newSortOrder = lastTask ? lastTask.sortOrder + 1000 : 0
        }

        updateTaskStatus.mutate({ taskId, status: newStatus, sortOrder: newSortOrder })
    }

    const { data: agentsData } = useQuery<AgentsResponse>({
        queryKey: ['agents'],
        queryFn: () => api.get<AgentsResponse>('/api/v1/agents'),
    })

    const { data: membersData } = useQuery<MembersResponse>({
        queryKey: ['members'],
        queryFn: () => api.get<MembersResponse>('/api/v1/members'),
    })

    const tasks = data?.data ?? []
    const agents = agentsData?.data ?? []
    const members = membersData?.data ?? []

    const tasksByCreatedAt = [...tasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const taskNumberMap = new Map(tasksByCreatedAt.map((t, i) => [t.id, i + 1]))

    const filteredTasks = tasks
        .filter(task => {
            if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false
            if (statusFilter !== 'all' && task.status !== statusFilter) return false
            if (agentFilter !== 'all' && task.agentId !== agentFilter) return false
            return true
        })
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))

    // ── Error state ──
    if (isError) {
        return (
            <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-lg font-semibold text-foreground">Board</h1>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        New Task
                    </Button>
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

    // ── Loading state ──
    if (isLoading) {
        return (
            <div className="flex flex-col h-[calc(100vh-180px)]">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-lg font-semibold text-foreground">Board</h1>
                    <Button size="sm" onClick={() => setCreateOpen(true)} disabled>
                        <Plus className="mr-1.5 h-4 w-4" />
                        New Task
                    </Button>
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <Skeleton className="h-8 w-52" />
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-8 w-44" />
                </div>
                <div className="flex flex-row gap-3 overflow-x-auto pb-6">
                    {COLUMNS.map(status => (
                        <div key={status} className="w-[300px] min-w-[300px] flex-shrink-0 flex flex-col rounded-xl p-3 min-h-[500px] bg-[#111111] border border-[#222222]">
                            <div className="flex items-center gap-2 px-2 py-3 mb-2">
                                <Skeleton className="w-4 h-4 rounded-full" />
                                <Skeleton className="h-5 w-24" />
                            </div>
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-[120px] w-full rounded-lg" />
                                <Skeleton className="h-[120px] w-full rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // ── Main board ──
    return (
        <TooltipProvider>
            <div className="flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-lg font-semibold text-foreground">Board</h1>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        New Task
                    </Button>
                </div>

                {/* Filter bar */}
                <div className="flex items-center gap-2 mb-4">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search tasks..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-8 h-8 text-sm"
                        />
                    </div>

                    <Select value={statusFilter} onValueChange={v => setStatusFilter(v as Task['status'] | 'all')}>
                        <SelectTrigger className="h-8 w-[160px] text-sm">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            {COLUMNS.map(status => (
                                <SelectItem key={status} value={status}>
                                    {STATUS_CONFIG[status].label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={agentFilter} onValueChange={setAgentFilter}>
                        <SelectTrigger className="h-8 w-[160px] text-sm">
                            <SelectValue placeholder="All Agents" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Agents</SelectItem>
                            {agents.map(agent => (
                                <SelectItem key={agent.id} value={agent.id}>
                                    {agent.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Kanban columns */}
                <div className="flex flex-row gap-3 overflow-x-auto pb-6">
                    {COLUMNS.map(status => (
                        <KanbanColumn
                            key={status}
                            status={status}
                            tasks={filteredTasks.filter(t => t.status === status)}
                            tenantSlug={tenantSlug}
                            taskNumberMap={taskNumberMap}
                            members={members}
                            agents={agents}
                            onAddTask={() => setCreateOpen(true)}
                            onDropTask={onDropTask}
                        />
                    ))}
                </div>
            </div>

            <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
        </TooltipProvider>
    )
}
