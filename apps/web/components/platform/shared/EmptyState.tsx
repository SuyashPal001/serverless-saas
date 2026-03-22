"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    className?: string;
}

export function EmptyState({
    icon,
    title,
    description,
    action,
    className
}: EmptyStateProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center text-center py-16 px-4 border border-dashed rounded-lg bg-card text-card-foreground", className)}>
            <div className="mb-4 text-zinc-500">
                {icon || <Inbox className="w-12 h-12" strokeWidth={1.5} />}
            </div>
            <h3 className="text-lg font-medium text-zinc-200">{title}</h3>
            {description && (
                <p className="mt-2 mb-6 text-sm text-zinc-500 max-w-sm">
                    {description}
                </p>
            )}
            {action && (
                <Button 
                    variant="outline" 
                    onClick={action.onClick}
                    className="mt-2"
                >
                    {action.label}
                </Button>
            )}
        </div>
    );
}
