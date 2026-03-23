import { WidgetChat } from "@/components/widget/WidgetChat";
import { redirect } from "next/navigation";

export default async function WidgetPage({
    params,
    searchParams,
}: {
    params: Promise<{ tenantId: string; agentId: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const { tenantId, agentId } = await params;
    const sParams = await searchParams;
    const userId = sParams.userId as string | undefined;

    if (!tenantId || !agentId) {
        return (
            <div className="flex h-screen items-center justify-center p-4 text-center">
                <p className="text-sm text-destructive font-medium">
                    Invalid widget configuration: Missing tenantId or agentId.
                </p>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen overflow-hidden">
            <WidgetChat 
                tenantId={tenantId} 
                agentId={agentId} 
                externalUserId={userId} 
            />
        </div>
    );
}
