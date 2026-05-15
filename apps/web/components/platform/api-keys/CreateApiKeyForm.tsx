"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils"; // Assuming cn utility is available

const PERMISSION_RESOURCES = [
    { resource: 'members',          actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'roles',            actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'invitations',      actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'api_keys',         actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'agents',           actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'agent_workflows',  actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'agent_runs',       actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'billing',          actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'subscriptions',    actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'invoices',         actions: ['read'] },
    { resource: 'audit_log',        actions: ['read'] },
    { resource: 'notifications',    actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'tenants',          actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'entitlements',     actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'webhooks',         actions: ['create', 'read', 'update', 'delete'] },
] as const;

const EXPIRY_OPTIONS = [
    { label: "7 days", value: "7d" },
    { label: "30 days", value: "30d" },
    { label: "60 days", value: "60d" },
    { label: "90 days", value: "90d" },
    { label: "1 year", value: "1y" },
    { label: "No expiration", value: "none" },
];

const apiKeySchema = z.object({
    name: z.string().min(2, { message: "Name must be at least 2 characters." }),
    type: z.enum(["rest", "mcp", "agent"]),
    permissions: z.array(z.string()),
    expiryOption: z.string(),
});

type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

interface CreateApiKeyFormProps {
    onSuccess: (data: { key: string; name: string; type: string }) => void;
}

