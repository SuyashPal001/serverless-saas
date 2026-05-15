"use client";

import * as React from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface SlideOutPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    width?: 'sm' | 'md' | 'lg';
}

const widthStyles = {
    sm: "sm:max-w-sm",
    md: "sm:max-w-md",
    lg: "sm:max-w-lg",
};

export function SlideOutPanel({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    width = 'md'
}: SlideOutPanelProps) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent 
                side="right" 
                className={cn("flex flex-col h-full bg-zinc-950 border-zinc-800 p-0", widthStyles[width])}
            >
                <SheetHeader className="px-6 py-6 border-b border-zinc-800">
                    <SheetTitle>{title}</SheetTitle>
                    {description && (
                        <SheetDescription>
                            {description}
                        </SheetDescription>
                    )}
                </SheetHeader>
                
                <div className="flex-1 overflow-y-auto px-6 py-6">
                    {children}
                </div>
                
                {footer && (
                    <SheetFooter className="px-6 py-4 border-t border-zinc-800 mt-auto">
                        <div className="w-full flex justify-end gap-2">
                            {footer}
                        </div>
                    </SheetFooter>
                )}
            </SheetContent>
        </Sheet>
    );
}
