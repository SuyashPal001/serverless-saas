"use client";

import { useTenant } from "@/app/[tenant]/tenant-provider";
import { hasPermission } from "@/lib/permissions";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import React from "react";

interface PermissionGateProps {
    resource: string;
    action?: string;
    children: React.ReactNode;
    /**
     * What to render if the user does not have permission.
     * Pass `null` to render nothing (e.g., for hiding a button).
     * If omitted, a default "Access Denied" alert is shown.
     */
    fallback?: React.ReactNode;
}

export function PermissionGate({
    resource,
    action = "read",
    children,
    fallback,
}: PermissionGateProps) {
    const { permissions = [] } = useTenant();
    const allowed = hasPermission(permissions, resource, action);

    if (!allowed) {
        if (fallback !== undefined) {
            return <>{fallback}</>;
        }
        
        return (
            <div className="p-6">
                <Alert variant="destructive">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Access Denied</AlertTitle>
                    <AlertDescription>
                        You do not have permission to access this resource.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return <>{children}</>;
}
