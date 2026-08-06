import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { MastraServer } from '@mastra/hono'
import { mastra } from './mastra/index.js'
import { downloadMediaAttachment } from './media.js'
import { fireToolCallLog } from './events.js'
import { tasksRouter } from './routes/tasks.js'
import { pmRouter } from './routes/pm.js'
import { documentsRouter } from './routes/documents.js'
import { chatRouter } from './routes/chat.js'
import { sessionsRouter } from './routes/sessions.js'
import { internalRouter, initStudio } from './routes/internal.js'
import { schedulesRouter } from './routes/schedules.js'
import { explanationRouter } from './routes/explanation.js'
import { ingestRoute } from './routes/ingest.js'
import { pensionRoutes } from './routes/pension.js'
import { tenderRoutes } from './routes/tender.js'
import { tenderAuthoringRoutes } from './routes/tenderAuthoring.js'
import { tenderPrebidRoutes } from './routes/tenderPrebid.js'
import { tenderExtractRoutes } from './routes/tenderExtract.js'
import { tenderDocumentCheckRoutes } from './routes/tenderDocumentCheck.js'
import { tenderProposalRoutes } from './routes/tenderProposal.js'
import { tenderContractRoutes } from './routes/tenderContract.js'
import { tenderApprovalRoutes } from './routes/tenderApproval.js'
import {
  API_BASE_URL, sessions,
} from './types.js'
import type { RelaySessionCtx, DownloadedMedia } from './types.js'

const app = new Hono()

app.use('/studio/*', cors({
  origin: 'https://agent-studio.fitnearn.com',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-mastra-client-type'],
  credentials: true,
}))

app.route('', internalRouter)
app.route('', tasksRouter)
app.route('', pmRouter)
app.route('', documentsRouter)
app.route('', chatRouter)
app.route('', sessionsRouter)
app.route('', schedulesRouter)
app.route('', explanationRouter)
app.route('', ingestRoute)
app.route('', pensionRoutes)
app.route('', tenderRoutes)
app.route('', tenderAuthoringRoutes)
app.route('', tenderPrebidRoutes)
app.route('', tenderExtractRoutes)
app.route('', tenderDocumentCheckRoutes)
app.route('', tenderProposalRoutes)
app.route('', tenderContractRoutes)
app.route('', tenderApprovalRoutes)

await initStudio(app)

export {
  app,
  API_BASE_URL,
  downloadMediaAttachment,
  fireToolCallLog,
  sessions,
}
export type { RelaySessionCtx, DownloadedMedia }
