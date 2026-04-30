'use client'

import { useState, useEffect } from 'react'
import { Link2, Paperclip, FileText, CheckSquare, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExecutionConsole } from './ExecutionConsole'
import { ActivityFeed } from './ActivityFeed'
import type { Task, Step, TaskEvent, AcceptanceCriterion } from '@/types/task'

interface TaskMainContentProps {
    task: Task
    steps: Step[]
    events: TaskEvent[]
    taskId: string
    taskOperations: {
        approvePlan: (opts?: { approved: boolean; generalInstruction?: string }) => Promise<void>
        rejectPlan: () => Promise<void>
        generatePlan: () => Promise<void>
        sendClarification: (answer: string) => Promise<void>
        markDone: () => Promise<void>
        updateTitle: (title: string) => Promise<void>
        updateDescription: (desc: string) => Promise<void>
        updateCriteria: (criteria: AcceptanceCriterion[]) => void | Promise<void>
        addLink: (url: string, label?: string) => void | Promise<void>
        removeLink: (url: string) => void | Promise<void>
        removeAttachment: (fileId: string) => void | Promise<void>
        focusLinkInput: () => void
        focusReferenceInput: () => void
        triggerAttachFile: () => void
    }
    editState: {
        isEditing: boolean
    }
}

export function TaskMainContent({ task, steps, events, taskId, taskOperations, editState }: TaskMainContentProps) {
    const { isEditing } = editState
    const [editingTitle, setEditingTitle] = useState(task.title)
    const [editingDescription, setEditingDescription] = useState(task.description || '')

    // Reset local edit inputs when navigating to a different task
    useEffect(() => {
        setEditingTitle(task.title)
        setEditingDescription(task.description || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task.id])

    const criteria: AcceptanceCriterion[] = task.acceptanceCriteria ?? []

    const handleCriterionToggle = (index: number) => {
        const updated = criteria.map((c, i) =>
            i === index ? { ...c, checked: !c.checked } : c
        )
        taskOperations.updateCriteria(updated)
    }

    return (
        <div className="flex-1 flex flex-col overflow-y-auto px-8 py-6">
            {/* Title */}
            <div className="mb-4">
                {isEditing ? (
                    <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                            const trimmed = editingTitle.trim()
                            if (trimmed && trimmed !== task.title) taskOperations.updateTitle(trimmed)
                        }}
                        className="w-full bg-transparent text-xl font-semibold text-foreground outline-none border-b border-[#2a2a2a] focus:border-primary/50 pb-1 transition-colors"
                    />
                ) : (
                    <h1 className="text-xl font-semibold text-foreground">{task.title}</h1>
                )}
            </div>

            {/* Description */}
            <div className="mb-5">
                {isEditing ? (
                    <textarea
                        value={editingDescription}
                        onChange={(e) => setEditingDescription(e.target.value)}
                        onBlur={() => {
                            if (editingDescription !== (task.description || ''))
                                taskOperations.updateDescription(editingDescription)
                        }}
                        placeholder="Add a description…"
                        rows={4}
                        className="w-full bg-[#111] border border-[#1e1e1e] focus:border-primary/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none resize-none transition-colors"
                    />
                ) : (
                    <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
                        {task.description || <span className="text-muted-foreground/40 italic">No description</span>}
                    </p>
                )}
            </div>

            {/* Link / Attach / Reference buttons */}
            <div className="flex items-center gap-2 mb-6">
                <button
                    onClick={taskOperations.focusLinkInput}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a] border border-[#1e1e1e] px-2.5 py-1 rounded-md transition-colors"
                >
                    <Link2 className="w-3.5 h-3.5" /> Add Link
                </button>
                <button
                    onClick={taskOperations.triggerAttachFile}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a] border border-[#1e1e1e] px-2.5 py-1 rounded-md transition-colors"
                >
                    <Paperclip className="w-3.5 h-3.5" /> Attach File
                </button>
                <button
                    onClick={taskOperations.focusReferenceInput}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a] border border-[#1e1e1e] px-2.5 py-1 rounded-md transition-colors"
                >
                    <FileText className="w-3.5 h-3.5" /> Reference
                </button>
            </div>

            {/* Definition of Done / Acceptance Criteria */}
            {criteria.length > 0 && (
                <div className="mb-6 border border-[#1e1e1e] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <h2 className="text-sm font-medium text-foreground">Definition of Done</h2>
                        <span className="text-[10px] text-muted-foreground/60 bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#1e1e1e]">
                            {criteria.filter(c => c.checked).length}/{criteria.length}
                        </span>
                    </div>
                    <div className="space-y-2">
                        {criteria.map((criterion, i) => (
                            <button
                                key={i}
                                onClick={() => handleCriterionToggle(i)}
                                className="flex items-start gap-2.5 w-full text-left group"
                            >
                                {criterion.checked
                                    ? <CheckSquare className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                                    : <Square className="w-4 h-4 text-muted-foreground/40 mt-0.5 flex-shrink-0 group-hover:text-muted-foreground transition-colors" />
                                }
                                <span className={cn(
                                    'text-sm leading-relaxed',
                                    criterion.checked
                                        ? 'text-muted-foreground/50 line-through'
                                        : 'text-foreground/80',
                                )}>
                                    {criterion.text}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ExecutionConsole */}
            <ExecutionConsole
                task={task}
                steps={steps}
                events={events}
                taskOperations={{
                    approvePlan: taskOperations.approvePlan,
                    rejectPlan: taskOperations.rejectPlan,
                    generatePlan: taskOperations.generatePlan,
                    sendClarification: taskOperations.sendClarification,
                    markDone: taskOperations.markDone,
                }}
            />
            <ActivityFeed taskId={taskId} events={events} />
        </div>
    )
}
