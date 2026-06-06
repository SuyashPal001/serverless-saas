import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { handleEnsureReady, handleAgentStatus } from './agents.health';
import { handleListAgents, handleGetAgent, handleCreateAgent, handleUpdateAgent, handleDeleteAgent } from './agents.crud';
import { handleListAgentTemplates, handleCreateAgentFromTemplate } from './agents.templates';
import { agentFairnessRoutes } from './agents.fairness';

export const agentsRoutes = new Hono<AppEnv>();

// Health / readiness (before parameterized routes)
agentsRoutes.get('/ensure-ready', handleEnsureReady);
agentsRoutes.get('/:id/status', handleAgentStatus);

// Templates / catalog
agentsRoutes.get('/templates', handleListAgentTemplates);
agentsRoutes.post('/from-template', handleCreateAgentFromTemplate);

// CRUD
agentsRoutes.get('/', handleListAgents);
agentsRoutes.get('/:id', handleGetAgent);
agentsRoutes.post('/', handleCreateAgent);
agentsRoutes.patch('/:id', handleUpdateAgent);
agentsRoutes.delete('/:id', handleDeleteAgent);

// Fairness
agentsRoutes.route('/', agentFairnessRoutes);
