import type { Metadata } from 'next'
import { PermissionGate } from '@/components/platform/PermissionGate'
import { TaskDetailView } from '@/components/platform/TaskDetailView'

export const metadata: Metadata = {
    title: 'Task',
}

export default function TaskPage() {
    return (
        <PermissionGate resource="agent_tasks" action="read">
            <TaskDetailView />
        </PermissionGate>
    )
}
