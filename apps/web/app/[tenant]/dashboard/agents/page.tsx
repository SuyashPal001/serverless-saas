import { AgentsView } from "@/components/platform/agents/AgentsView";

export default async function AgentsPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <div className="space-y-8">
            <AgentsView />
        </div>
    );
}
