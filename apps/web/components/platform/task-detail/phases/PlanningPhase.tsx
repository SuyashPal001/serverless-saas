'use client'

import { RefreshCw } from 'lucide-react'
import type { Task, TaskEvent } from '@/types/task'

interface PlanningPhaseProps {
    task: Task
    events: TaskEvent[]
}

function PlanningStepSkeleton() {
    return (
        <div className="border border-border bg-card rounded-xl p-4 mb-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full flex-shrink-0 mt-0.5 bg-muted/60 animate-pulse" />
                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="h-3 rounded bg-muted/60 animate-pulse w-3/4" />
                        <div className="h-3 rounded bg-muted/60 animate-pulse w-full" />
                        <div className="h-3 rounded bg-muted/60 animate-pulse w-1/2" />
                    </div>
                </div>
                <div className="h-3 w-12 bg-muted/60 animate-pulse rounded flex-shrink-0" />
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
