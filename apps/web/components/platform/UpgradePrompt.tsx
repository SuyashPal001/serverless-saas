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

export function UpgradePrompt({ open, onClose, feature }: UpgradePromptProps) {
    const router = useRouter();
    const { slug } = useTenant();

    const featureName = feature ? featureNames[feature] || 'this feature' : 'this feature';

    const handleViewPlans = () => {
        onClose();
        router.push(`/${slug}/dashboard/billing`);
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Upgrade your plan</DialogTitle>
                    <DialogDescription>
                        {featureName} is not available on the Free plan. Upgrade to unlock premium features.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Maybe later
                    </Button>
                    <Button onClick={handleViewPlans}>
                        View plans
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
