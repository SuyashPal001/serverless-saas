import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { handleGetInbox, handleMarkRead, handleMarkAllRead, handleArchive } from './notifications.inbox';
import { handleGetPreferences, handleUpsertPreference } from './notifications.prefs';
import { handleListWorkflows, handleGetWorkflow, handleTestFire } from './notifications.workflows';

export const notificationsRoutes = new Hono<AppEnv>();

// Inbox (read-all before :id to avoid shadowing)
notificationsRoutes.get('/inbox', handleGetInbox);
notificationsRoutes.post('/inbox/read-all', handleMarkAllRead);
notificationsRoutes.patch('/inbox/:id/read', handleMarkRead);
notificationsRoutes.patch('/inbox/:id/archive', handleArchive);

// Preferences
notificationsRoutes.get('/preferences', handleGetPreferences);
notificationsRoutes.put('/preferences', handleUpsertPreference);

// Workflows
notificationsRoutes.get('/workflows', handleListWorkflows);
notificationsRoutes.get('/workflows/:id', handleGetWorkflow);

// Test
notificationsRoutes.post('/test-fire', handleTestFire);
