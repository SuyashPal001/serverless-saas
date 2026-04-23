'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
    ArrowUp, ArrowDown, ChevronRight, CheckCircle, Play, XCircle, Target, LayoutList,
    Bot, User, Settings, ChevronDown, ChevronUp, Wrench, Loader2, AlertCircle,
    CheckSquare, MoreHorizontal, Trash2, Clock, Calendar, AlertTriangle, Check,
    Link2, Paperclip, FileText,
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
    DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'


// --- TYPES ---
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
    updatedAt: string
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
    actorName?: string
    eventType: string
    payload?: Record<string, any>
    createdAt: string
}

type TaskDetailResponse = {
    data: {
        task: Task
        steps: Step[]
        events: TaskEvent[]
        agent?: { name: string }
    }
}

// --- CONSTANTS ---

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<any> }> = {
    backlog:     { label: 'Backlog',     color: 'text-gray-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2" fill="none"/></svg>},
    ready:       { label: 'Ready',       color: 'text-blue-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>},
    in_progress: { label: 'In Progress', color: 'text-purple-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>},
    review:      { label: 'Review',      color: 'text-amber-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>},
    blocked:     { label: 'Blocked',     color: 'text-red-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>},
    done:        { label: 'Done',        color: 'text-emerald-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>},
    cancelled:   { label: 'Cancelled',   color: 'text-gray-400', icon: (props) => <svg {...props} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>},
}

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
    const Icon = STATUS_CONFIG[status]?.icon ?? STATUS_CONFIG.backlog.icon
    const color = STATUS_CONFIG[status]?.color ?? 'text-gray-400'
    return <Icon className={cn('w-3.5 h-3.5', color, className)} />
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

function StepCard({ step }: { step: Step }) {
    const score = step.confidenceScore != null ? Number(step.confidenceScore) : null
    const scoreColor = score === null ? '' : score >= 0.8 ? 'bg-emerald-500' : score >= 0.6 ? 'bg-amber-500' : 'bg-red-500'

    return (
        <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-4 mb-3 cursor-default">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-[#1e1e1e] text-xs text-muted-foreground flex items-center justify-center flex-shrink-0">
                        {step.stepNumber}
                    </div>
                    <p className="text-sm font-medium">{step.title}</p>
                </div>
                <Badge variant="outline" className={cn(
                    'capitalize text-xs',
                    step.status === 'done' ? 'bg-emerald-500/10 text-emerald-400' :
                    step.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                    step.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                    'bg-muted/50 text-muted-foreground'
                )}>
                    {step.status}
                </Badge>
            </div>
            {step.description && <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{step.description}</p>}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
                {step.toolName && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs text-muted-foreground bg-[#1a1a1a] border border-[#2a2a2a]">
                        <Wrench className="w-3 h-3" />
                        {step.toolName}
                    </div>
                )}
                {step.estimatedHours != null && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {step.estimatedHours}h
                    </div>
                )}
                {score !== null && (
                     <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="w-16 h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', scoreColor)} style={{ width: `${score * 100}%` }} />
                        </div>
                        <span>{Math.round(score * 100)}%</span>
                    </div>
                )}
            </div>
            {step.reasoning && (
                <div className="mt-3">
                    <StepReasoning reasoning={step.reasoning} />
                </div>
            )}
             {step.humanFeedback && (
                <div className="mt-2 p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-400/80">
                    Your feedback: {step.humanFeedback}
                </div>
            )}
            {step.agentOutput && (
                <div className="mt-2 p-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-xs text-emerald-400/80">
                    Output: {step.agentOutput}
                </div>
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
                    <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700 text-white">Send Feedback</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// --- MAIN COMPONENT ---
export function TaskDetailView() {
    const params = useParams()
    const router = useRouter()
    const queryClient = useQueryClient()
    const taskId = params.taskId as string
    const tenantSlug = params.tenant as string

    const [activeTab, setActiveTab] = useState<'All' | 'Activity' | 'Events'>('All')
    const [feedbackOpen, setFeedbackOpen] = useState(false)
    const [clarificationAnswer, setClarificationAnswer] = useState('')

    const { data, isLoading, isError, error } = useQuery<TaskDetailResponse>({
        queryKey: ['task', taskId],
        queryFn: () => api.get<TaskDetailResponse>(`/api/v1/tasks/${taskId}`),
        refetchInterval: 5000,
    })

    const { task, steps, events, agent } = data?.data ?? {}

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
    
    const { mutate: cancelTask } = useMutation({
        mutationFn: () => api.del(`/api/v1/tasks/${taskId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task deleted')
            router.push(`/${tenantSlug}/dashboard/board`)
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to delete task'),
    })

    const needsClarification = task?.status === 'blocked' && events?.find(e => e.eventType === 'clarification_requested') && !events?.find(e => e.eventType === 'clarification_answered')
    const clarificationQuestions = needsClarification ? events?.find(e => e.eventType === 'clarification_requested')?.payload?.questions as string[] ?? [] : []
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
                        <button className="rounded-md bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-1 text-xs flex items-center gap-1 text-muted-foreground hover:bg-[#222] transition-colors">
                            <ArrowUp className="w-3 h-3" /> 0
                        </button>
                        <button className="rounded-md bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-1 text-xs flex items-center gap-1 text-muted-foreground hover:bg-[#222] transition-colors">
                            <ArrowDown className="w-3 h-3"/> 0
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => cancelTask()} className="text-red-500 focus:text-red-400 focus:bg-red-500/10 cursor-pointer">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                
                {/* MAIN CONTENT AREA */}
                <div className="px-8 py-6 flex-1 overflow-y-auto">
                    <h1 className="text-3xl font-semibold text-foreground mb-6 leading-tight">{task.title}</h1>
                    
                    {task.description && (
                        <p className="text-sm text-foreground/80 leading-relaxed mb-6">{task.description}</p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap py-3 border-y border-[#1e1e1e] mb-6">
                        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]">
                            <Link2 className="w-3.5 h-3.5" />
                            <span>Link</span>
                        </button>
                        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]">
                            <Paperclip className="w-3.5 h-3.5" />
                            <span>Attach</span>
                        </button>
                        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors cursor-pointer border border-[#1e1e1e]">
                            <FileText className="w-3.5 h-3.5" />
                            <span>Reference</span>
                        </button>
                    </div>

                    <div className="mb-8">
                        <div className="flex items-center gap-2 mb-4">
                            <Bot className="w-4 h-4 text-muted-foreground" />
                            <h2 className="text-sm font-medium text-foreground">Agent's Plan</h2>
                            {steps.length > 0 && <span className="bg-[#1a1a1a] border border-[#2a2a2a] px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/80 font-medium">{steps.length}</span>}
                        </div>
                        {steps.length === 0 && (
                            <div className="bg-[#111] border border-[#222] rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[120px]">
                                {task.status === 'blocked' && task.blockedReason?.includes('Planning failed') ? (
                                    <>
                                        <AlertTriangle className="w-8 h-8 text-red-500 mb-2" />
                                        <p className="text-sm text-red-500 mb-3">{task.blockedReason}</p>
                                        <Button size="sm" className="bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs px-3 py-1.5 rounded-lg" onClick={() => approvePlan({ approved: false })}>Retry Planning</Button>
                                    </>
                                ) : (
                                    <>
                                        <Bot className="w-8 h-8 text-muted-foreground/30 mb-2" />
                                        <p className="text-sm text-muted-foreground">Agent is planning...</p>
                                        {task.status === 'backlog' && <Loader2 className="w-4 h-4 mt-2 animate-spin text-muted-foreground" />}
                                    </>
                                )}
                            </div>
                        )}
                        {steps.length > 0 && (
                            <div>
                                {steps.map(step => <StepCard key={step.id} step={step} />)}
                            </div>
                        )}
                    </div>

                    {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
                        <div className="mb-8 mt-6">
                            <div className="flex items-center gap-2 mb-3">
                                <CheckSquare className="w-4 h-4 text-muted-foreground" />
                                <h2 className="text-sm font-medium text-foreground">Acceptance Criteria</h2>
                            </div>
                            <div className="space-y-2">
                                {task.acceptanceCriteria.map((c, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-4 h-4 rounded-[3px] border flex items-center justify-center flex-shrink-0 cursor-default",
                                            c.checked ? "bg-blue-500 border-blue-500" : "border-[#3a3a3a] bg-transparent"
                                        )}>
                                            {c.checked && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <span className={cn("text-sm", c.checked ? "line-through text-muted-foreground" : "text-foreground/90")}>{c.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {needsClarification && (
                        <div className="mt-8 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                <h3 className="text-sm font-medium text-amber-500">Agent needs clarification</h3>
                            </div>
                            <div className="space-y-1 text-sm text-amber-500/80 mb-4 pl-6">
                                {clarificationQuestions.map((q, i) => <p key={i}>• {q}</p>)}
                            </div>
                            <textarea
                                placeholder="Type your answer..."
                                value={clarificationAnswer}
                                onChange={(e) => setClarificationAnswer(e.target.value)}
                                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] outline-none focus:border-amber-500/50 rounded-lg text-sm px-3 py-2 min-h-[80px] resize-none text-foreground placeholder:text-muted-foreground/40"
                            />
                            <div className="mt-3">
                                <Button
                                    size="sm"
                                    onClick={() => clarify(clarificationAnswer)}
                                    disabled={isClarifying || !clarificationAnswer.trim()}
                                    className="bg-amber-600 hover:bg-amber-700 text-white text-sm px-4 py-1.5 rounded-lg font-medium"
                                >
                                    {isClarifying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending...</> : 'Send Answer'}
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="mt-8 border-t border-[#1e1e1e] pt-4">
                        <div className="flex items-center gap-6 mb-6">
                           <button onClick={() => setActiveTab('All')} className={cn("text-sm pb-2 transition-colors", activeTab === 'All' ? 'text-foreground border-b-2 border-white font-medium' : 'text-muted-foreground hover:text-foreground/80')}>All</button>
                           <button onClick={() => setActiveTab('Activity')} className={cn("text-sm pb-2 transition-colors", activeTab === 'Activity' ? 'text-foreground border-b-2 border-white font-medium' : 'text-muted-foreground hover:text-foreground/80')}>Activity</button>
                           <button onClick={() => setActiveTab('Events')} className={cn("text-sm pb-2 transition-colors", activeTab === 'Events' ? 'text-foreground border-b-2 border-white font-medium' : 'text-muted-foreground hover:text-foreground/80')}>Events</button>
                        </div>
                        <div className="space-y-5">
                            {events.filter(e => {
                                if (activeTab === 'Activity') return e.actorType !== 'system'
                                if (activeTab === 'Events') return e.actorType === 'system'
                                return true
                            }).map(event => {
                                const ActorIcon = event.actorType === 'agent' ? Bot : event.actorType === 'human' ? User : Settings;
                                const actorName = event.actorType === 'human' ? 'You' : event.actorName || 'System';
                                
                                return (
                                    <div key={event.id} className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center flex-shrink-0 mt-0.5">
                                           <ActorIcon className={cn("w-4 h-4", event.actorType === 'agent' ? 'text-blue-400' : 'text-muted-foreground')} />
                                        </div>
                                        <div className="flex flex-col text-sm pt-1">
                                            <p className="text-sm text-foreground"><span className="font-medium mr-1.5">{actorName}</span><span className="text-muted-foreground/90">{event.eventType.replace(/_/g, ' ')}</span></p>
                                            <p className="text-xs text-muted-foreground/50 mt-1">{formatRelativeTime(event.createdAt)} ago</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="mt-8 flex items-start gap-4 pt-4">
                           <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0">U</div>
                           <textarea placeholder="Add a comment..." className="bg-transparent border border-[#2a2a2a] rounded-lg text-sm px-4 py-3 w-full resize-none min-h-[60px] outline-none focus:border-[#3a3a3a] text-foreground placeholder:text-muted-foreground/30" />
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
                        <div className={cn("text-xs flex items-center gap-1.5 font-medium", STATUS_CONFIG[task.status]?.color)}>
                            {STATUS_CONFIG[task.status]?.label}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Bot className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Agent</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">{agent?.name ?? 'Agent'}</div>
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
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Link2 className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Links</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5 group cursor-pointer w-full justify-between">
                            <span>—</span>
                            <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 bg-[#1a1a1a] px-1.5 py-0.5 rounded hover:text-foreground border border-[#2a2a2a]">+ Add</span>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <Paperclip className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">Attachments</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">—</div>
                    </div>
                    
                    <div className="flex items-center gap-3 py-2.5">
                        <div className="flex items-center gap-2 w-[100px] flex-shrink-0 text-muted-foreground">
                            <FileText className="w-3.5 h-3.5 opacity-50" /> 
                            <span className="text-xs">References</span>
                        </div>
                        <div className="text-xs text-foreground flex items-center gap-1.5">—</div>
                    </div>
                </div>
                
                <div className="my-5 border-t border-[#1e1e1e]"></div>
                
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Actions
                </div>
                
                <div className="space-y-1.5">
                    {task.status === 'backlog' && steps.length > 0 && (
                        <button onClick={() => approvePlan({ approved: true })} className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left">
                            <CheckCircle className="w-4 h-4 text-green-500" /> <span className="text-green-500/90 font-medium">Approve Plan</span>
                        </button>
                    )}
                    {task.status === 'ready' && (
                        <button className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left">
                            <Play className="w-4 h-4 text-blue-500" /> <span className="text-blue-500/90 font-medium">Start Task</span>
                        </button>
                    )}
                    {task.status !== 'done' && task.status !== 'cancelled' && (
                        <button onClick={() => cancelTask()} className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground transition-colors text-left">
                            <XCircle className="w-4 h-4 text-red-500" /> <span className="text-red-500/90 font-medium">Cancel Task</span>
                        </button>
                    )}
                </div>
            </div>
            
            <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} steps={steps} onSubmitFeedback={(feedback) => approvePlan({ approved: false, feedback })} />
        </div>
    )
}
