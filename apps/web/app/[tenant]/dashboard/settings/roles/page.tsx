import { RolesList } from "@/components/platform/roles/RolesList";
import { CreateRoleDialog } from "@/components/platform/roles/CreateRoleDialog";
import { PermissionGate } from "@/components/platform/PermissionGate";

export default async function RolesPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <PermissionGate resource="roles" action="read">
            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            Roles
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Configure access levels and permissions for your team.
                        </p>
                    </div>
                    <CreateRoleDialog />
                </div>

                <div className="space-y-4">
                    <RolesList />
                </div>
            </div>
        </PermissionGate>
    );
}
