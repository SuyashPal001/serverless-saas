'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckCircle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task, Step } from '@/types/task'
import { parseAgentOutput, renderInlineMarkdown, extractDomain } from '../outputHelpers'

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

function extractFirstSentence(text: string): string {
    if (!text) return ''
    const clean = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s+/gm, '').trim()
    const match = clean.match(/^[^.!?\n]+[.!?]/)
    return match ? match[0].trim() : clean.split('\n')[0].trim()
}

function extractAssumptions(text: string): string | null {
    const keywords = ['interpreted', 'assumed', 'treated as', 'assuming', 'assumption', 'i inferred', 'i treated']
    const paragraphs = text.split(/\n\s*\n/)
    const matched = paragraphs.filter(p => keywords.some(kw => p.toLowerCase().includes(kw)))
    if (matched.length === 0) return null
    return matched[matched.length - 1].replace(/\*\*/g, '').replace(/\*/g, '').trim()
}

function getToolInfo(toolName: string): { icon: string; label: string } {
    if (/^GMAIL/.test(toolName)) return { icon: '📧', label: 'Gmail' }
    if (/^DRIVE/.test(toolName)) return { icon: '📁', label: 'Google Drive' }
    if (/^CALENDAR/.test(toolName)) return { icon: '📅', label: 'Google Calendar' }
    if (/^ZOHO/.test(toolName)) return { icon: '🏢', label: 'Zoho CRM' }
    if (toolName === 'WEB_SEARCH') return { icon: '🔍', label: 'Web' }
    return { icon: '⚡', label: toolName }
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

function StepResult({ step }: { step: Step }) {
    const [resultsExpanded, setResultsExpanded] = useState(false)
    const parsedOutput = parseAgentOutput(step.agentOutput ?? null)

    if (!step.summary && parsedOutput?.summary) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-foreground/90 leading-relaxed">
                    {renderInlineMarkdown(parsedOutput.summary)}
                </p>
                {parsedOutput.results && parsedOutput.results.length > 0 && (
                    <div>
                        <button
                            onClick={() => setResultsExpanded(v => !v)}
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
        )
    }

    const output = step.summary ?? step.agentOutput ?? ''
    return <AgentOutputRenderer content={output} />
}

function ReceiptResults({ steps }: { steps: Step[] }) {
    const [showAll, setShowAll] = useState(false)
    const allOutput = steps.map(s => s.agentOutput!).join('\n\n')
    const emails = parseEmailEntries(allOutput)

    if (emails) {
        const LIMIT = 5
        const visible = showAll ? emails : emails.slice(0, LIMIT)
        const hiddenCount = emails.length - LIMIT
        return (
            <div>
                <div className="divide-y divide-[#1a1a1a]">
                    {visible.map((e, i) => (
                        <div key={i} className="flex items-start gap-3 py-2.5 text-xs">
                            <span className="flex-shrink-0 leading-none mt-0.5">📧</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <span className="text-foreground/80 truncate max-w-[180px]">{e.from}</span>
                                    <span className="text-muted-foreground/30">·</span>
                                    <span className="text-foreground font-medium truncate">{e.subject}</span>
                                    {e.date && (
                                        <>
                                            <span className="text-muted-foreground/30">·</span>
                                            <span className="text-muted-foreground/60 flex-shrink-0">{e.date}</span>
                                        </>
                                    )}
                                </div>
                                {e.snippet && <p className="text-muted-foreground/50 mt-0.5 line-clamp-1 italic">{e.snippet}</p>}
                            </div>
                        </div>
                    ))}
                </div>
                {!showAll && hiddenCount > 0 && (
                    <button onClick={() => setShowAll(true)} className="mt-2 text-xs text-primary hover:text-primary/80 transition-colors">
                        + {hiddenCount} more
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {steps.map(step => (
                <div key={step.id}>
                    <StepResult step={step} />
                </div>
            ))}
        </div>
    )
}

// ── ReviewPhase ───────────────────────────────────────────────────────────────

interface ReviewPhaseProps {
    task: Task
    steps: Step[]
    onMarkDone: () => void
}

export function ReviewPhase({ task, steps, onMarkDone }: ReviewPhaseProps) {
    const [showRaw, setShowRaw] = useState(false)

    const stepsWithOutput = steps.filter(s => s.status === 'done' && (s.summary || s.agentOutput))
    const toolsTouched = [...new Set(steps.filter(s => s.toolName).map(s => s.toolName!))]
    const summary = extractFirstSentence(stepsWithOutput[0]?.summary || stepsWithOutput[0]?.agentOutput || '')
    const allOutputText = stepsWithOutput.map(s => s.summary || s.agentOutput || '').join('\n\n')
    const assumptions = extractAssumptions(allOutputText)
    const rawOutput = stepsWithOutput.map(s => `### ${s.title}\n\n${s.summary || s.agentOutput || ''}`).join('\n\n---\n\n')

    return (
        <div className="rounded-2xl border border-emerald-500/20 bg-[#080d08] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-emerald-500/15 bg-emerald-500/5 flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <h2 className="text-sm font-semibold text-emerald-400">
                    {task.status === 'done' ? 'Task Complete' : 'Ready for Review'}
                </h2>
            </div>

            <div className="px-5 py-5 space-y-5">
                {/* What Happened */}
                <section>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">What Happened</p>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                        {summary || 'Agent completed execution — see results below.'}
                    </p>
                </section>

                {/* What I Touched */}
                {toolsTouched.length > 0 && (
                    <section>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">What I Touched</p>
                        <div className="flex flex-col gap-1.5">
                            {toolsTouched.map(tool => {
                                const { icon, label } = getToolInfo(tool)
                                return (
                                    <div key={tool} className="flex items-center gap-2 text-xs text-foreground/70">
                                        <span>{icon}</span>
                                        <span className="font-medium">{label}</span>
                                        <span className="text-muted-foreground/35">— via {tool}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                )}

                {/* Results */}
                <section>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">Results</p>
                    {stepsWithOutput.length === 0 ? (
                        <p className="text-sm text-muted-foreground/50 italic">No output recorded</p>
                    ) : (
                        <ReceiptResults steps={stepsWithOutput} />
                    )}
                </section>

                {/* Assumptions Made */}
                {assumptions && (
                    <section>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">Assumptions Made</p>
                        <p className="text-sm text-amber-400/70 leading-relaxed italic">{assumptions}</p>
                    </section>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#1a1a1a] bg-[#0d0d0d] flex items-center justify-between gap-3 flex-wrap">
                <button
                    onClick={() => setShowRaw(r => !r)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showRaw ? 'Hide raw' : 'View raw'}
                </button>
                {task.status === 'review' && (
                    <Button
                        size="sm"
                        className="h-7 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={onMarkDone}
                    >
                        Mark as Done →
                    </Button>
                )}
            </div>

            {/* Raw output panel */}
            {showRaw && (
                <div className="border-t border-[#1e1e1e]">
                    <pre className="p-5 text-xs text-muted-foreground/60 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                        {rawOutput || 'No output recorded'}
                    </pre>
                </div>
            )}
        </div>
    )
}
