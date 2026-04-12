"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, AlertCircle, User, Cpu, Calendar, Pause, Check, Lock, Save, X, Edit2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { WorkflowsList } from "@/components/platform/agents/WorkflowsList";
import { toast } from "sonner";
import type { AgentDetail, AgentStatus } from "@/components/platform/agents/types";
import { cn } from "@/lib/utils";

interface LLMProvider {
    id: string;
    provider: string;
    model: string;
    displayName: string;
    openclawModelId: string;
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

const PROVIDER_LABELS: Record<string, string> = {
    vertex: "Google",
    anthropic: "Anthropic",
    openai: "OpenAI",
    mistral: "Mistral",
    openrouter: "OpenRouter",
    kimi: "Kimi",
};

const PROVIDER_BADGE_COLORS: Record<string, string> = {
    vertex: "bg-blue-500/10 text-blue-400",
    anthropic: "bg-orange-500/10 text-orange-400",
    openai: "bg-emerald-500/10 text-emerald-400",
    mistral: "bg-purple-500/10 text-purple-400",
    openrouter: "bg-slate-500/10 text-slate-400",
    kimi: "bg-teal-500/10 text-teal-400",
};

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
    const { tenantId, permissions = [] } = useTenant();

    const [isEditing, setIsEditing] = React.useState(false);
    const [editForm, setEditForm] = React.useState({ name: "" });

    // General Prompt editing state
    const [promptDraft, setPromptDraft] = React.useState("");
    const [isPromptDirty, setIsPromptDirty] = React.useState(false);

    // Tools state (web_search toggled independently from prompt)
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

    // Sync prompt + tools from fetched skill
    React.useEffect(() => {
        if (existingSkill) {
            setPromptDraft(existingSkill.systemPrompt ?? "");
            setWebSearchEnabled(existingSkill.tools?.includes("web_search") ?? false);
            setIsPromptDirty(false);
        }
    }, [existingSkill]);

    React.useEffect(() => {
        if (agent) {
            setEditForm({ name: agent.name });
        }
    }, [agent]);

