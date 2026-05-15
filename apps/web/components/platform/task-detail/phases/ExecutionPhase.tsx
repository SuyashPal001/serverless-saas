'use client'

import { CheckCircle, Loader2 } from 'lucide-react'
import { StepCard } from '../StepCard'
import type { Task, Step } from '@/types/task'

interface ExecutionPhaseProps {
    task: Task
    steps: Step[]
}

export function ExecutionPhase({ task, steps }: ExecutionPhaseProps) {
    const doneCount = steps.filter(s => s.status === 'done').length

    return (
        <div>
            {/* Status badge */}
            <div className="mb-4 flex items-center gap-2 text-[11px]">
                {task.status === 'ready' ? (
                    <div className="flex items-center gap-2 text-emerald-500/70">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Plan approved · Awaiting execution
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-primary/80">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Agent is executing
                    </div>
                )}
            </div>

            {/* Progress */}
            <div className="mb-4 flex items-center gap-3">
                <div className="flex-1 h-1 bg-[#1e1e1e] rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all duration-500 rounded-full"
                        style={{ width: steps.length > 0 ? `${(doneCount / steps.length) * 100}%` : '0%' }}
                    />
                </div>
                <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">
                    {doneCount} of {steps.length} steps done
                </span>
            </div>

            {/* Step cards */}
            {steps.map((step, i) => (
                <div key={step.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <StepCard step={step} index={i} />
                </div>
            ))}
        </div>
    )
}
