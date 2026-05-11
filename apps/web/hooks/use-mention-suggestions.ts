'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTenant } from '@/app/[tenant]/tenant-provider'
import { api } from '@/lib/api'

export type MentionItem = {
    id: string
    name: string
    avatar: string | null
    type: 'member' | 'agent'
}

type MembersResponse = { members: { userId: string; userName: string | null; userEmail: string }[] }
type AgentsResponse = { data: { id: string; name: string; status: string }[] }

export function useMentionSuggestions(): MentionItem[] {
    const { tenantId } = useTenant()

    const { data: membersData } = useQuery<MembersResponse>({
        queryKey: ['members', tenantId],
        queryFn: () => api.get<MembersResponse>('/api/v1/members'),
    })

    const { data: agentsData } = useQuery<AgentsResponse>({
        queryKey: ['agents'],
        queryFn: () => api.get<AgentsResponse>('/api/v1/agents'),
    })

    return useMemo((): MentionItem[] => {
        const members: MentionItem[] = (membersData?.members ?? []).map(m => ({
            id: m.userId,
            name: m.userName || m.userEmail,
            avatar: null,
            type: 'member',
        }))
        const agents: MentionItem[] = (agentsData?.data ?? []).map(a => ({
            id: a.id,
            name: a.name,
            avatar: null,
            type: 'agent',
        }))
        return [...members, ...agents]
    }, [membersData, agentsData])
}
