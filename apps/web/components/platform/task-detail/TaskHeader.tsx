'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowUp, ArrowDown, ChevronRight, Pencil, MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Task } from '@/types/task'

interface TaskHeaderProps {
    task: Task
    editState: {
        isEditing: boolean
        onEdit: () => void
        onCancel: () => void
        onSave: () => void
    }
    taskOperations: {
        vote: (direction: 'up' | 'down') => Promise<void>
        deleteTask: () => Promise<void>
    }
}

export function TaskHeader({ task, editState, taskOperations }: TaskHeaderProps) {
    const params = useParams()
    const tenantSlug = params.tenant as string

    return (
        <div className="flex items-center justify-between px-8 py-3 border-b border-[#1e1e1e] flex-shrink-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
                <Link href={`/${tenantSlug}/dashboard/board`} className="hover:text-foreground">Board</Link>
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5" />
                <span>Work Items</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5" />
                <span className="text-foreground">TASK-{task.id.slice(0, 6).toUpperCase()}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
                {/* Vote buttons */}
                <button
                    onClick={() => taskOperations.vote('up')}
                    className="rounded-md bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-1 text-xs flex items-center gap-1 text-muted-foreground hover:bg-[#222] transition-colors"
                >
                    <ArrowUp className="w-3 h-3" /> {task.upvotes || 0}
                </button>
                <button
                    onClick={() => taskOperations.vote('down')}
                    className="rounded-md bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-1 text-xs flex items-center gap-1 text-muted-foreground hover:bg-[#222] transition-colors"
                >
                    <ArrowDown className="w-3 h-3" /> {task.downvotes || 0}
                </button>

                {/* Edit / Cancel / Save */}
                {editState.isEditing ? (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-muted-foreground"
                            onClick={editState.onCancel}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={editState.onSave}
                        >
                            Save
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2 gap-1.5 text-muted-foreground hover:text-foreground"
                        onClick={editState.onEdit}
                    >
                        <Pencil className="w-3 h-3" /> Edit
                    </Button>
                )}

                {/* Delete dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground">
                            <MoreHorizontal className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onClick={() => {
                                if (window.confirm('Delete this task? This cannot be undone.')) taskOperations.deleteTask()
                            }}
                            className="text-red-500 focus:text-red-400 focus:bg-red-500/10 cursor-pointer"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}
