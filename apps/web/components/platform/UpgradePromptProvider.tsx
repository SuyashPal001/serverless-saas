'use client';

import { useState, useEffect } from 'react';
import { UpgradePrompt } from './UpgradePrompt';

export function UpgradePromptProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [feature, setFeature] = useState<string | undefined>();
    const [requiredPlan, setRequiredPlan] = useState<string | undefined>();

    useEffect(() => {
        const handler = (e: Event) => {
            const customEvent = e as CustomEvent;
            setFeature(customEvent.detail?.feature);
            setRequiredPlan(customEvent.detail?.requiredPlan);
            setOpen(true);
        };

        window.addEventListener('plan-gate', handler);
        return () => window.removeEventListener('plan-gate', handler);
    }, []);

    return (
        <>
            {children}
            <UpgradePrompt open={open} onClose={() => setOpen(false)} feature={feature} requiredPlan={requiredPlan} />
        </>
    );
}
