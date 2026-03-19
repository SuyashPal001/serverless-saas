import { ApiKeysList } from "@/components/platform/api-keys/ApiKeysList";
import { CreateApiKeyDialog } from "@/components/platform/api-keys/CreateApiKeyDialog";
import { PermissionGate } from "@/components/platform/PermissionGate";

export default async function ApiKeysPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <PermissionGate resource="api_keys" action="read">
            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            API Keys
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Manage your API keys to authenticate your applications and agents.
                        </p>
                    </div>
                    <PermissionGate resource="api_keys" action="create" fallback={null}>
                        <CreateApiKeyDialog />
                    </PermissionGate>
                </div>

                <div className="space-y-4">
                    <ApiKeysList />
                </div>
            </div>
        </PermissionGate>
    );
}
