export interface Notification {
    id: string;
    title: string;
    body: string;
    messageType: string;
    read: boolean;
    readAt: string | null;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface NotificationsInboxResponse {
    items: Notification[];
    total: number;
    page: number;
    limit: number;
    unreadCount: number;
}
