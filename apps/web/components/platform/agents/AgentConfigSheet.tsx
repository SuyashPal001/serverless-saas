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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
    Tooltip, 
    TooltipTrigger, 
    TooltipContent, 
    TooltipProvider 
} from '@/components/ui/tooltip';
import { Loader2, Info, Lock, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
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

interface AgentPolicy {
    id: string;
    agentId: string;
    allowedActions: string[];
    blockedActions: string[];
    requiresApproval: string[];
}

interface AgentConfigSheetProps {
    agent: Agent;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const AVAILABLE_TOOLS = [
    { name: 'retrieve_documents', label: 'Knowledge base', description: 'Search tenant documents via RAG', locked: true },
    { name: 'web_search', label: 'Web search', description: 'Search the web for current information', locked: false },
    { name: 'send_email', label: 'Send email', description: 'Send emails on your behalf', locked: false },
    { name: 'code_execution', label: 'Code execution', description: 'Write and run code', locked: false },
    { name: 'browser', label: 'Browser', description: 'Browse and interact with websites', locked: false },
];

export function AgentConfigSheet({ agent, open, onOpenChange }: AgentConfigSheetProps) {
    const queryClient = useQueryClient();

    const [agentName, setAgentName] = useState(agent.name);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [temperature, setTemperature] = useState(0.7);
    const [maxTokens, setMaxTokens] = useState(2048);
    
    // Tools & Policy state
    const [enabledTools, setEnabledTools] = useState<string[]>(['retrieve_documents']);
    const [requiresApproval, setRequiresApproval] = useState<string[]>([]);

    const { data: skillsData, isLoading: isLoadingSkills } = useQuery<{ data: AgentSkill[] }>({
        queryKey: ['agent-skills', agent.id],
        queryFn: () => api.get(`/api/v1/agents/${agent.id}/skills`),
        enabled: open,
    });

    const { data: policiesData, isLoading: isLoadingPolicies } = useQuery<{ data: AgentPolicy | null }>({
        queryKey: ['agent-policies', agent.id],
        queryFn: () => api.get(`/api/v1/agents/${agent.id}/policies`),
        enabled: open,
    });

    const isLoading = isLoadingSkills || isLoadingPolicies;
    const existingSkill = skillsData?.data?.[0] ?? null;
    const existingPolicy = policiesData?.data ?? null;

    useEffect(() => {
        if (open) {
            setAgentName(agent.name);
        }
        if (existingSkill) {
            setSystemPrompt(existingSkill.systemPrompt ?? '');
            const cfg = (existingSkill.config ?? {}) as Record<string, unknown>;
            setTemperature(typeof cfg.temperature === 'number' ? cfg.temperature : 0.7);
            setMaxTokens(typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 2048);
            setEnabledTools(existingSkill.tools ?? ['retrieve_documents']);
        }
        if (existingPolicy) {
            setRequiresApproval(existingPolicy.requiresApproval ?? []);
        }
    }, [open, agent.name, existingSkill, existingPolicy]);

    // Mutation for skills (tools + prompt + config)
    const skillMutation = useMutation({
        mutationFn: (updatedTools?: string[]) => {
            const body = {
                name: existingSkill?.name ?? 'default',
                systemPrompt,
                tools: updatedTools ?? enabledTools,
                config: { temperature, maxTokens },
            };
            if (existingSkill) {
                return api.put(`/api/v1/agents/${agent.id}/skills/${existingSkill.id}`, body);
            }
            return api.post(`/api/v1/agents/${agent.id}/skills`, body);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-skills', agent.id] });
        },
        onError: (err: any) => {
            toast.error(err?.data?.error ?? 'Failed to update skills');
        },
    });

    // Mutation for policies (approval)
    const policyMutation = useMutation({
        mutationFn: (updatedApproval?: string[]) => {
            const body = {
                requiresApproval: updatedApproval ?? requiresApproval,
            };
            return api.put(`/api/v1/agents/${agent.id}/policies`, body);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-policies', agent.id] });
        },
        onError: (err: any) => {
            toast.error(err?.data?.error ?? 'Failed to update policies');
        },
    });

    // Mutation for agent metadata (name)
    const agentMutation = useMutation({
        mutationFn: (params: { name: string }) => 
            api.patch(`/api/v1/agents/${agent.id}`, params),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agents'] });
        },
        onError: (err: any) => {
            toast.error(err?.data?.error ?? 'Failed to update agent name');
        },
    });

    const handleToolToggle = (toolName: string, checked: boolean) => {
        let newTools = [...enabledTools];
        let newApproval = [...requiresApproval];

        if (checked) {
            if (!newTools.includes(toolName)) newTools.push(toolName);
            // Action tools (not retrieve/web) require approval
            if (toolName !== 'retrieve_documents' && toolName !== 'web_search') {
                if (!newApproval.includes(toolName)) newApproval.push(toolName);
            }
        } else {
            newTools = newTools.filter(t => t !== toolName);
            newApproval = newApproval.filter(t => t !== toolName);
        }

        setEnabledTools(newTools);
        setRequiresApproval(newApproval);

        // Immediate updates as requested
        skillMutation.mutate(newTools);
        policyMutation.mutate(newApproval);
    };

    const handleSave = async () => {
        if (!agentName.trim()) {
            toast.error('Agent name cannot be empty');
            return;
        }

        try {
            await Promise.all([
                agentMutation.mutateAsync({ name: agentName }),
                skillMutation.mutateAsync(undefined),
                policyMutation.mutateAsync(undefined)
            ]);
            toast.success('Agent configuration saved');
        } catch (error) {
            // Errors handled in mutations
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col gap-0 p-0">
                <SheetHeader className="px-6 py-5 border-b border-border bg-muted/20">
                    <SheetTitle>Configure Agent</SheetTitle>
                    <SheetDescription>{agent.name}</SheetDescription>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
                        {/* Agent Name */}
                        <div className="space-y-3">
                            <Label htmlFor="agent-name" className="text-[11px] font-bold tracking-wider text-muted-foreground/70">Agent name</Label>
                            <Input
                                id="agent-name"
                                value={agentName}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAgentName(e.target.value)}
                                placeholder="Enter agent name..."
                                readOnly
                                className="bg-muted/20 focus:bg-background transition-colors"
                            />
                        </div>

                        {/* System Prompt */}
                        <div className="space-y-3">
                            <Label htmlFor="system-prompt" className="text-[11px] font-bold tracking-wider text-muted-foreground/70">General prompt</Label>
                            <Textarea
                                id="system-prompt"
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                placeholder="You are a helpful assistant..."
                                rows={6}
                                readOnly
                                className="resize-none font-mono text-sm bg-muted/20 focus:bg-background transition-colors"
                            />
                        </div>

                        {/* Tools Section */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="text-[11px] font-bold tracking-wider text-muted-foreground/70 font-mono">Capabilities & tools</Label>
                            </div>
                            <div className="space-y-3">
                                <TooltipProvider>
                                    {AVAILABLE_TOOLS.map((tool) => {
                                        const isEnabled = enabledTools.includes(tool.name);
                                        const needsApproval = requiresApproval.includes(tool.name);
                                        
                                        return (
                                            <div key={tool.name} className={cn("flex items-start gap-4 p-3 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-colors", !tool.locked && "hidden")}>
                                                <div className="pt-0.5">
                                                    {tool.locked ? (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div className="flex h-5 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 cursor-not-allowed opacity-50">
                                                                    <Lock className="h-3 w-3 text-primary" />
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                Always enabled — required for knowledge base search
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    ) : (
                                                        <Switch 
                                                            checked={isEnabled} 
                                                            onCheckedChange={(checked) => handleToolToggle(tool.name, checked)}
                                                            disabled={skillMutation.isPending || policyMutation.isPending}
                                                        />
                                                    )}
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-semibold leading-none">{tool.label}</span>
                                                        {isEnabled && needsApproval && (
                                                            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[9px] h-4 font-bold uppercase tracking-tighter">
                                                                <ShieldAlert className="h-2.5 w-2.5 mr-1" />
                                                                Requires approval
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                                        {tool.description}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </TooltipProvider>
                            </div>
                        </div>

                        {/* Model Configuration */}
                        <div className="hidden space-y-6 pt-2 border-t border-border/50">
                            <Label className="text-[11px] font-bold tracking-wider text-muted-foreground/70 font-mono">Model configuration</Label>
                            
                            {/* Temperature */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <Label htmlFor="temperature" className="text-sm font-medium">Temperature</Label>
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-[200px]">
                                                    Controls randomness: Lower is more focused, higher is more creative.
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                    <span className="text-sm font-mono tabular-nums bg-muted px-1.5 py-0.5 rounded">
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
                            </div>

                            {/* Max Tokens */}
                            <div className="space-y-4">
                                <Label htmlFor="max-tokens" className="text-sm font-medium">Max Tokens</Label>
                                <div className="flex gap-4 items-center">
                                    <input
                                        id="max-tokens"
                                        type="number"
                                        min={256}
                                        max={8192}
                                        step={256}
                                        value={maxTokens}
                                        onChange={(e) =>
                                            setMaxTokens(parseInt(e.target.value, 10) || 2048)
                                        }
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="hidden px-6 py-4 border-t border-border mt-auto bg-muted/10">
                    <Button
                        className="w-full"
                        onClick={handleSave}
                        disabled={skillMutation.isPending || policyMutation.isPending || agentMutation.isPending || isLoading || !systemPrompt.trim() || !agentName.trim()}
                    >
                        {(skillMutation.isPending || policyMutation.isPending || agentMutation.isPending) && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {(skillMutation.isPending || policyMutation.isPending || agentMutation.isPending) ? 'Saving...' : 'Save Configuration'}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
