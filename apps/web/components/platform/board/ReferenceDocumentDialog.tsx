'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export function ReferenceDocumentDialog({
    open,
    onOpenChange,
    value,
    onSave,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    value: string
    onSave: (text: string) => void
}) {
    const [draft, setDraft] = useState(value)

    React.useEffect(() => {
        if (open) setDraft(value)
    }, [open, value])

    const handleSave = () => {
        onSave(draft)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] bg-[#1a1a1a] border border-[#2a2a2a]">
                <DialogHeader>
                    <DialogTitle>Reference Document</DialogTitle>
                </DialogHeader>
                <textarea
                    rows={10}
                    placeholder="Paste or type markdown content here..."
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 px-3 py-2.5 outline-none resize-none font-mono"
                />
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} className="bg-[#2a2a2a] hover:bg-[#333] text-white border border-[#3a3a3a]">Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
