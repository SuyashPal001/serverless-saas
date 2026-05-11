'use client'

import { Bot, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task } from '@/types/task'

interface NoPlanPhaseProps {
    task: Task
    onGeneratePlan: () => void
}

export function NoPlanPhase({ task, onGeneratePlan }: NoPlanPhaseProps) {
    if (task.agentId) {
        return (
            <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3">
                <Bot className="w-8 h-8 text-muted-foreground/30" />
                <div>
                    <p className="text-sm text-muted-foreground/80 font-medium">Ready to plan</p>
                    <p className="text-xs text-muted-foreground/40 mt-1">The agent will analyse the task and propose a step-by-step execution plan.</p>
                </div>
                <Button size="sm" className="mt-1 gap-2" onClick={onGeneratePlan}>
                    <Sparkles className="w-3.5 h-3.5" /> Generate Plan
                </Button>
            </div>
        )
    }

    return null
}
