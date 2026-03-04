"use client"

import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { NotificationsInboxResponse } from "@/components/platform/notifications/types"

// The shape of a notification pushed over WebSocket
export interface WsNotification {
    id: string
    title: string
    body: string
    messageType: string
    createdAt: string
}

// Hook signature — will be wired into the notifications page in a later task
export function useNotificationsSocket() {
    const queryClient = useQueryClient()
    const { tenant: tenantSlug } = useParams<{ tenant: string }>()
    const wsRef = useRef<WebSocket | null>(null)
    const retryCountRef = useRef(0)
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        const url = process.env.NEXT_PUBLIC_WS_URL
        if (!url) {
            console.warn("NEXT_PUBLIC_WS_URL is not set — WebSocket disabled")
            return
        }

        const connect = () => {
            const ws = new WebSocket(url)
            wsRef.current = ws

            ws.onopen = () => {
                retryCountRef.current = 0
            }

            ws.onmessage = (event) => {
                try {
                    const incoming = JSON.parse(event.data) as WsNotification
                    queryClient.setQueryData(
                        ["notifications-inbox", tenantSlug, 1],
                        (old: NotificationsInboxResponse | undefined) => {
                            if (!old) return old
                            return {
                                ...old,
                                notifications: [
                                    { ...incoming, read: false, readAt: null },
                                    ...old.notifications,
                                ],
                                unreadCount: old.unreadCount + 1,
                            }
                        }
                    )
                } catch {
                    console.warn("Failed to parse WebSocket message", event.data)
                }
            }

            ws.onclose = () => {
                if (retryCountRef.current >= 5) {
                    console.warn("WebSocket max retries reached")
                    return
                }

                const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000)
                retryCountRef.current += 1
                retryTimeoutRef.current = setTimeout(() => {
                    connect()
                }, delay)
            }
        }

        connect()

        return () => {
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current)
            }
            if (wsRef.current) {
                wsRef.current.close()
                wsRef.current = null
            }
        }
    }, [queryClient, tenantSlug])
}
