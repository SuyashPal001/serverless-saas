'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { normalizeUrl } from './types'

export function AddLinkDialog({
    open,
    onOpenChange,
    onAddLink,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    onAddLink: (link: { url: string; title: string }) => void
}) {
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')

    const handleAdd = () => {
        if (url) {
            onAddLink({ url: normalizeUrl(url), title })
            setUrl('')
            setTitle('')
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-[#1a1a1a] border border-[#2a2a2a]">
                <DialogTitle className="sr-only">Add link</DialogTitle>
                <DialogHeader>
                    <DialogTitle>Add link</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Input
                        placeholder="Type or paste a URL"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm px-3 py-2 w-full"
                    />
                    <div className="relative">
                        <Input
                            placeholder="Display title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm px-3 py-2 w-full"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Optional</span>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleAdd} className="bg-[#2a2a2a] hover:bg-[#333] text-white border border-[#3a3a3a]">Add Link</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
