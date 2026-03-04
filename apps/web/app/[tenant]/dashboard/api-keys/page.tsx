import { ApiKeysList } from "@/components/platform/api-keys/ApiKeysList";
import { CreateApiKeyDialog } from "@/components/platform/api-keys/CreateApiKeyDialog";

export default async function ApiKeysPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
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
                <CreateApiKeyDialog />
            </div>

            <div className="space-y-4">
                <ApiKeysList />
            </div>
        </div>
    );
}
