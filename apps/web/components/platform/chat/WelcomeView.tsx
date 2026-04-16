"use client";

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PillType } from "./WizardView";

const SUGGESTED_PROMPTS: { emoji: string; label: string; pill: PillType }[] = [
    { emoji: "📄", label: "Summarize a document", pill: "summarize" },
    { emoji: "📅", label: "Schedule a meeting",   pill: "schedule"  },
    { emoji: "🔍", label: "Research a topic",     pill: "research"  },
    { emoji: "✍️", label: "Draft an email",        pill: "draft"     },
];

interface WelcomeViewProps {
    agentName: string;
    firstName: string;
    onSelectPill: (pill: PillType) => void;
    children: React.ReactNode;
}

export function WelcomeView({ agentName, firstName, onSelectPill, children }: WelcomeViewProps) {
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6 shadow-sm border border-border">
                    <Bot className="h-8 w-8 text-muted-foreground" />
                </div>

                <h2 className="text-2xl font-bold tracking-tight mb-1">
                    Hi {firstName}! I&apos;m {agentName}.
                </h2>
                <p className="text-muted-foreground text-sm mb-8">
                    Here&apos;s what I can help with:
                </p>

                <div className="flex flex-wrap gap-3 justify-center max-w-md">
                    {SUGGESTED_PROMPTS.map(({ emoji, label, pill }) => (
                        <Button
                            key={pill}
                            variant="outline"
                            className="gap-2 rounded-full px-5 py-2 h-auto text-sm font-medium border-border hover:bg-muted/60 transition-colors"
                            onClick={() => onSelectPill(pill)}
                        >
                            {emoji} {label}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="shrink-0 pt-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                {children}
            </div>
        </div>
    );
}
