'use client'

import type { ReactNode } from 'react'

export type ParsedOutput = {
    reasoning?: string
    toolRationale?: string
    results?: Array<{
        title?: string
        url?: string
        description?: string
        company?: string
    }>
    summary?: string
}

export function extractDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '')
    } catch {
        return url
    }
}

export function renderInlineMarkdown(text: string): ReactNode {
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

export function parseAgentOutput(raw: string | null): ParsedOutput | null {
    if (!raw) return null
    let cleaned = raw.trim()
    if (cleaned.startsWith('```')) {
        cleaned = cleaned
            .replace(/^```(?:json)?\n?/, '')
            .replace(/\n?```$/, '')
            .trim()
    }
    try {
        return JSON.parse(cleaned) as ParsedOutput
    } catch {
        return null
    }
}
