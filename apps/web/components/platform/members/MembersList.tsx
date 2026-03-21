"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can, canUpdate } from "@/lib/permissions";
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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/platform/PermissionGate";
import Link from "next/link";

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

interface Role {
    id: string;
    name: string;
}

export function MembersList({ onInviteClick }: { onInviteClick?: () => void }) {
    const { tenantId, userId, permissions = [] } = useTenant();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<"humans" | "agents">("humans");
    const [selectedMemberForRole, setSelectedMemberForRole] = useState<Member | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState<string>("");

    const { data: members, isLoading, isError, error } = useQuery<Member[]>({
        queryKey: ["members", tenantId],
        queryFn: async () => {
            const response = await api.get<{ members: Member[] }>("/api/v1/members");
            return response.members;
        },
    });

    const { data: rolesData } = useQuery<{ roles: Role[] }>({
        queryKey: ["roles", tenantId],
        queryFn: () => api.get<{ roles: Role[] }>("/api/v1/roles"),
    });
    const roles = rolesData?.roles ?? [];

    const suspendMutation = useMutation({
        mutationFn: (memberId: string) => api.del(`/api/v1/members/${memberId}`),
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ["members", tenantId] });
            if (data?.action === 'suspended') {
                toast.success("Member suspended");
            } else {
                toast.success("Member access updated");
            }
        },
        onError: (error) => {
            if (error instanceof ApiError && error.status === 403 && error.data?.code === 'SELF_SUSPEND_FORBIDDEN') {
                toast.error("You cannot suspend your own account.");
            } else {
                toast.error("Failed to suspend member.");
            }
        },
    });

    const reactivateMutation = useMutation({
        mutationFn: (memberId: string) =>
            api.patch(`/api/v1/members/${memberId}/status`, { status: "active" }),
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ["members", tenantId] });
            if (data?.action === 'invite_resent') {
                toast.success("Invitation resent successfully");
            } else if (data?.action === 'suspended') {
                toast.success("Member suspended");
            } else {
                toast.success("Member reactivated");
            }
        },
    });

    const updateRoleMutation = useMutation({
        mutationFn: ({ memberId, roleId }: { memberId: string; roleId: string }) =>
            api.patch(`/api/v1/members/${memberId}/role`, { roleId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["members", tenantId] });
            toast.success("Role updated");
            setSelectedMemberForRole(null);
        },
    });

    const canUpdateUsers = canUpdate(permissions, "members");

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

    if (!members) {
        return null;
    }

    const humanMembers = members.filter(m => m.memberType === "human");
    const agentMembers = members.filter(m => m.memberType === "agent");
    const displayedMembers = activeTab === "humans" ? humanMembers : agentMembers;

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
        <Tabs defaultValue="humans" value={activeTab} onValueChange={(v) => setActiveTab(v as "humans" | "agents")} className="space-y-4">
            <div className="flex items-center justify-between mb-6">
                <TabsList className="bg-transparent h-auto p-0 gap-2">
                    <TabsTrigger 
                        className="rounded-full px-4 py-1.5 text-sm font-medium border border-border bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground data-[state=active]:shadow-none"
                        value="humans"
                    >
                        Team Members ({humanMembers.length})
                    </TabsTrigger>
                    <TabsTrigger 
                        className="rounded-full px-4 py-1.5 text-sm font-medium border border-border bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground data-[state=active]:shadow-none"
                        value="agents"
                    >
                        Agents ({agentMembers.length})
                    </TabsTrigger>
                </TabsList>
                <div className="flex items-center">
                    {activeTab === "humans" && onInviteClick && (
                        <PermissionGate resource="members" action="create" fallback={null}>
                            <Button onClick={onInviteClick} size="sm">
                                <UserPlus className="w-4 h-4 mr-2" />
                                Invite Member
                            </Button>
                        </PermissionGate>
                    )}
                    {activeTab === "agents" && (
                        <Link href={`/${tenantId}/dashboard/agents`}>
                            <Button variant="outline" size="sm">Manage Agents</Button>
                        </Link>
                    )}
                </div>
            </div>
            
            <TabsContent value={activeTab} className="m-0 border-none p-0 outline-none">
                {displayedMembers.length === 0 ? (
                    <div className="text-center py-10 bg-muted/20 rounded-md border border-dashed border-border mt-4">
                        <p className="text-muted-foreground">No {activeTab === "humans" ? "team members" : "agents"} found.</p>
                    </div>
                ) : (
                    <div className="rounded-md border border-border bg-card">
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
                    {displayedMembers.map((member) => (
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
                                {member.memberType === "human" && member.status === "active" ? (
                                    <Dialog
                                        open={selectedMemberForRole?.id === member.id}
                                        onOpenChange={(open) => {
                                            if (open) {
                                                setSelectedMemberForRole(member);
                                                setSelectedRoleId(member.roleId || "");
                                            } else {
                                                setSelectedMemberForRole(null);
                                            }
                                        }}
                                    >
                                        <DialogTrigger asChild>
                                            <Badge
                                                variant="outline"
                                                className="text-xs cursor-pointer hover:bg-accent transition-colors"
                                            >
                                                {member.roleName || member.roleId || "No Role"}
                                            </Badge>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <DialogHeader>
                                                <DialogTitle>Change Role</DialogTitle>
                                                <DialogDescription>
                                                    Current role: <span className="font-medium text-foreground">{member.roleName || "No Role"}</span>
                                                </DialogDescription>
                                            </DialogHeader>
                                            <div className="py-4">
                                                <Select
                                                    value={selectedRoleId}
                                                    onValueChange={setSelectedRoleId}
                                                >
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue placeholder="Select role" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {roles?.map((role) => (
                                                            <SelectItem key={role.id} value={role.id}>
                                                                {role.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setSelectedMemberForRole(null)}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    onClick={() => updateRoleMutation.mutate({
                                                        memberId: member.id,
                                                        roleId: selectedRoleId
                                                    })}
                                                    disabled={updateRoleMutation.isPending || selectedRoleId === member.roleId}
                                                >
                                                    {updateRoleMutation.isPending && (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    )}
                                                    Save
                                                </Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                ) : (
                                    <Badge variant="outline" className="text-xs">
                                        {member.roleName || member.roleId || "No Role"}
                                    </Badge>
                                )}
                            </TableCell>
                            <TableCell>
                                {member.status === 'suspended' ? (
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            {member.joinedAt ? (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 text-[10px] uppercase font-bold tracking-wider rounded-full border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20 px-2 shadow-none"
                                                >
                                                    Suspended
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 text-[10px] uppercase font-bold tracking-wider rounded-full border border-orange-500/20 bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 px-2 shadow-none"
                                                >
                                                    Revoked
                                                </Button>
                                            )}
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                    {member.joinedAt ? "Reactivate Member" : "Resend Invitation"}
                                                </AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    {member.joinedAt 
                                                        ? `This will restore access for ${getDisplayName(member)}.` 
                                                        : "This will send a new invitation email to this member."}
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => reactivateMutation.mutate(member.id)}
                                                    disabled={reactivateMutation.isPending}
                                                >
                                                    {reactivateMutation.isPending && (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    )}
                                                    {member.joinedAt ? "Reactivate" : "Resend Invite"}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                ) : (
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] uppercase font-bold tracking-wider ${statusColors[member.status] || ""}`}
                                    >
                                        {member.status}
                                    </Badge>
                                )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                                {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "—"}
                            </TableCell>
                            {canUpdateUsers && (
                                <TableCell className="text-right">
                                    {member.userId !== userId && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-xs border-2"
                                                    disabled={suspendMutation.isPending || reactivateMutation.isPending}
                                                >
                                                    {member.status === 'invited' ? 'Revoke invite' :
                                                        member.status === 'suspended' ? (member.joinedAt ? 'Reactivate' : 'Resend Invite') : 'Suspend'}
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>
                                                        {member.status === 'invited' ? 'Revoke Invitation' :
                                                            member.status === 'suspended' ? (member.joinedAt ? 'Reactivate Member' : 'Resend Invitation') : 'Suspend Member'}
                                                    </AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        {member.status === 'invited' ? 'This will revoke their invitation. They will no longer be able to join.' :
                                                            member.status === 'suspended' ? (member.joinedAt ? 'This will restore their access.' : 'This will send a new invitation email to this member.') :
                                                                'This will suspend their access immediately. They will not be able to log in until reactivated.'}
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => {
                                                            if (member.status === 'suspended') {
                                                                reactivateMutation.mutate(member.id);
                                                            } else {
                                                                suspendMutation.mutate(member.id);
                                                            }
                                                        }}
                                                        className={member.status === 'suspended' ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
                                                    >
                                                        {member.status === 'invited' ? 'Revoke' :
                                                            member.status === 'suspended' ? (member.joinedAt ? 'Reactivate' : 'Resend Invite') : 'Suspend'}
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
                    </div>
                )}
            </TabsContent>
        </Tabs>
    );
}
