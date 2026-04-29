'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
    ChevronDown, ChevronUp, Wrench, Loader2, Clock, Zap,
    MessageSquare, Check, XCircle, Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import type { Step } from '@/types/task'

// ── helpers ───────────────────────────────────────────────────────────────────

function parseEmailEntries(text: string): Array<{ from: string; subject: string; date: string; snippet?: string }> | null {
    if (!text.includes('**From:**')) return null
    const blocks = text.split(/\n\s*\n|\n---\n/)
    const result: Array<{ from: string; subject: string; date: string; snippet?: string }> = []
    for (const block of blocks) {
        if (!block.includes('**From:**')) continue
        const from = block.match(/\*\*From:\*\*\s*(.+)/)?.[1]?.trim() ?? ''
        const subject = block.match(/\*\*Subject:\*\*\s*(.+)/)?.[1]?.trim() ?? ''
        const date = block.match(/\*\*Date:\*\*\s*(.+)/)?.[1]?.trim() ?? ''
        const snippet = block.match(/\*\*Snippet:\*\*\s*(.+)/)?.[1]?.trim()
        if (from || subject) result.push({ from, subject, date, snippet })
    }
    return result.length > 0 ? result : null
}

function AgentOutputRenderer({ content }: { content: string }) {
    const emails = parseEmailEntries(content)
    if (emails) {
        return (
            <div className="space-y-2">
                {emails.map((email, i) => (
                    <div key={i} className="rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2.5 text-xs">
                        <div className="flex flex-col gap-0.5">
                            <div className="flex gap-2"><span className="text-muted-foreground/60 w-14 flex-shrink-0">From</span><span className="text-foreground/80 truncate">{email.from}</span></div>
                            <div className="flex gap-2"><span className="text-muted-foreground/60 w-14 flex-shrink-0">Subject</span><span className="text-foreground font-medium truncate">{email.subject}</span></div>
                            {email.date && <div className="flex gap-2"><span className="text-muted-foreground/60 w-14 flex-shrink-0">Date</span><span className="text-muted-foreground/80">{email.date}</span></div>}
                            {email.snippet && <div className="mt-1 text-muted-foreground/50 italic leading-relaxed line-clamp-2">{email.snippet}</div>}
                        </div>
                    </div>
                ))}
            </div>
        )
    }
    return (
        <div className="prose prose-invert prose-xs max-w-none text-xs leading-relaxed
            [&_p]:text-foreground/80 [&_p]:my-1
            [&_ul]:my-1 [&_ul]:pl-4 [&_li]:text-foreground/80 [&_li]:my-0.5
            [&_ol]:my-1 [&_ol]:pl-4
            [&_strong]:text-foreground [&_strong]:font-semibold
            [&_code]:bg-[#1a1a1a] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-emerald-400 [&_code]:font-mono
            [&_pre]:bg-[#1a1a1a] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto
            [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-medium
            [&_blockquote]:border-l-2 [&_blockquote]:border-[#2a2a2a] [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground/70
            [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
            [&_hr]:border-[#2a2a2a]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    )
}

function StepReasoning({ reasoning }: { reasoning: string }) {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <div>
            <button
                className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Why this step?
            </button>
            {isOpen && (
                <div className="text-xs text-muted-foreground/80 mt-2 bg-[#0d0d0d] rounded-lg p-3 leading-relaxed">
                    {reasoning}
                </div>
            )}
        </div>
    )
}

function StepInsightsModal({
    open,
    onOpenChange,
    step,
    parsedOutput,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    step: Step
    parsedOutput: {
        reasoning?: string
        toolRationale?: string
        results?: Array<{ title?: string; url?: string; description?: string; company?: string }>
        summary?: string
    } | null
}) {
    if (!step) return null

    const reasoning = parsedOutput?.reasoning || step.reasoning || null
    const toolRationale = parsedOutput?.toolRationale || null
    const summary = parsedOutput?.summary || null
    const results = parsedOutput?.results && parsedOutput.results.length > 0 ? parsedOutput.results : null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-[#0f0f0f] border border-[#1e1e1e] shadow-2xl p-0 overflow-hidden">
                <DialogHeader className="p-6 border-b border-[#1e1e1e] bg-[#141414]">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                            {step.stepNumber}
                        </div>
                        <DialogTitle className="text-lg font-bold">{step.title}</DialogTitle>
                    </div>
                </DialogHeader>
                <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    <section>
                        <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Target className="w-3 h-3 text-primary" /> Reasoning & Strategic Context
                        </h4>
                        <div className="bg-[#161616] p-4 rounded-xl border border-[#1e1e1e] text-sm text-foreground/80 leading-relaxed italic">
                            &ldquo;{reasoning || 'No detailed reasoning provided for this specific step yet.'}&rdquo;
                        </div>
                    </section>
                    {step.toolName && (
                        <section>
                            <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Zap className="w-3 h-3 text-primary" /> Tool Selection
                            </h4>
                            <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/10 rounded-xl">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                    <Wrench className="w-4 h-4 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-mono text-primary font-medium">{step.toolName}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        {toolRationale || 'This tool was chosen to maximize execution precision based on your specific requirements.'}
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}
                    {summary && (
                        <section>
                            <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <MessageSquare className="w-3 h-3 text-primary" /> Summary
                            </h4>
                            <div className="bg-[#161616] p-4 rounded-xl border border-[#1e1e1e] text-sm text-foreground/80 leading-relaxed">
                                {summary}
                            </div>
                        </section>
                    )}
                    {results && (
                        <section>
                            <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Check className="w-3 h-3 text-primary" /> Results
                            </h4>
                            <div className="space-y-2">
                                {results.map((r, i) => (
                                    <div key={i} className="rounded-lg border border-[#1e1e1e] bg-[#161616] px-3 py-2.5 text-xs space-y-1">
                                        {r.title && <p className="text-foreground font-medium">{r.title}</p>}
                                        {r.url && (
                                            <a
                                                href={r.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block text-primary hover:underline truncate"
                                            >
                                                {r.url}
                                            </a>
                                        )}
                                        {r.description && <p className="text-muted-foreground/70 leading-relaxed">{r.description}</p>}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest flex items-center gap-2">
                                <Clock className="w-3 h-3 text-primary" /> Strategy Changelog
                            </h4>
                            {step.feedbackHistory && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                                    {step.feedbackHistory.length} revisions
                                </span>
                            )}
                        </div>
                        {step.feedbackHistory && step.feedbackHistory.length > 0 ? (
                            <div className="space-y-4 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-[#1e1e1e]">
                                {step.feedbackHistory.map((h, i) => (
                                    <div key={i} className="relative pl-7">
                                        <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-[#111] border border-[#1e1e1e] flex items-center justify-center">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mb-1">{h.date} (User Feedback)</div>
                                        <div className="bg-[#111] p-3 rounded-lg border border-[#1e1e1e] text-xs text-foreground/70 leading-relaxed">{h.content}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground/30 italic py-6 text-center bg-[#111] rounded-xl border border-dashed border-[#1e1e1e]">
                                No feedback history yet. This step is original.
                            </div>
                        )}
                    </section>
                </div>
                <DialogFooter className="p-4 bg-[#141414] border-t border-[#1e1e1e]">
                    <Button onClick={() => onOpenChange(false)} variant="ghost" className="text-xs h-8 text-muted-foreground hover:text-foreground">
                        Close Insight
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function LiveActivityFeed({
    activity,
    thinking,
    liveText,
}: {
    activity: NonNullable<Step['liveActivity']>
    thinking: boolean
    liveText?: string
}) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
    }, [activity, thinking, liveText])

    return (
        <div
            ref={ref}
            className="mt-3 ml-9 max-h-48 overflow-y-auto rounded-lg bg-black/70 border border-[#2a2a2a] p-3 font-mono text-xs space-y-2 leading-relaxed"
        >
            {activity.map((item, i) => (
                <div key={i} className="space-y-0.5">
                    {item.completed ? (
                        <>
                            <div className="text-emerald-400/80">
                                {'✓ '}{item.toolName} completed{item.durationMs !== undefined ? ` (${(item.durationMs / 1000).toFixed(1)}s)` : ''}
                            </div>
                            {item.resultSummary && item.resultSummary !== 'Completed' && (
                                <div className="pl-4 text-muted-foreground/50 truncate">{item.resultSummary}</div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="text-amber-400/80">{'⚡ Calling '}{item.toolName}</div>
                            {item.toolInput && (
                                <div className="pl-4 text-muted-foreground/50 truncate">{item.toolInput}</div>
                            )}
                        </>
                    )}
                </div>
            ))}
            {thinking && !liveText && (
                <div className="text-primary/60">{'✍️ Agent is writing...'}</div>
            )}
            {liveText && (
                <div className="text-emerald-300/70 whitespace-pre-wrap">{liveText}</div>
            )}
        </div>
    )
}

// ── helpers (structured output) ───────────────────────────────────────────────

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '')
    } catch {
        return url
    }
}

function renderInlineMarkdown(text: string): ReactNode {
    const parts = text.split(
        /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g
    )
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return (
                <code
                    key={i}
                    className="text-xs bg-muted px-1 py-0.5 rounded font-mono text-primary"
                >
                    {part.slice(1, -1)}
                </code>
            )
        }
        const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (mdLink) {
            return (
                <a
                    key={i}
                    href={mdLink[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80 transition-colors"
                >
                    {mdLink[1]}
                </a>
            )
        }
        if (part.match(/^https?:\/\//)) {
            return (
                <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80 transition-colors"
                >
                    {extractDomain(part)}
                </a>
            )
        }
        return part
    })
}

// ── StepCard ──────────────────────────────────────────────────────────────────

export function StepCard({ step, index }: { step: Step; index: number }) {
    const [insightsOpen, setInsightsOpen] = useState(false)
    const parsedOutput: {
        reasoning?: string
        toolRationale?: string
        results?: Array<{
            title?: string
            url?: string
            description?: string
            company?: string
        }>
        summary?: string
    } | null = step.agentOutput
        ? (() => { try { return JSON.parse(step.agentOutput) } catch { return null } })()
        : null
    const [resultsExpanded, setResultsExpanded] = useState(false)
    const score = step.confidenceScore != null ? Number(step.confidenceScore) : null
    const scoreColor = score === null ? '' : score >= 0.8 ? 'bg-emerald-500' : score >= 0.6 ? 'bg-amber-500' : 'bg-red-500'
    const isRunning = step.status === 'running'

    return (
        <div className={cn(
            'border rounded-xl p-4 mb-3 transition-all group',
            isRunning ? 'bg-[#0d1117] border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]' : 'bg-[#111] border-[#1e1e1e]',
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={cn(
                        'w-6 h-6 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5 border font-medium',
                        step.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' :
                        isRunning ? 'bg-primary/10 border-primary/40 text-primary' :
                        step.status === 'failed' ? 'bg-red-500/10 border-red-500/40 text-red-400' :
                        step.status === 'skipped' ? 'bg-[#1e1e1e] border-[#2a2a2a] text-muted-foreground/30' :
                        'bg-[#1e1e1e] border-[#2a2a2a] text-muted-foreground',
                    )}>
                        {step.status === 'done' ? <Check className="w-3 h-3" /> :
                         isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> :
                         step.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                         index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium leading-snug', step.status === 'skipped' ? 'line-through text-muted-foreground/40' : 'text-foreground')}>
                            {step.title}
                        </p>
                        {step.description && (
                            <p className="mt-1 text-xs text-muted-foreground/60 leading-relaxed">{step.description}</p>
                        )}
                        <div className="mt-3 flex items-center gap-3 flex-wrap">
                            {step.toolName && (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono text-primary/80 bg-primary/5 border border-primary/10">
                                    <Zap className="w-2.5 h-2.5" />
                                    {step.toolName}
                                </div>
                            )}
                            {step.estimatedHours != null && (
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
                                    <Clock className="w-2.5 h-2.5" />
                                    {step.estimatedHours}h
                                </div>
                            )}
                            {score !== null && (
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                                    <div className="w-12 h-0.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                                        <div
                                            className={cn('h-full rounded-full transition-all duration-500')}
                                            style={{ width: `${score * 100}%`, backgroundColor: scoreColor.split('-')[1] }}
                                        />
                                    </div>
                                    <span>{Math.round(score * 100)}%</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge variant="outline" className={cn(
                        'capitalize text-[10px] px-1.5 py-0 h-4 min-w-[50px] justify-center',
                        step.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        isRunning ? 'bg-primary/10 text-primary border-primary/20' :
                        step.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        step.status === 'skipped' ? 'bg-muted/10 text-muted-foreground/30 border-transparent line-through' :
                        'bg-muted/10 text-muted-foreground/50 border-transparent',
                    )}>
                        {isRunning ? 'running' : step.status}
                    </Badge>
                    <button
                        onClick={() => setInsightsOpen(true)}
                        className="text-[10px] font-medium text-muted-foreground/40 hover:text-primary transition-colors flex items-center gap-1"
                    >
                        <MessageSquare className="w-2.5 h-2.5" />
                        Why this?
                    </button>
                </div>
            </div>

            {isRunning && (step.liveActivity?.length || step.agentThinking || step.liveText) ? (
                <LiveActivityFeed
                    activity={step.liveActivity ?? []}
                    thinking={step.agentThinking ?? false}
                    liveText={step.liveText}
                />
            ) : null}

            {(step.humanFeedback || step.agentOutput) && (
                <div className="mt-3 ml-9 space-y-2">
                    {step.humanFeedback && (
                        <div className="p-2 bg-amber-500/5 border border-amber-500/10 rounded-lg text-xs text-amber-300/60 leading-relaxed italic">
                            <span className="font-bold text-amber-500/50 mr-1 not-italic tracking-tighter uppercase text-[9px]">Feedback:</span> {step.humanFeedback}
                        </div>
                    )}
                    {(step.summary || step.agentOutput) && (
                        <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                            <span className="block font-bold text-emerald-500/50 tracking-tighter uppercase text-[9px] mb-1.5">Result</span>
                            {/* Case 1: JSON output with structured results */}
                            {!step.summary && parsedOutput?.summary ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-foreground/90 leading-relaxed">
                                        {renderInlineMarkdown(parsedOutput.summary)}
                                    </p>
                                    {parsedOutput.results && parsedOutput.results.length > 0 && (
                                        <div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setResultsExpanded(v => !v)
                                                }}
                                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                {resultsExpanded
                                                    ? <ChevronUp className="w-3 h-3" />
                                                    : <ChevronDown className="w-3 h-3" />
                                                }
                                                {parsedOutput.results.length} sources
                                            </button>
                                            {resultsExpanded && (
                                                <div className="mt-2 space-y-3">
                                                    {parsedOutput.results.map((r, i) => (
                                                        <div
                                                            key={i}
                                                            className="border-b border-border/30 pb-3 last:border-0 last:pb-0"
                                                        >
                                                            {r.title && (
                                                                <p className="text-sm font-semibold text-foreground leading-snug">
                                                                    {r.title}
                                                                </p>
                                                            )}
                                                            {r.url && (
                                                                <a
                                                                    href={r.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-xs font-mono text-primary/70 hover:text-primary transition-colors truncate block mt-0.5"
                                                                >
                                                                    {extractDomain(r.url)}
                                                                </a>
                                                            )}
                                                            {r.description && (
                                                                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                                                                    {renderInlineMarkdown(r.description)}
                                                                </p>
                                                            )}
                                                            {r.company && (
                                                                <p className="text-xs text-muted-foreground/50 italic mt-0.5">
                                                                    {r.company}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* Case 2: step.summary exists or agentOutput is plain text */
                                <AgentOutputRenderer content={step.summary || step.agentOutput!} />
                            )}
                        </div>
                    )}
                </div>
            )}

            <StepInsightsModal open={insightsOpen} onOpenChange={setInsightsOpen} step={step} parsedOutput={parsedOutput} />
        </div>
    )
}

// Re-export for convenience — unused here but referenced in type checks
export { StepReasoning }
