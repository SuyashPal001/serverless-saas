'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import type { Agent } from './types';

interface AgentSkill {
    id: string;
    name: string;
    systemPrompt: string;
    tools: string[];
    config: Record<string, unknown> | null;
    version: number;
    status: 'active' | 'archived';
}

interface AgentConfigSheetProps {
    agent: Agent;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AgentConfigSheet({ agent, open, onOpenChange }: AgentConfigSheetProps) {
    const queryClient = useQueryClient();

    const [systemPrompt, setSystemPrompt] = useState('');
    const [temperature, setTemperature] = useState(0.7);
    const [maxTokens, setMaxTokens] = useState(2048);

    const { data: skillsData, isLoading } = useQuery<{ data: AgentSkill[] }>({
        queryKey: ['agent-skills', agent.id],
        queryFn: () => api.get(`/api/v1/agents/${agent.id}/skills`),
        enabled: open,
    });

    const existingSkill = skillsData?.data?.[0] ?? null;

    useEffect(() => {
        if (existingSkill) {
            setSystemPrompt(existingSkill.systemPrompt ?? '');
            const cfg = (existingSkill.config ?? {}) as Record<string, unknown>;
            setTemperature(typeof cfg.temperature === 'number' ? cfg.temperature : 0.7);
            setMaxTokens(typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 2048);
        } else if (!isLoading) {
            setSystemPrompt('');
            setTemperature(0.7);
            setMaxTokens(2048);
        }
    }, [existingSkill, isLoading]);

    const saveMutation = useMutation({
        mutationFn: () => {
            const body = {
                name: existingSkill?.name ?? 'default',
                systemPrompt,
                config: { temperature, maxTokens },
            };
            if (existingSkill) {
                return api.put(`/api/v1/agents/${agent.id}/skills/${existingSkill.id}`, body);
            }
            return api.post(`/api/v1/agents/${agent.id}/skills`, body);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-skills', agent.id] });
            toast.success('Agent configuration saved');
        },
        onError: (err: any) => {
            toast.error(err?.data?.error ?? 'Failed to save configuration');
        },
    });

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col gap-0 p-0">
                <SheetHeader className="px-6 py-5 border-b border-border">
                    <SheetTitle>Configure Agent</SheetTitle>
                    <SheetDescription>{agent.name}</SheetDescription>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                        {/* System Prompt */}
                        <div className="space-y-2">
                            <Label htmlFor="system-prompt">System Prompt</Label>
                            <Textarea
                                id="system-prompt"
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                placeholder="You are a helpful assistant..."
                                rows={8}
                                className="resize-none font-mono text-sm"
                            />
                        </div>

                        {/* Temperature */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="temperature">Temperature</Label>
                                <span className="text-sm font-medium tabular-nums">
                                    {temperature.toFixed(1)}
                                </span>
                            </div>
                            <input
                                id="temperature"
                                type="range"
                                min={0}
                                max={1}
                                step={0.1}
                                value={temperature}
                                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer accent-primary"
                            />
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                                <span>Precise (0.0)</span>
                                <span>Creative (1.0)</span>
                            </div>
                        </div>

                        {/* Max Tokens */}
                        <div className="space-y-2">
                            <Label htmlFor="max-tokens">Max Tokens</Label>
                            <input
                                id="max-tokens"
                                type="number"
                                min={256}
                                max={32768}
                                step={256}
                                value={maxTokens}
                                onChange={(e) =>
                                    setMaxTokens(parseInt(e.target.value, 10) || 2048)
                                }
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                        </div>
                    </div>
                )}

                <div className="px-6 py-4 border-t border-border mt-auto">
                    <Button
                        className="w-full"
                        onClick={() => saveMutation.mutate()}
                        disabled={saveMutation.isPending || isLoading || !systemPrompt.trim()}
                    >
                        {saveMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
