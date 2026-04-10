import {
    LayoutDashboard,
    Users,
    Shield,
    CreditCard,
    Key,
    Bot,
    MessageSquare,
    Bell,
    FileText,
    Building2,
    Sliders,
    Webhook,
    FolderOpen,
    Plug,
    Palette,
    BarChart2
} from "lucide-react";
import React from 'react';

export interface SidebarItem {
    label: string;
    href: string;
    icon: React.ElementType;
    roles?: string[];
    planRequired?: 'starter' | 'business' | 'enterprise';
    planGateFeature?: string;
    locked?: boolean;
    showBusinessBadge?: boolean;
    sectionLabel?: string;
    isDivider?: boolean;
}

export function getSidebarItems(
    role: string,
    plan: string,
    tenantSlug: string,
    entitlements: Record<string, { enabled?: boolean; valueLimit?: number; unlimited?: boolean }> = {}
): SidebarItem[] {
    const base = `/${tenantSlug}/dashboard`;
    const isPlatformAdmin = role === 'platform_admin';
    const isAdminOrOwner = role === 'admin' || role === 'owner' || isPlatformAdmin;

    const evalsLocked        = entitlements['evals']?.enabled === false;
    const brandingLocked     = entitlements['branding']?.enabled === false;
    const integrationsLocked = entitlements['mcp_integrations']?.enabled === false;

    const items: SidebarItem[] = [];

    // 1. MAIN SECTION
    items.push({ 
        label: "Chat", 
        href: `${base}/chat`, 
        icon: MessageSquare 
    });

    if (isAdminOrOwner) {
        items.push({ 
            label: "Agents", 
            href: `${base}/agents`, 
            icon: Bot 
        });
        items.push({ 
            label: "Files", 
            href: `${base}/files`, 
            icon: FolderOpen 
        });
        
        items.push({ isDivider: true, href: '', icon: () => null, label: '' });

        items.push({
            label: "Notifications",
            href: `${base}/notifications`,
            icon: Bell
        });
        items.push({
            label: "Audit log",
            href: `${base}/audit`,
            icon: FileText
        });
        items.push({
            label: "Evals",
            href: `${base}/evals`,
            icon: BarChart2,
            planRequired: 'business',
            planGateFeature: 'evals',
            locked: evalsLocked,
        });

        // 2. SETTINGS SECTION
        items.push({ 
            label: "Members", 
            href: `${base}/settings/members`, 
            icon: Users,
            sectionLabel: "Settings"
        });
        items.push({ 
            label: "Roles", 
            href: `${base}/settings/roles`, 
            icon: Shield 
        });
        items.push({ 
            label: "Billing", 
            href: `${base}/billing`, 
            icon: CreditCard 
        });
        
        // Branding - Starter+ feature
        items.push({
            label: "Branding",
            href: `${base}/branding`,
            icon: Palette,
            planRequired: 'starter',
            planGateFeature: 'branding',
            locked: brandingLocked,
        });

        // 3. DEVELOPER SECTION
        items.push({ 
            label: "API keys", 
            href: `${base}/api-keys`, 
            icon: Key,
            sectionLabel: "Developer settings"
        });
        items.push({ 
            label: "Webhooks", 
            href: `${base}/webhooks`, 
            icon: Webhook 
        });
        
        // Integrations - Starter+ feature
        items.push({
            label: "Integrations",
            href: `${base}/integrations`,
            icon: Plug,
            planRequired: 'starter',
            planGateFeature: 'mcp_integrations',
            locked: integrationsLocked,
        });
    } else {
        // Member only sees Chat & Notifications
        items.push({ 
            label: "Notifications", 
            href: `${base}/notifications`, 
            icon: Bell 
        });
    }

    // 4. OPS PORTAL (Platform Admin Only)
    if (isPlatformAdmin) {
        items.push({ 
            label: "All tenants", 
            href: `${base}/ops/tenants`, 
            icon: Building2,
            sectionLabel: "Ops portal"
        });
        items.push({ 
            label: "Feature overrides", 
            href: `${base}/ops/overrides`, 
            icon: Sliders 
        });
    }

    return items;
}
