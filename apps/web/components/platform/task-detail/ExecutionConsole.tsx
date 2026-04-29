'use client'

import { getPhase } from '@/lib/taskPhase'
import type { Task, Step, TaskEvent } from '@/types/task'
import { NoPlanPhase } from './phases/NoPlanPhase'
import { PlanningPhase } from './phases/PlanningPhase'
import { PlanningFailedPhase } from './phases/PlanningFailedPhase'
import { ClarificationPhase } from './phases/ClarificationPhase'
import { PlanReviewPhase } from './phases/PlanReviewPhase'
import { ExecutionPhase } from './phases/ExecutionPhase'
import { ReviewPhase } from './phases/ReviewPhase'

interface ExecutionConsoleProps {
    task: Task
    steps: Step[]
    events: TaskEvent[]
    taskOperations: {
        approvePlan: (opts?: { approved: boolean; generalInstruction?: string }) => Promise<void>
        rejectPlan: () => Promise<void>
        generatePlan: () => Promise<void>
        sendClarification: (answer: string) => Promise<void>
        markDone: () => Promise<void>
    }
}

export function ExecutionConsole({ task, steps, events, taskOperations }: ExecutionConsoleProps) {
    const phase = getPhase(task.status, steps, task.blockedReason)

    switch (phase) {
        case 'no_plan':
            return <NoPlanPhase task={task} onGeneratePlan={taskOperations.generatePlan} />
        case 'planning':
            return <PlanningPhase task={task} steps={steps} events={events} />
        case 'planning_failed':
            return (
                <PlanningFailedPhase
                    task={task}
                    onRetry={(instruction) =>
                        taskOperations.approvePlan({ approved: false, generalInstruction: instruction })
                    }
                />
            )
        case 'clarification':
            return (
                <ClarificationPhase
                    task={task}
                    events={events}
                    onSendClarification={taskOperations.sendClarification}
                />
            )
        case 'plan_review':
            return (
                <PlanReviewPhase
                    task={task}
                    steps={steps}
                    onApprovePlan={() => taskOperations.approvePlan({ approved: true })}
                    onRejectPlan={taskOperations.rejectPlan}
                />
            )
        case 'execution':
            return <ExecutionPhase task={task} steps={steps} />
        case 'review':
            return <ReviewPhase task={task} steps={steps} onMarkDone={taskOperations.markDone} />
    }
}
