"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusType = 'active' | 'disabled' | 'error' | 'pending' | 'connected' | 'disconnected' | 'success' | 'failed' | 'running' | 'completed' | 'cancelled';

export interface StatusBadgeProps {
    status: StatusType;
    size?: 'sm' | 'md';
    className?: string;
}

const statusConfig: Record<StatusType, { class: string }> = {
    active: { class: "bg-green-500/10 text-green-500 border-green-500/20" },
    connected: { class: "bg-green-500/10 text-green-500 border-green-500/20" },
    success: { class: "bg-green-500/10 text-green-500 border-green-500/20" },
    completed: { class: "bg-green-500/10 text-green-500 border-green-500/20" },
    disabled: { class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
    pending: { class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
    running: { class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
    error: { class: "bg-red-500/10 text-red-500 border-red-500/20" },
    failed: { class: "bg-red-500/10 text-red-500 border-red-500/20" },
    disconnected: { class: "bg-red-500/10 text-red-500 border-red-500/20" },
    cancelled: { class: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
};

export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
    const config = statusConfig[status];
    
    return (
        <Badge 
            variant="outline" 
            className={cn(
                "capitalize font-medium tracking-wide flex items-center gap-1.5 whitespace-nowrap",
                size === 'sm' ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1",
                config?.class,
                className
            )}
        >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {status}
        </Badge>
    );
}
