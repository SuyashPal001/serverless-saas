'use client'

import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FileText, Lock, Bot, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { pagesKeys } from '@/lib/query-keys/pm'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = {
    id: string
    title: string
    pageType: string
    source: string
    isLocked: boolean
    updatedAt: string
}

type CreatePageResponse = { data: Page }

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_CFG: Record<string, { label: string; color: string; bg: string }> = {
    prd:     { label: 'PRD',     color: 'text-violet-400', bg: 'bg-violet-500/10' },
    roadmap: { label: 'Roadmap', color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
    runbook: { label: 'Runbook', color: 'text-orange-400', bg: 'bg-orange-500/10' },
    adr:     { label: 'ADR',     color: 'text-amber-400',  bg: 'bg-amber-500/10'  },
    manual:  { label: 'Manual',  color: 'text-teal-400',   bg: 'bg-teal-500/10'   },
    custom:  { label: 'Custom',  color: 'text-gray-400',   bg: 'bg-gray-500/10'   },
}

// ─── PagesListPage ────────────────────────────────────────────────────────────

export default function PagesListPage({ planId, tenantSlug }: { planId: string; tenantSlug: string }) {
    const router = useRouter()
    const queryClient = useQueryClient()

    const { data, isLoading, isError } = useQuery<{ data: Page[] }>({
        queryKey: pagesKeys.list(planId),
        queryFn: () => api.get(`/api/v1/pages?planId=${planId}`),
        enabled: !!planId,
    })

    const createPage = useMutation({
        mutationFn: (): Promise<CreatePageResponse> => {
            if (!planId) return Promise.reject(new Error('planId missing'))
            return api.post('/api/v1/pages', { planId, title: 'Untitled', pageType: 'custom' })
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: pagesKeys.list(planId) })
            router.push(`/${tenantSlug}/dashboard/plans/${planId}/pages/${res.data.id}`)
        },
        onError: () => toast.error('Failed to create page'),
    })

    const pages = data?.data ?? []

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm font-medium text-foreground">
                    Pages{pages.length > 0 && <span className="ml-2 text-muted-foreground/50">{pages.length}</span>}
                </h2>
                <Button size="sm" onClick={() => createPage.mutate()} disabled={createPage.isPending}>
                    {createPage.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                        : <Plus className="w-4 h-4 mr-1.5" />}
                    New Page
                </Button>
            </div>

            {isLoading && (
                <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                </div>
            )}

            {isError && <p className="text-sm text-destructive">Failed to load pages.</p>}

            {!isLoading && !isError && pages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <FileText className="w-10 h-10 text-muted-foreground/20 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No pages yet</p>
                    <p className="text-xs text-muted-foreground/50 mt-1">Create your first page to document this plan</p>
                </div>
            )}

            {pages.length > 0 && (
                <div className="space-y-2">
                    {pages.map(page => {
                        const cfg = TYPE_CFG[page.pageType] ?? TYPE_CFG.custom
                        return (
                            <div
                                key={page.id}
                                onClick={() => router.push(`/${tenantSlug}/dashboard/plans/${planId}/pages/${page.id}`)}
                                className="flex items-center gap-3 bg-[#111111] border border-[#1e1e1e] rounded-lg px-4 py-3 cursor-pointer hover:border-[#2a2a2a] transition-colors"
                            >
                                <FileText className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{page.title}</p>
                                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                                        Updated {formatDistanceToNow(new Date(page.updatedAt), { addSuffix: true })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', cfg.bg, cfg.color)}>
                                        {cfg.label}
                                    </span>
                                    {page.source === 'agent' && (
                                        <span className="flex items-center gap-1 text-[10px] text-blue-400/70 bg-blue-500/10 px-1.5 py-0.5 rounded">
                                            <Bot className="w-3 h-3" />Agent
                                        </span>
                                    )}
                                    {page.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500/60" />}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
