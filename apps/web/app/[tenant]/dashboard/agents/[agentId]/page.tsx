"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertCircle, User, Cpu, Calendar, Lock, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { AgentDetail } from "@/components/platform/agents/types";

interface LLMProvider {
    id: string;
    provider: string;
    model: string;
    displayName: string;
    isDefault: boolean;
    status: string;
}

interface LLMProvidersResponse {
    providers: LLMProvider[];
}

interface AgentSkill {
    id: string;
    name: string;
    systemPrompt: string;
    tools: string[];
    config: Record<string, unknown> | null;
    version: number;
    status: "active" | "archived";
}

interface SkillsResponse {
    data: AgentSkill[];
}

const typeColors: Record<string, string> = {
    ops: "bg-blue-500/10 text-blue-500",
    support: "bg-green-500/10 text-green-500",
    billing: "bg-purple-500/10 text-purple-500",
    custom: "bg-orange-500/10 text-orange-500",
};

const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500",
    paused: "bg-yellow-500/10 text-yellow-500",
    retired: "bg-red-500/10 text-red-500",
};

export default function AgentDetailPage() {
    const params = useParams();
    const agentId = params.agentId as string;
    const tenantSlug = params.tenant as string;
    const queryClient = useQueryClient();
    const { permissions = [] } = useTenant();

    const [promptDraft, setPromptDraft] = React.useState("");
    const [isPromptDirty, setIsPromptDirty] = React.useState(false);
    const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);

    const { data: agent, isLoading: isLoadingAgent, error: agentError } = useQuery({
        queryKey: ["agents", agentId],
        queryFn: () => api.get<AgentDetail>(`/api/v1/agents/${agentId}`),
    });

    const { data: providersData } = useQuery<LLMProvidersResponse>({
        queryKey: ["llm-providers"],
        queryFn: () => api.get<LLMProvidersResponse>("/api/v1/llm-providers"),
    });

    const { data: skillsData, isLoading: isLoadingSkills } = useQuery<SkillsResponse>({
        queryKey: ["agent-skills", agentId],
        queryFn: () => api.get<SkillsResponse>(`/api/v1/agents/${agentId}/skills`),
        enabled: !!agentId,
    });

    const providers = providersData?.providers || [];
    const existingSkill = skillsData?.data?.[0] ?? null;

    React.useEffect(() => {
        if (existingSkill) {
            setPromptDraft(existingSkill.systemPrompt ?? "");
            setWebSearchEnabled(existingSkill.tools?.includes("web_search") ?? false);
            setIsPromptDirty(false);
        }
    }, [existingSkill]);

    const saveSkillMutation = useMutation({
        mutationFn: ({ tools, systemPrompt }: { tools: string[]; systemPrompt: string }) => {
            const body = {
                name: existingSkill?.name ?? "default",
                systemPrompt,
                tools,
                config: existingSkill?.config ?? {},
            };
            if (existingSkill) {
                return api.put(`/api/v1/agents/${agentId}/skills/${existingSkill.id}`, body);
            }
            return api.post(`/api/v1/agents/${agentId}/skills`, body);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agent-skills", agentId] });
            setIsPromptDirty(false);
            toast.success("Prompt saved");
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to save prompt");
        },
    });

    const handleWebSearchToggle = (checked: boolean) => {
        setWebSearchEnabled(checked);
        const currentTools = existingSkill?.tools ?? ["retrieve_documents"];
        let newTools = [...currentTools];
        if (checked) {
            if (!newTools.includes("web_search")) newTools.push("web_search");
        } else {
            newTools = newTools.filter((t) => t !== "web_search");
        }
        saveSkillMutation.mutate({
            tools: newTools,
            systemPrompt: promptDraft || existingSkill?.systemPrompt || "",
        });
    };

    const handleSavePrompt = () => {
        const currentTools = existingSkill?.tools ?? ["retrieve_documents"];
        const newTools = [...currentTools];
        if (webSearchEnabled && !newTools.includes("web_search")) newTools.push("web_search");
        saveSkillMutation.mutate({ tools: newTools, systemPrompt: promptDraft });
    };

    const canUpdate = can(permissions, "agents", "update");

    const formattedDate = agent
        ? new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
          }).format(new Date(agent.createdAt))
        : "";

    const resolvedModel =
        providers.find((p) => p.id === agent?.llmProviderId)?.displayName
        || providers.find((p) => p.isDefault)?.displayName
        || agent?.model
        || "Not set";

    if (agentError) {
        return (
            <PermissionGate resource="agents" action="read">
                <div className="space-y-6">
                    <Link
                        href={`/${tenantSlug}/dashboard/agents`}
                        className="flex items-center text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Agents
                    </Link>
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>
                            Failed to load agent details. The agent might not exist or you don&apos;t have access.
                        </AlertDescription>
                    </Alert>
                </div>
            </PermissionGate>
        );
    }

    return (
        <PermissionGate resource="agents" action="read">
        <div className="space-y-8">

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="space-y-4">
                <Link
                    href={`/${tenantSlug}/dashboard/agents`}
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground w-fit"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Agents
                </Link>

                {isLoadingAgent ? (
                    <div className="space-y-2">
                        <Skeleton className="h-10 w-64" />
                        <div className="flex gap-2">
                            <Skeleton className="h-6 w-20" />
                            <Skeleton className="h-6 w-20" />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-bold tracking-tight">{agent?.name}</h1>
                            <Badge variant="secondary" className={typeColors[agent?.type || ""]}>
                                {agent?.type}
                            </Badge>
                            <Badge variant="outline" className={statusColors[agent?.status || ""]}>
                                {agent?.status}
                            </Badge>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Info card ────────────────────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <div className="grid gap-6 sm:grid-cols-3">
                        <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                <Cpu className="h-5 w-5" />
                            </div>
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium text-muted-foreground">AI Model</p>
                                {isLoadingAgent ? (
                                    <Skeleton className="h-5 w-24" />
                                ) : (
                                    <p className="font-semibold">{resolvedModel}</p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                <User className="h-5 w-5" />
                            </div>
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium text-muted-foreground">Created By</p>
                                {isLoadingAgent ? (
                                    <Skeleton className="h-5 w-32" />
                                ) : (
                                    <p className="font-semibold">{agent?.createdByName ?? "Unknown"}</p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                <Calendar className="h-5 w-5" />
                            </div>
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium text-muted-foreground">Created Date</p>
                                {isLoadingAgent ? (
                                    <Skeleton className="h-5 w-40" />
                                ) : (
                                    <p className="font-semibold">{formattedDate}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── General Prompt ───────────────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <div className="mb-4">
                        <h3 className="text-sm font-semibold">General Prompt</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            System instructions that shape this agent&apos;s behaviour on every conversation.
                        </p>
                    </div>
                    {isLoadingSkills ? (
                        <Skeleton className="h-32 w-full" />
                    ) : (
                        <div className="space-y-3">
                            <Textarea
                                value={promptDraft}
                                onChange={(e) => {
                                    setPromptDraft(e.target.value);
                                    setIsPromptDirty(true);
                                }}
                                placeholder="You are a helpful assistant..."
                                rows={6}
                                disabled={!canUpdate}
                                className="resize-none font-mono text-sm"
                            />
                            {canUpdate && isPromptDirty && (
                                <div className="flex justify-end">
                                    <Button
                                        size="sm"
                                        onClick={handleSavePrompt}
                                        disabled={saveSkillMutation.isPending}
                                    >
                                        {saveSkillMutation.isPending && (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        )}
                                        Save Prompt
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Tools ────────────────────────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <div className="mb-4">
                        <h3 className="text-sm font-semibold">Tools</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Capabilities available to this agent during conversations.
                        </p>
                    </div>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium">Knowledge base</p>
                                <p className="text-xs text-muted-foreground">Search tenant documents via RAG</p>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Lock className="h-3.5 w-3.5" />
                                <span className="text-xs">Always on</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium">Web search</p>
                                <p className="text-xs text-muted-foreground">Search the web for current information</p>
                            </div>
                            <Switch
                                checked={webSearchEnabled}
                                onCheckedChange={handleWebSearchToggle}
                                disabled={!canUpdate || saveSkillMutation.isPending || isLoadingSkills}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

        </div>
        </PermissionGate>
    );
}
