"use client";

import * as React from "react";

interface NotificationsContextValue {
    unreadCount: number;
    markAllRead: () => void;
    setUnreadCount: React.Dispatch<React.SetStateAction<number>>;
}

export const NotificationsContext = React.createContext<NotificationsContextValue | null>(null);

export function useNotifications() {
    const context = React.useContext(NotificationsContext);
    if (!context) {
        throw new Error("useNotifications must be used within a NotificationsProvider");
    }
    return context;
}
