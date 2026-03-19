import { AuditLogView } from "@/components/platform/audit/AuditLogView";
import { PermissionGate } from "@/components/platform/PermissionGate";

export default async function AuditLogPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <PermissionGate resource="audit_log" action="read">
            <div className="space-y-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Audit Log
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Track activity and changes across your workspace.
                    </p>
                </div>

                <AuditLogView />
            </div>
        </PermissionGate>
    );
}
