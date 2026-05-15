import { useTenant } from "@/app/[tenant]/tenant-provider";
import { hasPermission } from "@/lib/permissions";

export function usePermissions() {
    const { permissions = [] } = useTenant();
    
    const can = (resource: string, action: string = "read") => {
        return hasPermission(permissions, resource, action);
    };

    return { can, permissions };
}
