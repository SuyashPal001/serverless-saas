'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { History, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { pagesKeys } from '@/lib/query-keys/pm'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

type Version = {
    id: string
    lastSavedAt: string
}

interface PageVersionsProps {
    pageId: string
}

// ─── PageVersions ─────────────────────────────────────────────────────────────

export function PageVersions({ pageId }: PageVersionsProps) {
    const [open, setOpen] = useState(false)
    const queryClient = useQueryClient()

    const { data, isLoading } = useQuery<{ data: Version[] }>({
        queryKey: pagesKeys.versions(pageId),
        queryFn: () => api.get(`/api/v1/pages/${pageId}/versions`),
        enabled: open,
    })

    const restore = useMutation({
        mutationFn: (versionId: string) =>
            api.post(`/api/v1/pages/${pageId}/restore/${versionId}`, {}),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: pagesKeys.detail(pageId) })
            queryClient.invalidateQueries({ queryKey: pagesKeys.versions(pageId) })
            toast.success('Version restored')
        },
        onError: () => toast.error('Failed to restore version'),
    })

    const versions = data?.data ?? []

    return (
        <div className="border border-[#1e1e1e] rounded-lg overflow-hidden mt-6">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-[#111] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-muted-foreground/50" />
                    <span className="text-sm font-medium text-foreground">Version History</span>
                    {versions.length > 0 && (
                        <span className="text-xs text-muted-foreground/40">{versions.length}</span>
                    )}
                </div>
                {open
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground/40" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground/40" />}
            </button>

            {open && (
                <div className="border-t border-[#1e1e1e] divide-y divide-[#1e1e1e]">
                    {isLoading && (
                        <div className="p-3 space-y-2">
                            {[1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                    )}

                    {!isLoading && versions.length === 0 && (
                        <p className="text-xs text-muted-foreground/40 text-center py-5">No versions saved yet</p>
                    )}

                    {versions.map((v, i) => (
                        <div key={v.id} className="flex items-center justify-between px-4 py-2.5">
                            <div>
                                <p className="text-xs text-foreground/80">
                                    {i === 0 ? 'Latest save' : `v${versions.length - i}`}
                                </p>
                                <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                                    {formatDistanceToNow(new Date(v.lastSavedAt), { addSuffix: true })}
                                </p>
                            </div>
                            {i > 0 && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-xs px-2 gap-1 text-muted-foreground"
                                    onClick={() => restore.mutate(v.id)}
                                    disabled={restore.isPending}
                                >
                                    <RotateCcw className="w-3 h-3" />
                                    Restore
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
