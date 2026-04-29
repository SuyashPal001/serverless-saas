'use client'

import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepCard } from '../StepCard'
import type { Task, Step } from '@/types/task'

interface PlanReviewPhaseProps {
    task: Task
    steps: Step[]
    onApprovePlan: () => void
    onRejectPlan: () => void
}

export function PlanReviewPhase({ task, steps, onApprovePlan, onRejectPlan }: PlanReviewPhaseProps) {
    return (
        <div>
            {steps.map((step, i) => (
                <div key={step.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <StepCard step={step} index={i} />
                </div>
            ))}

            {task.status === 'awaiting_approval' && (
                <div className="mt-4 p-3 rounded-xl border border-[#1e1e1e] bg-[#0f0f0f] flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                        Review the {steps.length}-step plan above and approve or request changes.
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8 gap-1.5 border-[#2a2a2a] hover:border-red-500/40 hover:text-red-400"
                            onClick={onRejectPlan}
                        >
                            <ThumbsDown className="w-3.5 h-3.5" /> Request Changes
                        </Button>
                        <Button
                            size="sm"
                            className="text-xs h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={onApprovePlan}
                        >
                            <ThumbsUp className="w-3.5 h-3.5" /> Approve Plan
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
