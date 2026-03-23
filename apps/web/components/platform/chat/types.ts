import { Agent } from "../agents/types";

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
    id: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    createdAt: string;
}

export interface Conversation {
    id: string;
    tenantId: string;
    agentId: string;
    title: string;
    status: 'active' | 'archived';
    createdAt: string;
    agent?: Agent;
}

export interface ConversationsResponse {
    data: Conversation[];
}

export interface MessagesResponse {
    data: Message[];
}

export interface CreateConversationRequest {
    agentId: string;
    title?: string;
}

export interface SendMessageRequest {
    content: string;
}
