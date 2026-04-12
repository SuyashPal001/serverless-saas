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

const featureDescriptions: Record<string, string> = {
    sso: "Let your team sign in with your company identity provider — no extra passwords.",
    custom_roles: "Define precise permissions for every member, beyond the default owner, admin, and member roles.",
    agent_workflows: "Automate multi-step tasks across your tools with AI-powered agent workflows.",
    mcp_integrations: "Connect your agents to external data sources and services via the Model Context Protocol.",
    api_calls: "Handle more API traffic as your product usage grows.",
    llm_tokens: "More capacity for your agents to think, write, and reason each month.",
    seats: "Bring more teammates into your workspace and collaborate at scale.",
    agents: "Create more AI agents to handle parallel workstreams.",
    audit_log: "See everything your team and agents did — full history, every action.",
    webhooks: "Push real-time events to your systems the moment something changes.",
    api_keys_access: "Integrate your systems programmatically with secure, scoped API keys.",
    branding: "Make the platform yours — custom logo and workspace branding.",
    messages: "Send more messages to your agents each month as your usage grows.",
};

export function UpgradePrompt({ open, onClose, feature, requiredPlan }: UpgradePromptProps) {
    const router = useRouter();
    const { tenantSlug } = useTenant();

    const description = feature ? featureDescriptions[feature] || 'This feature is not available on your current plan.' : 'This feature is not available on your current plan.';
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
                        {description} Available on <strong>{planName}</strong>.
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
