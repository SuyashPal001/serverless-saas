'use client'

import { RefreshCw } from 'lucide-react'
import type { Task, TaskEvent } from '@/types/task'

interface PlanningPhaseProps {
    task: Task
    events: TaskEvent[]
}

function PlanningStepSkeleton() {
    return (
        <div className="border rounded-xl p-4 mb-3 bg-[#111] border-[#1e1e1e] animate-pulse">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5 bg-[#1e1e1e]" />
                    <div className="flex-1 min-w-0">
                        <div className="h-3.5 bg-[#1e1e1e] rounded w-3/5" />
                        <div className="h-3 bg-[#1e1e1e] rounded w-[85%] mt-2" />
                        <div className="h-4 bg-[#1e1e1e] rounded-md w-[30%] mt-3" />
                    </div>
                </div>
                <div className="h-4 w-12 bg-[#1e1e1e] rounded flex-shrink-0" />
            </div>
        </div>
    )
}

export function PlanningPhase({ task: _task, events }: PlanningPhaseProps) {
    const isRevising = events.some(
        e => e.eventType === 'plan_rejected' || e.eventType === 'clarification_answered',
    )

    return (
        <div>
            {isRevising ? (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15 text-xs text-amber-400/70">
                    <RefreshCw className="w-3 h-3 shrink-0" />
                    Revising based on your feedback...
                </div>
            ) : (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#111] border border-[#1e1e1e]">
                    <span className="text-sm text-muted-foreground/60">Saarthi is planning...</span>
                </div>
            )}
            {Array.from({ length: 4 }).map((_, i) => (
                <PlanningStepSkeleton key={i} />
            ))}
        </div>
    )
}
