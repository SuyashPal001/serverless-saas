"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Key, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { RevokeApiKeyAction } from "./RevokeApiKeyAction";
import { cn } from "@/lib/utils";

export interface ApiKey {
    id: string;
    name: string;
    type: "rest" | "mcp" | "agent";
    status: "active" | "revoked";
    permissions: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
}

interface ApiKeysResponse {
    apiKeys: ApiKey[];
}

export function ApiKeysList() {
    const { tenantId, permissions = [] } = useTenant();

    const { data, isLoading, isError, error } = useQuery<ApiKeysResponse>({
        queryKey: ["api-keys", tenantId],
        queryFn: () => api.get<ApiKeysResponse>("/api/v1/api-keys"),
    });

    const canRevokeKeys = can(permissions, "api_keys", "delete");

    if (isLoading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                    {error instanceof Error ? error.message : "Failed to load API keys."}
                </AlertDescription>
            </Alert>
        );
    }

    const apiKeys = data?.apiKeys || [];

    if (apiKeys.length === 0) {
        return (
            <div className="text-center py-10 bg-muted/20 rounded-md border border-dashed border-border">
                <p className="text-muted-foreground">No API keys found.</p>
            </div>
        );
    }

    return (
        <div className="rounded-md border border-border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Permissions</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Last Used</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {apiKeys.map((key) => {
                        const isRevoked = key.status === "revoked";
                        return (
                            <TableRow key={key.id} className={cn(isRevoked && "opacity-50 grayscale select-none")}>
                                <TableCell className="font-medium">
                                    <div className="flex items-center gap-2">
                                        <Key className="w-4 h-4 text-primary" />
                                        {key.name}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="uppercase text-[10px] font-bold tracking-wider">
                                        {key.type}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                                        {key.permissions && key.permissions.length > 0 ? (
                                            key.permissions.map((p) => (
                                                <Badge key={p} variant="secondary" className="text-[9px] px-1 py-0 leading-none h-4">
                                                    {p}
                                                </Badge>
                                            ))
                                        ) : (
                                            <span className="text-xs text-muted-foreground italic">Full Access</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant={isRevoked ? "secondary" : "default"}
                                        className={cn(
                                            "text-[10px] uppercase font-bold tracking-wider",
                                            !isRevoked && "bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/10"
                                        )}
                                    >
                                        {key.status}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {new Date(key.createdAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {key.lastUsedAt ? (
                                        <div className="flex items-center gap-1">
                                            <Activity className="w-3 h-3" />
                                            {new Date(key.lastUsedAt).toLocaleDateString()}
                                        </div>
                                    ) : "Never"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "Never"}
                                </TableCell>
                                <TableCell className="text-right">
                                    {!isRevoked && canRevokeKeys && (
                                        <RevokeApiKeyAction apiKeyId={key.id} apiKeyName={key.name} />
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
