"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Member {
    id: string;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    userAvatarUrl: string | null;
    roleId: string | null;
    roleName: string | null;
    memberType: "human" | "agent";
    status: "active" | "invited" | "suspended";
    joinedAt: string | null;
    agentId: string | null;
    agentName: string | null;
    agentType: string | null;
}

export function MembersList() {
    const { tenantId, permissions = [] } = useTenant();
    const queryClient = useQueryClient();

    const { data: members, isLoading, isError, error } = useQuery<Member[]>({
        queryKey: ["members", tenantId],
        queryFn: async () => {
            const response = await api.get<{ members: Member[] }>("/api/v1/members");
            return response.members;
        },
    });

    const suspendMutation = useMutation({
        mutationFn: (memberId: string) => api.del(`/api/v1/members/${memberId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["members", tenantId] });
        },
    });

    const canUpdateUsers = can(permissions, "users", "update");

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        );
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                    {error instanceof Error ? error.message : "Failed to load members."}
                </AlertDescription>
            </Alert>
        );
    }

    if (!members || members.length === 0) {
        return (
            <div className="text-center py-10 bg-muted/20 rounded-md border border-dashed border-border">
                <p className="text-muted-foreground">No members found.</p>
            </div>
        );
    }

    const getDisplayName = (member: Member): string => {
        if (member.memberType === "agent") {
            return member.agentName || "Unknown Agent";
        }
        if (member.status === "invited" && !member.userName && !member.userEmail) {
            return "Pending invite";
        }
        return member.userName || member.userEmail || "Unknown";
    };

    const getInitials = (member: Member): string => {
        if (member.memberType === "agent") {
            const name = member.agentName;
            if (name) return name.substring(0, 2).toUpperCase();
            return "AG";
        }
        if (member.userName) return member.userName.substring(0, 2).toUpperCase();
        if (member.userEmail) return member.userEmail.substring(0, 2).toUpperCase();
        return "??";
    };

    const statusColors = {
        active: "bg-green-500/10 text-green-500 border-green-500/20",
        invited: "bg-amber-500/10 text-amber-500 border-amber-500/20",
        suspended: "bg-destructive/10 text-destructive border-destructive/20",
    };

    return (
        <div className="rounded-md border border-border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Joined</TableHead>
                        {canUpdateUsers && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {members.map((member) => (
                        <TableRow key={member.id}>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center border border-border shrink-0">
                                        <span className="text-xs font-bold text-accent-foreground">
                                            {getInitials(member)}
                                        </span>
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-foreground">
                                                {getDisplayName(member)}
                                            </span>
                                            {member.memberType === "agent" && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] px-1.5 py-0 bg-purple-500/10 text-purple-400 border-purple-500/20"
                                                >
                                                    agent
                                                </Badge>
                                            )}
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {member.memberType === "agent"
                                                ? member.agentType ?? ""
                                                : member.userEmail ?? ""}
                                        </span>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Badge variant="outline" className="text-xs">
                                    {member.roleName || member.roleId || "No Role"}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                <Badge
                                    variant="outline"
                                    className={`text-[10px] uppercase font-bold tracking-wider ${statusColors[member.status] || ""}`}
                                >
                                    {member.status}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                                {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "—"}
                            </TableCell>
                            {canUpdateUsers && (
                                <TableCell className="text-right">
                                    {member.status !== "suspended" && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-xs"
                                            disabled={suspendMutation.isPending}
                                            onClick={() => suspendMutation.mutate(member.id)}
                                        >
                                            Suspend
                                        </Button>
                                    )}
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