export function CreateApiKeyForm({ onSuccess }: CreateApiKeyFormProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();
    const [step, setStep] = useState(1);

    const form = useForm<ApiKeyFormValues>({
        resolver: zodResolver(apiKeySchema),
        defaultValues: {
            name: "",
            type: "rest",
            permissions: [],
            expiryOption: "none",
        },
    });

    const createMutation = useMutation({
        mutationFn: (values: ApiKeyFormValues) => {
            let expiresAt: string | null = null;
            if (values.expiryOption !== "none") {
                const date = new Date();
                switch (values.expiryOption) {
                    case "7d": date.setDate(date.getDate() + 7); break;
                    case "30d": date.setDate(date.getDate() + 30); break;
                    case "60d": date.setDate(date.getDate() + 60); break;
                    case "90d": date.setDate(date.getDate() + 90); break;
                    case "1y": date.setFullYear(date.getFullYear() + 1); break;
                }
                expiresAt = date.toISOString();
            }

            const payload = {
                name: values.name,
                type: values.type,
                permissions: values.permissions,
                expiresAt,
            };
            return api.post<{ data: { id: string; name: string; type: string; key: string } }>("/api/v1/api-keys", payload);
        },
        onSuccess: (response) => {
            const data = response.data;
            queryClient.invalidateQueries({ queryKey: ["api-keys", tenantId] });
            toast.success("API key created successfully");
            form.reset();
            onSuccess({ key: data.key, name: data.name, type: data.type });
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to create API key");
        },
    });

    const handleNext = async () => {
        const isValid = await form.trigger(["name", "type", "expiryOption"]);
        if (isValid) setStep(2);
    };

    function onSubmit(data: ApiKeyFormValues) {
        createMutation.mutate(data);
    }

    const selectedPermissions = form.watch("permissions");

    const togglePermission = (perm: string) => {
        const current = form.getValues("permissions");
        if (current.includes(perm)) {
            form.setValue("permissions", current.filter(p => p !== perm));
        } else {
            form.setValue("permissions", [...current, perm]);
        }
    };

    const toggleResource = (resource: string, actions: readonly string[], checked: boolean) => {
        const current = form.getValues("permissions");
        const resourcePerms = actions.map(a => `${resource}:${a}`);
        if (checked) {
            const next = Array.from(new Set([...current, ...resourcePerms]));
            form.setValue("permissions", next);
        } else {
            const next = current.filter(p => !resourcePerms.includes(p));
            form.setValue("permissions", next);
        }
    };

    const toggleAll = (checked: boolean) => {
        if (checked) {
            const all = PERMISSION_RESOURCES.flatMap(r => r.actions.map(a => `${r.resource}:${a}`));
            form.setValue("permissions", all);
        } else {
            form.setValue("permissions", []);
        }
    };

    const isAllSelected = PERMISSION_RESOURCES.every(r => 
        r.actions.every(a => selectedPermissions.includes(`${r.resource}:${a}`))
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-4 text-sm font-medium">
                    <div className={cn("flex items-center gap-2", step === 1 ? "text-primary" : "text-muted-foreground")}>
                        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-xs", step === 1 ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30")}>1</span>
                        Details
                    </div>
                    <div className="h-px w-8 bg-muted-foreground/30" />
                    <div className={cn("flex items-center gap-2", step === 2 ? "text-primary" : "text-muted-foreground")}>
                        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-xs", step === 2 ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30")}>2</span>
                        Permissions
                    </div>
                    <div className="h-px w-8 bg-muted-foreground/30" />
                    <div className="flex items-center gap-2 text-muted-foreground opacity-50">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/30 text-xs">3</span>
                        Created
                    </div>
                </div>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {step === 1 && (
                        <div className="space-y-6 pt-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Key Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g. My Application" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            A friendly name to identify this key.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Key Type</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a key type" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="rest">REST API (Standard)</SelectItem>
                                                <SelectItem value="mcp">MCP (Model Context Protocol)</SelectItem>
                                                <SelectItem value="agent">Agent (Autonomous)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="expiryOption"
                                render={({ field }) => (
                                    <FormItem className="space-y-3">
                                        <FormLabel>Expiration</FormLabel>
                                        <FormControl>
                                            <RadioGroup
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                                className="grid grid-cols-2 gap-4"
                                            >
                                                {EXPIRY_OPTIONS.map((opt) => (
                                                    <FormItem key={opt.value} className="flex items-center space-x-3 space-y-0">
                                                        <FormControl>
                                                            <RadioGroupItem value={opt.value} />
                                                        </FormControl>
                                                        <FormLabel className="font-normal cursor-pointer w-full">
                                                            {opt.label}
                                                        </FormLabel>
                                                    </FormItem>
                                                ))}
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex justify-end pt-4">
                                <Button type="button" onClick={handleNext} className="w-full">
                                    Next: Permissions
                                </Button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 pt-2">
                            <div className="flex items-center justify-between pb-2 border-b">
                                <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Permissions Configuration</div>
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="select-all" className="text-xs font-medium cursor-pointer">Select All</Label>
                                    <Checkbox 
                                        id="select-all" 
                                        checked={isAllSelected}
                                        onCheckedChange={toggleAll}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-12 items-center gap-4 px-2 pb-2">
                                <div className="col-span-4" />
                                <div className="col-span-6 flex gap-4">
                                    {['create', 'read', 'update', 'delete'].map(action => (
                                        <div key={action} className="flex flex-col items-center w-[18px]">
                                            <span className="text-[10px] uppercase font-bold tracking-tighter text-muted-foreground">
                                                {action.charAt(0)}
                                            </span>
                                            <span className="text-[9px] text-muted-foreground/50 capitalize">{action}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="col-span-2" />
                            </div>

                            <div className="max-h-[300px] overflow-y-auto space-y-4 pr-2 scrollbar-thin scrollbar-thumb-muted">
                                {PERMISSION_RESOURCES.map((res) => {
                                    const resourcePerms = res.actions.map(a => `${res.resource}:${a}`);
                                    const isResAllSelected = res.actions.every(a => selectedPermissions.includes(`${res.resource}:${a}`));
                                    
                                    return (
                                        <div key={res.resource} className="grid grid-cols-12 items-center gap-4 py-2 border-b border-muted/30 last:border-0 hover:bg-accent/5 px-2 rounded-sm transition-colors">
                                            <div className="col-span-4">
                                                <div className="text-sm font-medium capitalize">{res.resource.replace('_', ' ')}</div>
                                            </div>
                                            
                                            <div className="col-span-6 flex gap-4">
                                                {['create', 'read', 'update', 'delete'].map(action => {
                                                    const available = res.actions.includes(action as any);
                                                    const perm = `${res.resource}:${action}`;
                                                    return (
                                                        <div key={action} className="flex flex-col items-center gap-1">
                                                            <Checkbox 
                                                                checked={available && selectedPermissions.includes(perm)}
                                                                onCheckedChange={() => available && togglePermission(perm)}
                                                                disabled={!available}
                                                                className={!available ? "opacity-20 bg-muted" : ""}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="col-span-2 flex justify-end items-center gap-2 border-l pl-4 border-muted/30">
                                                <span className="text-[10px] uppercase font-bold text-muted-foreground">All</span>
                                                <Checkbox 
                                                    checked={isResAllSelected}
                                                    onCheckedChange={(checked) => toggleResource(res.resource, res.actions, !!checked)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Selected Access Scope</Label>
                                <div className="p-3 rounded-md bg-muted/30 min-h-[60px] flex flex-wrap gap-2 items-start border">
                                    {selectedPermissions.length > 0 ? (
                                        selectedPermissions.map(p => (
                                            <Badge key={p} variant="secondary" className="text-[10px] font-mono border-muted-foreground/20">
                                                {p}
                                            </Badge>
                                        ))
                                    ) : (
                                        <div className="text-xs text-amber-500 font-medium italic">
                                            No permissions selected — key will have full access
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">
                                    Back
                                </Button>
                                <Button 
                                    type="submit" 
                                    disabled={createMutation.isPending} 
                                    className="flex-[2]"
                                >
                                    {createMutation.isPending ? "Creating..." : "Create API Key"}
                                </Button>
                            </div>
                        </div>
                    )}
                </form>
            </Form>
        </div>
    );
}
