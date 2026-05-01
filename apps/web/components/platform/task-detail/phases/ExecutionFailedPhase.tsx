'use client'

import { useState } from 'react'
import { XCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task, Step } from '@/types/task'

interface ExecutionFailedPhaseProps {
    task: Task
    steps: Step[]
    onRetry: (feedback?: string) => void
}

export function ExecutionFailedPhase({ task, steps, onRetry }: ExecutionFailedPhaseProps) {
    const [feedback, setFeedback] = useState('')
    const failedStep = steps.find(s => s.status === 'failed')

    return (
        <div className="bg-[#161212] border border-red-900/20 rounded-xl p-5">
            <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <XCircle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                    <h3 className="text-sm font-medium text-red-400">Step Failed</h3>
                    {failedStep && (
                        <p className="text-xs text-red-400/70 mt-1">
                            Failed on step {failedStep.stepNumber}:{' '}
                            <span className="text-red-300/80 font-medium">{failedStep.title}</span>
                        </p>
                    )}
                    {task.blockedReason && (
                        <p className="text-xs text-red-400/60 mt-2 font-mono italic leading-relaxed">
                            &ldquo;{task.blockedReason}&rdquo;
                        </p>
                    )}
                    <div className="mt-5 flex flex-col gap-2">
                        <textarea
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                            placeholder="What should the agent do differently? (optional)"
                            rows={2}
                            className="text-xs bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-[#3a3a3a] w-full resize-none"
                        />
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                className="bg-red-600 hover:bg-red-700 text-white text-[11px] h-8 gap-2 px-4 shadow-lg shadow-red-900/20"
                                onClick={() => {
                                    onRetry(feedback || undefined)
                                    setFeedback('')
                                }}
                            >
                                <RefreshCw className="w-3 h-3" /> Retry Execution
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
