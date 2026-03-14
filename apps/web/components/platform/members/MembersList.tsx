"use client";

import { useQuery } from "@tanstack/react-query";
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
}

export function MembersList() {
    const { tenantId, permissions = [] } = useTenant();

    const { data: members, isLoading, isError, error } = useQuery<Member[]>({
        queryKey: ["members", tenantId],
        queryFn: async () => {
            const response = await api.get<{ members: Member[] }>("/api/v1/members");
            return response.members;
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

    const getInitials = (name?: string, email?: string) => {
        if (name) return name.substring(0, 2).toUpperCase();
        if (email) return email.substring(0, 2).toUpperCase();
        return "US";
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
                                            {getInitials(member.userName ?? undefined, member.userEmail ?? undefined)}
                                        </span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-medium text-foreground">
                                            {member.userName || member.userEmail || "Unknown"}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {member.userEmail}
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
                                    <Button variant="ghost" size="sm" className="text-xs">
                                        {member.status === "suspended" ? "Reactivate" : "Suspend"}
                                    </Button>
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
