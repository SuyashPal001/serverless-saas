export interface Notification {
    id: string;
    title: string;
    body: string;
    messageType: string;
    read: boolean;
    readAt: string | null;
    createdAt: string;
}

export interface NotificationsInboxResponse {
    notifications: Notification[];
    total: number;
    page: number;
    totalPages: number;
    unreadCount: number;
}
