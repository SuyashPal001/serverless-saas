import { AgentsView } from "@/components/platform/agents/AgentsView";
import { PermissionGate } from "@/components/platform/PermissionGate";

export const metadata = {
    title: "Agents",
};

export default function AgentsPage() {
    return (
        <PermissionGate resource="agents" action="read">
            <AgentsView />
        </PermissionGate>
    );
}
