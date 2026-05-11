'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MentionItem } from '@/hooks/use-mention-suggestions'

interface MentionListProps {
    items: MentionItem[]
    command: (item: { id: string; label: string }) => void
}

export interface MentionListRef {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
    ({ items, command }, ref) => {
        const [selectedIndex, setSelectedIndex] = useState(0)

        useEffect(() => setSelectedIndex(0), [items])

        const selectItem = (index: number) => {
            const item = items[index]
            if (item) command({ id: item.id, label: item.name })
        }

        useImperativeHandle(ref, () => ({
            onKeyDown: ({ event }: { event: KeyboardEvent }) => {
                if (event.key === 'ArrowUp') {
                    setSelectedIndex(i => (i + items.length - 1) % Math.max(items.length, 1))
                    return true
                }
                if (event.key === 'ArrowDown') {
                    setSelectedIndex(i => (i + 1) % Math.max(items.length, 1))
                    return true
                }
                if (event.key === 'Enter') {
                    selectItem(selectedIndex)
                    return true
                }
                return false
            },
        }))

        if (items.length === 0) {
            return (
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl px-3 py-2 text-xs text-muted-foreground/50 w-48">
                    No results
                </div>
            )
        }

        return (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl overflow-hidden w-48">
                {items.map((item, i) => (
                    <button
                        key={item.id}
                        onMouseDown={e => { e.preventDefault(); selectItem(i) }}
                        className={cn(
                            'flex items-center gap-2.5 w-full px-3 py-2 text-left text-xs transition-colors',
                            i === selectedIndex
                                ? 'bg-primary/10 text-foreground'
                                : 'text-foreground/80 hover:bg-[#222]',
                        )}
                    >
                        {item.type === 'agent' ? (
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <Bot className="w-3 h-3 text-primary" />
                            </div>
                        ) : (
                            <div className="w-5 h-5 rounded-full bg-[#2a2a2a] flex items-center justify-center text-[9px] font-semibold text-foreground shrink-0">
                                {item.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <span className="truncate flex-1">{item.name}</span>
                        <span className="text-[10px] text-muted-foreground/40 shrink-0">{item.type}</span>
                    </button>
                ))}
            </div>
        )
    }
)
MentionList.displayName = 'MentionList'
