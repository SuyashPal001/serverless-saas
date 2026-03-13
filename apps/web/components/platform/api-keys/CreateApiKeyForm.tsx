"use client";

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

const apiKeySchema = z.object({
    name: z.string().min(2, { message: "Name must be at least 2 characters." }),
    type: z.enum(["rest", "mcp", "agent"]),
    permissions: z.string().optional(),
    expiresAt: z.string().optional().nullable(),
});

type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

interface CreateApiKeyFormProps {
    onSuccess: (data: { key: string; name: string }) => void;
}

export function CreateApiKeyForm({ onSuccess }: CreateApiKeyFormProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();

    const form = useForm<ApiKeyFormValues>({
        resolver: zodResolver(apiKeySchema),
        defaultValues: {
            name: "",
            type: "rest",
            permissions: "",
            expiresAt: "",
        },
    });

    const createMutation = useMutation({
        mutationFn: (values: ApiKeyFormValues) => {
            const payload = {
                ...values,
                permissions: values.permissions
                    ? values.permissions.split(',').map(p => p.trim()).filter(Boolean)
                    : [],
                expiresAt: values.expiresAt || null,
            };
            return api.post<{ id: string; name: string; type: string; key: string }>("/api/v1/api-keys", payload);
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["api-keys", tenantId] });
            toast.success("API key created successfully");
            form.reset();
            onSuccess({ key: data.key, name: data.name });
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to create API key");
        },
    });

    function onSubmit(data: ApiKeyFormValues) {
        createMutation.mutate(data);
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
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
                    name="permissions"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Permissions (Optional)</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. members:read, billing:read" {...field} />
                            </FormControl>
                            <FormDescription>
                                Comma-separated list of resource:action pairs.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="expiresAt"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Expiry Date (Optional)</FormLabel>
                            <FormControl>
                                <Input type="date" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormDescription>
                                Leave blank for a key that never expires.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end pt-4">
                    <Button
                        type="submit"
                        disabled={createMutation.isPending}
                        className="w-full"
                    >
                        {createMutation.isPending ? "Creating..." : "Create API Key"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
