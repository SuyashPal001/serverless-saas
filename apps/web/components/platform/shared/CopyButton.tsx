"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CopyButtonProps {
    value: string;
    className?: string;
    size?: 'sm' | 'md' | 'icon';
    showLabel?: boolean;
}

export function CopyButton({ value, className, size = 'icon', showLabel = false }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const copyToClipboard = () => {
        if (!value) return;
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch((err) => {
            console.error('Failed to copy text', err);
        });
    };

    const buttonProps = {
        variant: "ghost" as const,
        size: (showLabel ? (size === 'icon' ? 'sm' : size) : 'icon') as "sm" | "default" | "icon",
        onClick: copyToClipboard,
        className: cn("text-muted-foreground hover:text-foreground", className)
    };

    if (showLabel) {
        return (
            <Button {...buttonProps}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="ml-2">{copied ? "Copied!" : "Copy"}</span>
            </Button>
        );
    }

    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button {...buttonProps}>
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{copied ? "Copied!" : "Copy to clipboard"}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
