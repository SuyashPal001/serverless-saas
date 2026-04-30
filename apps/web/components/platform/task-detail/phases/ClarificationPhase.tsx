'use client'

import { useState } from 'react'
import { MessageSquare, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task, TaskEvent } from '@/types/task'

interface ClarificationPhaseProps {
    task: Task
    events: TaskEvent[]
    onSendClarification: (answer: string) => void
}

export function ClarificationPhase({ task, events, onSendClarification }: ClarificationPhaseProps) {
    const [answer, setAnswer] = useState('')

    const rawQuestions = events.find(e => e.eventType === 'clarification_requested')?.payload?.questions as
        | string[]
        | string
        | undefined

    const questions: string[] = Array.isArray(rawQuestions)
        ? rawQuestions.filter(Boolean)
        : typeof rawQuestions === 'string'
        ? [rawQuestions]
        : task.blockedReason
        ? [task.blockedReason]
        : []

    const handleSend = () => {
        if (!answer.trim()) return
        onSendClarification(answer)
        setAnswer('')
    }

    return (
        <div className="mb-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-medium text-amber-400">Agent has questions before proceeding</h3>
            </div>
            <div className="space-y-1.5 text-sm text-amber-400/80 mb-4">
                {questions.map((q, i) => (
                    <p key={i} className="flex gap-2">
                        <span className="text-amber-500/50 font-mono text-xs mt-0.5">{i + 1}.</span>
                        {q}
                    </p>
                ))}
            </div>
            <div className="border border-[#1e1e1e] rounded-lg overflow-hidden focus-within:border-amber-500/40 transition-colors bg-[#0f0f0f]">
                <textarea
                    placeholder="Type your answer here..."
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    className="w-full bg-transparent p-3 text-sm text-foreground outline-none min-h-[80px] resize-none placeholder:text-muted-foreground/30"
                />
                <div className="flex justify-end px-2 py-1.5 bg-[#161616] border-t border-[#1e1e1e]">
                    <Button
                        size="sm"
                        onClick={handleSend}
                        disabled={!answer.trim()}
                        className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 px-3"
                    >
                        Send Answer
                    </Button>
                </div>
            </div>
        </div>
    )
}
