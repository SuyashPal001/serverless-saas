"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusType = 'active' | 'disabled' | 'error' | 'pending' | 'connected' | 'disconnected' | 'success' | 'failed' | 'running' | 'completed' | 'cancelled'
    | 'suspended' | 'deleted' | 'expired' | 'revoked' | 'invited'
    | 'individual' | 'startup' | 'business' | 'enterprise';

export interface StatusBadgeProps {
    status: StatusType;
    size?: 'sm' | 'md';
    className?: string;
}

const statusConfig: Record<StatusType, { class: string; orbClass: string; pulse: boolean }> = {
    active:       { class: "bg-green-500/10 text-green-500 border-green-500/20",   orbClass: "bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.5)]",  pulse: true },
    connected:    { class: "bg-green-500/10 text-green-500 border-green-500/20",   orbClass: "bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.5)]",  pulse: true },
    success:      { class: "bg-green-500/10 text-green-500 border-green-500/20",   orbClass: "bg-green-400 shadow-[0_0_4px_1px_rgba(74,222,128,0.4)]",  pulse: false },
    completed:    { class: "bg-green-500/10 text-green-500 border-green-500/20",   orbClass: "bg-green-400 shadow-[0_0_4px_1px_rgba(74,222,128,0.4)]",  pulse: false },
    disabled:     { class: "bg-amber-500/10 text-amber-500 border-amber-500/20",   orbClass: "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.45)]", pulse: true },
    pending:      { class: "bg-amber-500/10 text-amber-500 border-amber-500/20",   orbClass: "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.45)]", pulse: true },
    running:      { class: "bg-amber-500/10 text-amber-500 border-amber-500/20",   orbClass: "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.45)]", pulse: true },
    error:        { class: "bg-red-500/10 text-red-500 border-red-500/20",         orbClass: "bg-red-400 shadow-[0_0_5px_1px_rgba(248,113,113,0.4)]",   pulse: false },
    failed:       { class: "bg-red-500/10 text-red-500 border-red-500/20",         orbClass: "bg-red-400 shadow-[0_0_5px_1px_rgba(248,113,113,0.4)]",   pulse: false },
    disconnected: { class: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",      orbClass: "bg-zinc-500",                                             pulse: false },
    cancelled:    { class: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",      orbClass: "bg-zinc-500",                                             pulse: false },
    invited:      { class: "bg-blue-500/10 text-blue-400 border-blue-500/20",       orbClass: "bg-blue-400",                                             pulse: false },
    // ops statuses
    suspended:    { class: "bg-amber-500/10 text-amber-500 border-amber-500/20",   orbClass: "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.45)]", pulse: false },
    deleted:      { class: "bg-red-500/10 text-red-500 border-red-500/20",         orbClass: "bg-red-400 shadow-[0_0_5px_1px_rgba(248,113,113,0.4)]",   pulse: false },
    expired:      { class: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",      orbClass: "bg-zinc-500",                                             pulse: false },
    revoked:      { class: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",      orbClass: "bg-zinc-500",                                             pulse: false },
    // tenant types
    individual:   { class: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",      orbClass: "bg-zinc-500",                                             pulse: false },
    startup:      { class: "bg-blue-500/10 text-blue-400 border-blue-500/20",      orbClass: "bg-blue-400",                                             pulse: false },
    business:     { class: "bg-violet-500/10 text-violet-400 border-violet-500/20",orbClass: "bg-violet-400",                                           pulse: false },
    enterprise:   { class: "bg-amber-500/10 text-amber-400 border-amber-500/20",   orbClass: "bg-amber-400",                                            pulse: false },
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
            <span className={cn(
                "h-2 w-2 rounded-full flex-shrink-0",
                config?.orbClass,
                config?.pulse && "animate-pulse"
            )} />
            {status}
        </Badge>
    );
}
