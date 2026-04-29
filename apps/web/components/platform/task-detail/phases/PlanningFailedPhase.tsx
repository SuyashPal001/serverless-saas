'use client'

import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task } from '@/types/task'

interface PlanningFailedPhaseProps {
    task: Task
    onRetry: (instruction: string) => void
}

export function PlanningFailedPhase({ task, onRetry }: PlanningFailedPhaseProps) {
    const [retryInput, setRetryInput] = useState('')

    return (
        <div className="bg-[#161212] border border-red-900/20 rounded-xl p-5">
            <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                    <h3 className="text-sm font-medium text-red-400">Planning Interrupted</h3>
                    <p className="text-xs text-red-400/70 mt-1 leading-relaxed">
                        The agent encountered an issue while generating the execution plan:{' '}
                        <span className="text-red-400 font-mono italic ml-1 underline decoration-red-500/30">
                            &ldquo;{task.blockedReason}&rdquo;
                        </span>
                    </p>
                    <div className="mt-4 flex flex-col gap-3 p-3 bg-red-500/5 rounded-lg border border-red-500/10">
                        <p className="text-[11px] text-red-400/60 uppercase tracking-wider font-semibold">Suggested Fixes</p>
                        <ul className="text-xs text-red-300/60 space-y-2">
                            <li className="flex items-start gap-2">• Add more specific Acceptance Criteria below to guide the agent.</li>
                            <li className="flex items-start gap-2">• Clarify the Task Description to reduce ambiguity.</li>
                        </ul>
                    </div>
                    <div className="mt-5 flex flex-col gap-2">
                        <textarea
                            value={retryInput}
                            onChange={e => setRetryInput(e.target.value)}
                            placeholder="What should change? (optional but recommended)"
                            rows={2}
                            className="text-xs bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-[#3a3a3a] w-full resize-none"
                        />
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                className="bg-red-600 hover:bg-red-700 text-white text-[11px] h-8 gap-2 px-4 shadow-lg shadow-red-900/20"
                                disabled={!retryInput.trim()}
                                onClick={() => {
                                    onRetry(retryInput)
                                    setRetryInput('')
                                }}
                            >
                                <RefreshCw className="w-3 h-3" /> Retry Planning
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
