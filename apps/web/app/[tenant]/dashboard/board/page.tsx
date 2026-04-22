import type { Metadata } from 'next'
import { PermissionGate } from '@/components/platform/PermissionGate'
import { BoardView } from '@/components/platform/BoardView'

export const metadata: Metadata = {
    title: 'Board',
}

export default function BoardPage() {
    return (
        <PermissionGate resource="agent_tasks" action="read">
            <BoardView />
        </PermissionGate>
    )
}
