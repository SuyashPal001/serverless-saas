"use client";

import { createContext, useContext } from "react";
import type { TenantClaims } from "@/lib/tenant";
import { useAuthRefresh } from "@/hooks/useAuthRefresh";

export const TenantContext = createContext<TenantClaims | null>(null);

export function useTenant() {
    const context = useContext(TenantContext);
    if (!context) {
        throw new Error("useTenant must be used within a TenantProvider");
    }
    return context;
}

export function TenantProvider({
    children,
    claims,
}: {
    children: React.ReactNode;
    claims: TenantClaims;
}) {
    // Background token refresh
    useAuthRefresh();

    return (
        <TenantContext.Provider value={claims}>
            {children}
        </TenantContext.Provider>
    );
}
