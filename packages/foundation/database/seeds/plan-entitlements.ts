import { eq, and } from 'drizzle-orm';
import { features, planEntitlements } from '../schema/index';
import type { db as DB } from './index';

type Plan = 'free' | 'starter' | 'business' | 'enterprise';

interface Entitlement {
    enabled?: boolean;
    valueLimit?: number;
    unlimited?: boolean;
}

const PLAN_ENTITLEMENTS: Record<Plan, Record<string, Entitlement>> = {
    free: {
        sso: { enabled: false },
        agent_workflows: { enabled: false },
        custom_roles: { enabled: false },
        mcp_integrations: { enabled: false },
        audit_log: { enabled: false },
        seats: { valueLimit: 3 },
        workspaces: { valueLimit: 1 },
        agents: { valueLimit: 1 },
        integrations: { valueLimit: 2 },
        api_calls: { valueLimit: 1_000 },
        llm_tokens: { valueLimit: 10_000 },
        storage_gb: { valueLimit: 1 },
        evals: { enabled: false },
        branding: { enabled: false },
        api_keys: { valueLimit: 2 },
    },
    starter: {
        sso: { enabled: false },
        agent_workflows: { enabled: true },
        custom_roles: { enabled: false },
        mcp_integrations: { enabled: true },
        audit_log: { enabled: true },
        seats: { valueLimit: 10 },
        workspaces: { valueLimit: 3 },
        agents: { valueLimit: 3 },
        integrations: { valueLimit: 5 },
        api_calls: { valueLimit: 10_000 },
        llm_tokens: { valueLimit: 100_000 },
        storage_gb: { valueLimit: 10 },
        evals: { enabled: true },
        branding: { enabled: true },
        api_keys: { valueLimit: 5 },
    },
    business: {
        sso: { enabled: true },
        agent_workflows: { enabled: true },
        custom_roles: { enabled: true },
        mcp_integrations: { enabled: true },
        audit_log: { enabled: true },
        seats: { valueLimit: 50 },
        workspaces: { valueLimit: 10 },
        agents: { valueLimit: 10 },
        integrations: { valueLimit: 20 },
        api_calls: { valueLimit: 100_000 },
        llm_tokens: { valueLimit: 1_000_000 },
        storage_gb: { valueLimit: 100 },
        evals: { enabled: true },
        branding: { enabled: true },
        api_keys: { valueLimit: 20 },
    },
    enterprise: {
        sso: { enabled: true },
        agent_workflows: { enabled: true },
        custom_roles: { enabled: true },
        mcp_integrations: { enabled: true },
        audit_log: { enabled: true },
        seats: { unlimited: true },
        workspaces: { unlimited: true },
        agents: { unlimited: true },
        integrations: { unlimited: true },
        api_calls: { unlimited: true },
        llm_tokens: { unlimited: true },
        storage_gb: { valueLimit: 1_000 },
        evals: { enabled: true },
        branding: { enabled: true },
        api_keys: { unlimited: true },
    },
};

export async function seedPlanEntitlements(db: typeof DB) {
    console.log('seeding plan-entitlements');

    for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS) as [Plan, Record<string, Entitlement>][]) {
        let created = 0;
        let skipped = 0;

        for (const [featureKey, values] of Object.entries(entitlements)) {
            const [feature] = await db
                .select({ id: features.id })
                .from(features)
                .where(eq(features.key, featureKey))
                .limit(1);

            if (!feature) {
                console.log(`  feature not found: ${featureKey}`);
                continue;
            }

            const existing = await db
                .select({ id: planEntitlements.id })
                .from(planEntitlements)
                .where(and(eq(planEntitlements.plan, plan), eq(planEntitlements.featureId, feature.id)))
                .limit(1);

            if (existing.length > 0) {
                skipped++;
                continue;
            }

            await db.insert(planEntitlements).values({
                plan,
                featureId: feature.id,
                enabled: values.enabled ?? false,
                valueLimit: values.valueLimit ?? null,
                unlimited: values.unlimited ?? false,
            });
            created++;
        }

        console.log(`  ${plan}: inserted ${created}, skipped ${skipped}`);
    }
}