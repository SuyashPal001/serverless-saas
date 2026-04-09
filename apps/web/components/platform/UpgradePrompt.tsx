'use client';

import { useRouter } from 'next/navigation';
import { useTenant } from '@/app/[tenant]/tenant-provider';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface UpgradePromptProps {
    open: boolean;
    onClose: () => void;
    feature?: string;
    requiredPlan?: string;
}

const featureNames: Record<string, string> = {
    sso: 'Single Sign-On',
    custom_roles: 'Custom Roles',
    agent_workflows: 'Agent Workflows',
    mcp_integrations: 'MCP Integrations',
    api_calls: 'API Call Limits',
    llm_tokens: 'LLM Token Limits',
    seats: 'Team Seats',
    agents: 'AI Agents',
};

export function UpgradePrompt({ open, onClose, feature, requiredPlan }: UpgradePromptProps) {
    const router = useRouter();
    const { tenantSlug } = useTenant();

    const featureName = feature ? featureNames[feature] || 'This feature' : 'This feature';
    const planName = requiredPlan || 'a higher plan';

    const handleUpgrade = () => {
        onClose();
        router.push(`/${tenantSlug}/dashboard/billing`);
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Upgrade your plan</DialogTitle>
                    <DialogDescription>
                        {featureName} requires the <strong>{planName}</strong> plan or above.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Maybe later
                    </Button>
                    <Button onClick={handleUpgrade}>
                        Upgrade Plan
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