    const updateAgentMutation = useMutation({
        mutationFn: (values: { name?: string; status?: AgentStatus }) =>
            api.patch(`/api/v1/agents/${agentId}`, values),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agents", agentId] });
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            setIsEditing(false);
            toast.success("Agent updated successfully");
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update agent");
        },
    });

    const updateModelMutation = useMutation({
        mutationFn: (llmProviderId: string) =>
            api.patch(`/api/v1/agents/${agentId}`, { llmProviderId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agents", agentId] });
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            toast.success("Model updated");
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update model");
        },
    });

    const updateStatusMutation = useMutation({
        mutationFn: (status: AgentStatus) =>
            api.patch(`/api/v1/agents/${agentId}`, { status }),
        onSuccess: (_, status) => {
            queryClient.invalidateQueries({ queryKey: ["agents", agentId] });
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            toast.success(`Agent ${status === "paused" ? "paused" : "resumed"} successfully`);
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update agent");
        },
    });

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

    const isPaused = agent?.status === "paused";

    return (
        <PermissionGate resource="agents" action="read">
        <div className="space-y-8">
            <div className="space-y-4">
                <Link
                    href={`/${tenantSlug}/dashboard/agents`}
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground w-fit"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Agents
                </Link>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                                {isEditing ? (
                                    <Input
                                        value={editForm.name}
                                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="text-3xl font-bold tracking-tight h-auto py-1 max-w-md"
                                    />
                                ) : (
                                    <h1 className="text-3xl font-bold tracking-tight">{agent?.name}</h1>
                                )}
                                <Badge variant="secondary" className={typeColors[agent?.type || ""]}>
                                    {agent?.type}
                                </Badge>
                                <Badge variant="outline" className={statusColors[agent?.status || ""]}>
                                    {agent?.status}
                                </Badge>
                            </div>
                            <p className="text-muted-foreground">
                                Manage and monitor workflow executions for this agent.
                            </p>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        {!isLoadingAgent && canUpdate && agent?.status !== "retired" && (
                            <>
                                {isEditing ? (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsEditing(false)}
                                        >
                                            <X className="mr-2 h-4 w-4" />
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => updateAgentMutation.mutate(editForm)}
                                            disabled={updateAgentMutation.isPending}
                                        >
                                            <Save className="mr-2 h-4 w-4" />
                                            Save Changes
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsEditing(true)}
                                        >
                                            <Edit2 className="mr-2 h-4 w-4" />
                                            Edit Agent
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => updateStatusMutation.mutate(isPaused ? "active" : "paused")}
                                            disabled={updateStatusMutation.isPending}
                                        >
                                            {isPaused ? (
                                                <>
                                                    <Play className="mr-2 h-4 w-4" />
                                                    Reactivate
                                                </>
                                            ) : (
                                                <>
                                                    <Pause className="mr-2 h-4 w-4" />
                                                    Pause
                                                </>
                                            )}
                                        </Button>
                                    </>
                                )}
                            </>
                        )}
                        {!isLoadingAgent && !isEditing && (
                            <Button size="sm" asChild>
                                <Link href={`/${tenantSlug}/dashboard/agents/${agentId}/runs`}>
                                    <Play className="mr-2 h-4 w-4" />
                                    View Runs
                                </Link>
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Info cards ───────────────────────────────────────────────── */}
            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-2">
                    <CardContent className="pt-6">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div className="flex items-start gap-3">
                                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                    <Cpu className="h-5 w-5" />
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium text-muted-foreground">AI Model</p>
                                    {isLoadingAgent ? (
                                        <Skeleton className="h-5 w-24" />
                                    ) : (
                                        <p className="font-semibold">
                                            {providers.find((p) => p.id === agent?.llmProviderId)?.displayName
                                                || providers.find((p) => p.isDefault)?.displayName
                                                || agent?.model
                                                || "Not set"}
                                        </p>
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
            </div>

            {/* ── Model Picker ─────────────────────────────────────────────── */}
            {!isLoadingAgent && providers.length > 0 && (() => {
                const effectiveId = agent?.llmProviderId || providers.find((p) => p.isDefault)?.id;
                return (
                    <Card>
                        <CardContent className="pt-6">
                            <div className="mb-4">
                                <h3 className="text-sm font-semibold">AI Model</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Select the model this agent runs on. Changes take effect immediately.
                                </p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {providers.map((p) => {
                                    const isSelected = p.id === effectiveId;
                                    const isLive = p.status === "live";
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            disabled={!isLive || !canUpdate || updateModelMutation.isPending}
                                            onClick={() => {
                                                if (isLive && canUpdate && p.id !== agent?.llmProviderId) {
                                                    updateModelMutation.mutate(p.id);
                                                }
                                            }}
                                            className={cn(
                                                "relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
                                                isLive && canUpdate
                                                    ? "cursor-pointer hover:border-primary/60 hover:bg-muted/30"
                                                    : "cursor-not-allowed opacity-50",
                                                isSelected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-border bg-transparent",
                                            )}
                                        >
                                            {isSelected && (
                                                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                                    <Check className="h-3 w-3 text-primary-foreground" />
                                                </span>
                                            )}
                                            <div className="flex items-center gap-2 pr-6">
                                                <Badge
                                                    variant="secondary"
                                                    className={cn(
                                                        "text-[10px] h-5 px-1.5 font-medium",
                                                        PROVIDER_BADGE_COLORS[p.provider] ?? "bg-muted text-muted-foreground"
                                                    )}
                                                >
                                                    {PROVIDER_LABELS[p.provider] ?? p.provider}
                                                </Badge>
                                                {!isLive && (
                                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                                                        Coming Soon
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="text-sm font-medium leading-tight">{p.displayName}</span>
                                            <span className="text-[11px] text-muted-foreground font-mono">{p.model}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                );
            })()}

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
                        {/* Knowledge base — always on, locked */}
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

                        {/* Web search — toggleable */}
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

            <div className="pt-4">
                <WorkflowsList agentId={agentId} />
            </div>
        </div>
        </PermissionGate>
    );
}
