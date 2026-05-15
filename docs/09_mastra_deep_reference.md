# Mastra Deep Reference Guide
## Complete API & Architecture Reference for Saarthi Platform

---

## What Mastra Is

Mastra is a TypeScript framework (Apache 2.0, open source) for building production AI agents, workflows, and tools. It provides all the primitives needed for agentic applications: agents, workflows, tools, memory, MCP, RAG, evals, observability, and browser automation.

**Version in use:** `@mastra/core@1.32.1`

**Key packages:**
```
@mastra/core          — agents, workflows, tools, memory, MCP
@apps/relay/src/mastra/memory.ts        — conversation history, working memory
@mastra/mcp           — MCPClient, MCPServer
@mastra/hono          — MastraServer (HTTP + Studio)
@mastra/editor        — Studio editor, versioning
@mastra/observability — OTel traces, metrics, logs
@mastra/agent-browser — Playwright browser automation
@mastra/stagehand     — Browserbase AI browser
@mastra/evals         — scorers, datasets, experiments
```

---

## 1. Mastra Instance

The central entry point. Register all agents, workflows, tools, storage, and observability here.

```typescript
import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { MastraEditor } from '@mastra/editor'

export const mastra = new Mastra({
  agents: { myAgent },
  workflows: { myWorkflow },
  storage: new LibSQLStore({ url: ':memory:' }),
  editor: new MastraEditor(),
  server: {
    port: 4111,
    host: 'localhost',
  },
})
```

**Start Studio:**
```bash
npm run dev  # opens at http://localhost:4111
```

---

## 2. Agents

### Definition

```typescript
import { Agent } from '@mastra/core/agent'

const agent = new Agent({
  id: 'my-agent',
  name: 'My Agent',
  instructions: 'You are a helpful assistant.',
  model: 'openai/gpt-5.4',       // provider/model-name
  tools: { weatherTool },
  memory: new Memory({ options: { lastMessages: 20 } }),
})
```

### Calling Agents

```typescript
// Full response
const agent = mastra.getAgentById('my-agent')
const response = await agent.generate('Help me organize my day')
console.log(response.text)         // final text
console.log(response.toolCalls)    // tools called
console.log(response.usage)        // token usage

// Streaming
const stream = await agent.stream('Help me organize my day')
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk)
}
const usage = await stream.usage
```

### Runtime Options

```typescript
await agent.generate('Check the forecast', {
  toolChoice: 'required',          // force tool use
  activeTools: ['weatherTool'],    // scope which tools agent can use
  memory: {
    resource: 'user-123',          // stable user identifier
    thread: 'conversation-456',    // conversation session
  },
  modelSettings: {
    maxOutputTokens: 1000,
    temperature: 0.7,
  },
})
```

### When to Use Agents vs Workflows

| Use Agent | Use Workflow |
|---|---|
| Task is open-ended | Steps known upfront |
| Steps not known in advance | Multi-step with explicit order |
| Agent decides what to do | You control execution flow |
| Conversational | Batch/pipeline processing |

---

## 3. Tools

### Creating Tools

```typescript
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const weatherTool = createTool({
  id: 'weather-tool',
  description: 'Fetches weather for a location',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ weather: z.string() }),
  execute: async (inputData) => {
    const response = await fetch(`https://wttr.in/${inputData.location}?format=3`)
    return { weather: await response.text() }
  },
})
```

**Schema libraries supported:** Zod, Valibot, ArkType (anything supporting Standard JSON Schema)

### Agent as Tool (Supervisor Pattern)

```typescript
const writer = new Agent({
  id: 'writer',
  description: 'Drafts and edits written content', // required for supervisor
  instructions: 'You are a skilled writer.',
  model: 'openai/gpt-5.4',
})

export const supervisor = new Agent({
  id: 'supervisor',
  instructions: 'Coordinate the writer to produce content.',
  model: 'openai/gpt-5.4',
  agents: { writer },  // becomes tool named 'agent-writer'
})
```

### Workflow as Tool

```typescript
const researchAgent = new Agent({
  workflows: { researchWorkflow },  // becomes tool named 'workflow-research'
})
```

### Tool Name in Stream Responses

```typescript
tools: { weatherTool }              // toolName: "weatherTool"
tools: { [weatherTool.id]: weatherTool }  // toolName: "weather-tool"
tools: { 'my-custom': weatherTool } // toolName: "my-custom"
```

---

## 4. Workflows

Workflows define complex sequences of tasks using structured steps. They give full control over execution order, data flow, and branching.

### Core Pattern

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'

// Define a step
const step1 = createStep({
  id: 'step-1',
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ formatted: z.string() }),
  execute: async ({ inputData }) => {
    return { formatted: inputData.message.toUpperCase() }
  },
})

// Define workflow
export const myWorkflow = createWorkflow({
  id: 'my-workflow',
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ formatted: z.string() }),
})
  .then(step1)
  .commit()

// Register in Mastra instance
export const mastra = new Mastra({
  workflows: { myWorkflow },
})
```

### Running Workflows

```typescript
const workflow = mastra.getWorkflow('myWorkflow')

// Blocking — wait for all steps
const run = await workflow.createRun()
const result = await run.start({ inputData: { message: 'Hello world' } })

if (result.status === 'success') {
  console.log(result.result)    // workflow output
} else if (result.status === 'failed') {
  console.log(result.error)
} else if (result.status === 'suspended') {
  console.log(result.suspendPayload)
}

// Streaming — events during execution
const stream = run.stream({ inputData: { message: 'Hello world' } })
for await (const chunk of stream.fullStream) {
  console.log(chunk)  // step events
}
const result = await stream.result
```

### Control Flow

```typescript
// Sequential
.then(step1).then(step2).then(step3)

// Parallel fan-out
.parallel([step1, step2, step3])

// Foreach (iterate over array from previous step)
.foreach(searchStep, { concurrency: 3 })

// Branching
.branch([
  [async ({ inputData }) => inputData.score > 0.8, highScoreStep],
  [async ({ inputData }) => inputData.score <= 0.8, lowScoreStep],
])

// Do-until loop
.dountil(retryStep, async ({ inputData }) => inputData.success === true)

// Do-while loop
.dowhile(processStep, async ({ inputData }) => inputData.hasMore === true)
```

### Reading Data Inside Steps

```typescript
const step2 = createStep({
  id: 'step-2',
  inputSchema: z.object({}),  // empty — reads from context
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ inputData, getInitData, getStepResult }) => {
    // Get original workflow input
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()
    
    // Get output from a previous step
    const step1Result = getStepResult(step1)
    
    return { result: step1Result.formatted + initData.prefix }
  },
})
```

### Suspend / Resume (Human-in-the-Loop)

```typescript
const approvalStep = createStep({
  id: 'approval',
  inputSchema: z.object({ data: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, suspend }) => {
    // Suspend — serializes state to Postgres
    await suspend({
      message: 'Please review and approve',
      data: inputData.data,
    })
    
    // Resumes here after run.resume() is called
    return { approved: true }
  },
})

// Resume a suspended workflow
const run = await workflow.createRun({ runId: storedRunId })
await run.resume({
  step: 'approval',
  resumeData: { approved: true },
})
```

**What happens on suspend:**
- Full workflow state serialized to `mastra.mastra_workflow_snapshot` table in Postgres
- `runId` used to reconstruct and resume
- Status becomes `suspended`

### Workflow State (Shared Across Steps)

```typescript
const step1 = createStep({
  id: 'step-1',
  stateSchema: z.object({ counter: z.number() }),
  execute: async ({ inputData, state, setState }) => {
    setState({ ...state, counter: (state.counter ?? 0) + 1 })
    return { formatted: inputData.message }
  },
})
```

### Nested Workflows (Workflow as Step)

```typescript
const childWorkflow = createWorkflow({ id: 'child', ... })
  .then(step1).then(step2).commit()

const parentWorkflow = createWorkflow({ id: 'parent', ... })
  .then(childWorkflow)
  .commit()
```

### Clone a Workflow

```typescript
import { cloneWorkflow } from '@mastra/core/workflows'
const clonedWorkflow = cloneWorkflow(parentWorkflow, { id: 'cloned-workflow' })
```

---

## 5. Memory

Memory enables agents to remember across interactions.

### Setup

```typescript
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'

// Storage required
export const mastra = new Mastra({
  storage: new LibSQLStore({ url: ':memory:' }),
})

// Attach memory to agent
const agent = new Agent({
  memory: new Memory({
    options: {
      lastMessages: 20,          // message history
      workingMemory: { enabled: true },  // persistent user facts
      semanticRecall: false,     // vector similarity search
      observationalMemory: true, // compress old messages
    },
  }),
})
```

### Using Memory

```typescript
// Pass resource and thread to maintain context
const response = await agent.generate('Remember my favorite color is blue.', {
  memory: {
    resource: 'user-123',       // stable user identifier
    thread: 'conversation-123', // conversation session
  },
})

// Same resource + thread = recalls previous context
const response2 = await agent.generate("What's my favorite color?", {
  memory: {
    resource: 'user-123',
    thread: 'conversation-123',
  },
})
// Response: "Your favorite color is blue."
```

### Memory Types

| Type | Description | When to use |
|---|---|---|
| Message history | Last N messages | Always — maintains conversation flow |
| Working memory | Persistent structured facts (name, preferences) | User profile data |
| Semantic recall | Vector similarity search over past messages | Long histories, finding relevant context |
| Observational memory | Background compression of old messages | Long-running conversations |

### Dynamic Memory Per Request

```typescript
const agent = new Agent({
  memory: ({ requestContext }) => {
    const tier = requestContext.get('user-tier')
    return tier === 'enterprise' ? premiumMemory : standardMemory
  },
})
```

---

## 6. MCP (Model Context Protocol)

### MCPClient — Consume External MCP Tools

```typescript
import { MCPClient } from '@mastra/mcp'

const mcpClient = new MCPClient({
  id: 'my-mcp-client',
  servers: {
    // Local package
    wikipedia: {
      command: 'npx',
      args: ['-y', 'wikipedia-mcp'],
    },
    // Remote HTTP endpoint
    weather: {
      url: new URL('https://server.smithery.ai/@smithery-ai/national-weather-service/mcp'),
    },
  },
})

// Static tools — fixed at agent init
const agent = new Agent({
  tools: await mcpClient.listTools(),
})

// Dynamic tools — per-request (multi-tenant)
const toolsets = await mcpClient.listToolsets()
const response = await agent.generate(prompt, { toolsets })
```

### MCPServer — Expose Your Tools

```typescript
import { MCPServer } from '@mastra/mcp'

const mcpServer = new MCPServer({
  id: 'my-server',
  name: 'My Server',
  version: '1.0.0',
  agents: { myAgent },
  tools: { myTool },
  workflows: { myWorkflow },
})

// Register in Mastra instance
export const mastra = new Mastra({
  mcpServers: { myServer: mcpServer },
})
```

### Tool Approval for MCP

```typescript
const mcpClient = new MCPClient({
  servers: {
    github: {
      url: new URL('http://localhost:3000/mcp'),
      requireToolApproval: true,  // pause before execution
    },
  },
})
```

---

## 7. Request Context

Pass request-specific values to agents and steps.

```typescript
import { RequestContext, MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context'

// Set context
const requestContext = new RequestContext()
requestContext.set(MASTRA_RESOURCE_ID_KEY, tenantId)
requestContext.set('tenantId', tenantId)
requestContext.set('__mcpClient', mcpClient)

// Use in agent call
await agent.generate(prompt, { requestContext })

// Read in agent tools resolver
tools: async ({ requestContext }) => {
  const tenantId = requestContext?.get('tenantId')
  const mcpClient = requestContext?.get('__mcpClient')
  // ...
}
```

---

## 8. Observability

### Setup

```typescript
import { Observability, DefaultExporter, SensitiveDataFilter } from '@mastra/observability'
import { DuckDBStore } from '@mastra/duckdb'
import { MastraCompositeStore } from '@mastra/core/storage'

export const mastra = new Mastra({
  storage: new MastraCompositeStore({
    id: 'composite',
    default: new LibSQLStore({ url: 'file:./mastra.db' }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),  // persists to storage for Studio
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),  // redacts passwords, tokens, keys
        ],
      },
    },
  }),
})
```

### What Gets Traced

- Every agent run
- Every workflow step
- Every tool call
- Model calls (input, output, token usage, timing)

### Studio Observability

Studio Observability tab shows:
- **Metrics:** total runs, cost, token usage, latency p50/p95
- **Traces:** full request timeline, step-by-step execution
- **Logs:** structured logs correlated to traces

---

## 9. Scorers / Evals

Automated quality measurement for agent outputs.

### Setup

```typescript
import { createAnswerRelevancyScorer, createToxicityScorer } from '@mastra/evals/scorers/prebuilt'

const agent = new Agent({
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: 'openai/gpt-5-mini' }),
      sampling: { type: 'ratio', rate: 0.5 },  // score 50% of responses
    },
    safety: {
      scorer: createToxicityScorer({ model: 'openai/gpt-5-mini' }),
      sampling: { type: 'ratio', rate: 1 },     // score 100%
    },
  },
})
```

### Workflow Step Scorers

```typescript
const contentStep = createStep({
  scorers: {
    quality: {
      scorer: customScorer(),
      sampling: { type: 'ratio', rate: 1 },
    },
  },
})
```

### How Scoring Works

- Runs asynchronously — does NOT block agent responses
- Results stored in `mastra_scorers` table
- Visible in Studio under Scorers tab
- Register scorers at Mastra instance level for trace scoring:

```typescript
const mastra = new Mastra({
  scorers: {
    answerRelevancy: myScorer,
  },
})
```

---

## 10. Studio

Studio is the development + testing UI.

### Start

```bash
npm run dev   # http://localhost:4111
mastra dev    # same
```

### What Studio Provides

**Agents tab:**
- Chat directly with any registered agent
- See every tool call and its output
- View reasoning traces
- Switch models on the fly (temperature, top-p)
- Attach scorers for quality measurement
- Time travel debugging

**Workflows tab:**
- Visualize workflow as graph
- Run workflow with custom input via form or JSON
- See step-by-step execution live
- Time travel — replay individual steps
- View raw JSON outputs per step
- See tool calls within steps

**Scorers tab:**
- Browse all registered scorers
- See score results per interaction
- Save results as dataset items

**Datasets + Experiments:**
- Create test case collections
- Import from CSV/JSON
- Run experiments comparing agent versions
- Side-by-side comparison

**Observability tab:**
- Metrics dashboard
- Full trace viewer
- Log browser with full-text search

**Editor tab (per agent):**
- Edit agent instructions without redeploying
- Version every change
- Publish/draft/archive lifecycle
- A/B test agent versions

### Custom Headers for Tenant Context

In Studio Settings → Custom Headers:
```
x-tenant-id: fde7d67a-4526-4c2b-9dd5-825906f80093
```

This enables MCP tools to load per tenant when testing in Studio.

### Studio Deployment

```bash
mastra studio           # standalone at localhost:3000
mastra studio deploy    # deploy to Mastra platform cloud
mastra build --studio   # bundle alongside your Mastra server
```

---

## 11. Server

Mastra runs as an HTTP server exposing agents and workflows as API endpoints.

### Configuration

```typescript
export const mastra = new Mastra({
  server: {
    port: 3000,
    host: '0.0.0.0',
    auth: new SimpleAuth({ users: { 'api-key': { id: 'user-1', role: 'admin' } } }),
  },
})
```

### REST API

```
GET  /api/agents/:agentId                  — get agent info
POST /api/agents/:agentId/generate         — call agent
POST /api/agents/:agentId/stream           — stream agent

POST /api/workflows/:workflowId/createRun  — create run
POST /api/workflows/:workflowId/:runId/start — start run
POST /api/workflows/:workflowId/resume     — resume suspended run

GET  /api/openapi.json                     — OpenAPI spec
GET  /swagger-ui                           — interactive API docs
```

### RBAC

```typescript
import { StaticRBACProvider, DEFAULT_ROLES } from '@mastra/core/auth/ee'

const rbac = new StaticRBACProvider({
  roles: DEFAULT_ROLES,
  getUserRoles: user => [user.role],
})

// Permission format: {resource}:{action}
// agents:read, agents:execute, workflows:*, *
```

---

## 12. Browser Automation

### AgentBrowser (Local Playwright)

```typescript
import { AgentBrowser } from '@mastra/agent-browser'

const browser = new AgentBrowser({
  headless: true,   // true for server/production
})

const agent = new Agent({
  id: 'web-agent',
  model: 'openai/gpt-5.4',
  browser,
  instructions: 'Use browser tools to navigate websites.',
})
```

**Tools added automatically:**
- Navigate to URLs
- Select elements
- Fill forms
- Extract page content

### Stagehand (Browserbase Cloud)

```typescript
import { StagehandBrowser } from '@mastra/stagehand'

// Cloud (production)
const browser = new StagehandBrowser({
  env: 'BROWSERBASE',
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  model: 'openai/gpt-5.4',
})

// Local headless
const browser = new StagehandBrowser({
  headless: true,
  model: 'openai/gpt-5.4',
})
```

**Stagehand tools:**
- `stagehand_navigate` — go to URL
- `stagehand_act` — natural language actions ("click sign in button")
- `stagehand_extract` — structured data extraction
- `stagehand_observe` — find available actions on page

### When to Use Which

| Use case | Tool |
|---|---|
| Static page content extraction | Crawl4AI (self-hosted, free) |
| JS-heavy sites | AgentBrowser (local, free) |
| Anti-bot bypass needed | Stagehand + Browserbase ($20/mo) |
| Scheduled background crawling | AgentBrowser headless |
| On-demand user task | Crawl4AI (fast) or scheduled pre-crawl |

**Important:** Browser automation is slow (30-60s per task). Use scheduled/background crawls instead of on-demand for production.

---

## 13. RAG (Retrieval-Augmented Generation)

Mastra provides `@mastra/rag` for document processing and vector search.

### Basic Pattern

```typescript
import { MDocument } from '@mastra/rag'
import { embedMany } from 'ai'

// 1. Create document
const doc = MDocument.fromText('Your document text...')

// 2. Chunk
const chunks = await doc.chunk({
  strategy: 'recursive',
  size: 512,
  overlap: 50,
})

// 3. Embed
const { embeddings } = await embedMany({
  values: chunks.map(c => c.text),
  model: new ModelRouterEmbeddingModel('openai/text-embedding-3-small'),
})

// 4. Store
const pgVector = new PgVector({ connectionString: process.env.DATABASE_URL })
await pgVector.upsert({ indexName: 'embeddings', vectors: embeddings })

// 5. Query
const results = await pgVector.query({
  indexName: 'embeddings',
  queryVector: queryVector,
  topK: 3,
})
```

**Note:** Saarthi uses a custom RAG pipeline (not @mastra/rag) with pgvector, hybrid search, RRF fusion, and per-tenant isolation. The custom pipeline is more advanced than Mastra's built-in RAG.

---

## 14. Editor (Version Control for Agents)

Separates agent configuration from code. Non-technical users can iterate on prompts.

```typescript
import { MastraEditor } from '@mastra/editor'

export const mastra = new Mastra({
  editor: new MastraEditor(),
})

// Programmatic access
const editor = mastra.getEditor()
await editor.agent.create({
  id: 'support-agent',
  instructions: 'You are a friendly support agent.',
})

await editor.agent.update({
  id: 'support-agent',
  instructions: 'Updated instructions...',
})
```

### Version Lifecycle

```
Draft → Published → Archived
```

### Version Targeting

```typescript
// Load published version (default)
const agent = mastra.getAgentById('support-agent')

// Load latest draft
const agent = mastra.getAgentById('support-agent', { status: 'draft' })

// Load specific version
const agent = mastra.getAgentById('support-agent', { versionId: 'abc-123' })
```

---

## 15. Workspaces

Give agents a persistent environment for files and commands.

```typescript
import { Workspace, LocalFilesystem, LocalSandbox } from '@mastra/core/workspace'

const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: './workspace' }),
  sandbox: new LocalSandbox({ workingDirectory: './workspace' }),
})

const agent = new Agent({
  workspace,
  // agent gets file tools + execute_command automatically
})
```

**Workspace tools added automatically:**
- `read_file`, `write_file`, `list_directory`, `grep`, `delete`
- `execute_command` (sandbox)
- `lsp_inspect` (if LSP configured)

---

## 16. Streaming

### Agent Streaming

```typescript
const stream = await agent.stream('Help me')

// Text chunks
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk)
}

// Final values
const text = await stream.text
const usage = await stream.usage
const finishReason = await stream.finishReason
```

### Workflow Streaming

```typescript
const stream = run.stream({ inputData: { message: 'Hello' } })

for await (const chunk of stream.fullStream) {
  console.log(chunk)
  // { type: 'workflow-start', runId: '...', from: 'WORKFLOW', payload: { ... } }
  // { type: 'step-complete', ... }
}

const result = await stream.result
```

---

## 17. How We Use Mastra on Saarthi

### What We Use

| Feature | How |
|---|---|
| `Agent` | `platformAgent` singleton — Gemini 2.5 Flash via Vertex proxy |
| `Agent` | `formatterAgent` — no tools, structuredOutput only (Pass 2) |
| `Memory` | PostgresStore — lastMessages: 20, workingMemory enabled |
| `MCPClient` | Dynamic per-tenant tool loading from mcp-server at :3002 |
| `RequestContext` | tenantId + mcpClient injected per request |
| `MastraEditor` | Studio at localhost:3001/studio |
| `createWorkflow` | `taskExecutionWorkflow` |
| `createStep` | planStep, approvalStep, searchStep, mergeStep, composeStep |
| `suspend/resume` | Approval gate wired to task board |
| `Observability` | OTel DefaultExporter |

### What We Do NOT Use (Yet)

| Feature | Why |
|---|---|
| `@mastra/rag` | Custom pgvector RAG pipeline is more advanced |
| `@mastra/evals` | Custom evalAuto.ts — migrate later |
| Supervisor agents | Single platformAgent — expand later |
| `@mastra/agent-browser` | Planned for researchWorkflow (scheduled crawls) |
| `@mastra/stagehand` | Planned for anti-bot sites (premium feature) |

### Gemini Two-Pass Workaround

Gemini cannot use `responseSchema` (structuredOutput) AND `functionDeclarations` (tools) in the same request.

**Solution:** Two separate agent calls per step:

```
Pass 1: platformAgent.generate()
  → tools: ['internet_search']
  → NO structuredOutput
  → Gemini calls tools freely
  → returns free text

Pass 2: formatterAgent.generate()
  → tools: {} (empty)
  → structuredOutput: { schema: StepOutputSchema }
  → extracts structure from Pass 1 text
  → returns typed object
```

`formatterAgent` has no tools = no `functionDeclarations` = Gemini can use `responseSchema`.

### Key Files

```
apps/relay/src/mastra/
  index.ts              — Mastra instance, platformAgent, formatterAgent
  agent.ts              — Per-tenant agent proxy (RequestContext injection)
  memory.ts             — PostgresStore memory singleton
  tools.ts              — getMCPClientForTenant
  workflows/
    taskExecution.ts    — Main workflow (searchWorkflow)
    README.md           — Workflow docs
```

### taskExecution Workflow

```
Input: { taskTitle, taskDescription, acceptanceCriteria, tenantId,
         attachmentContext, referenceText, links, autoApprove }

planStep
  → no tools
  → generates 2-4 search queries
  → uses attachmentContext + referenceText for targeting

approvalStep
  → pass-through when autoApprove: true (default)
  → suspend() when autoApprove: false
  → waits for run.resume({ step: 'approval', resumeData: { approved: true } })
  → mastraRunId saved to agentTasks.mastra_run_id on suspend

foreach(searchStep, { concurrency: 3 })
  → Pass 1: internet_search (Exa) via platformAgent
  → Pass 2: formatterAgent extracts resultItemSchema[]
  → resultItemSchema: { title, source?, url?, location?, metadata? }

mergeStep
  → pure TypeScript
  → deduplicates by url (or source::title fallback)
  → sums token counts from all searches

composeStep
  → no tools
  → formats merged results into user-facing summary
  → reads acceptanceCriteria for DoD check
```

### Suspend/Resume Flow

```
1. autoApprove: false → workflow suspends at approvalStep
2. mastraRunId saved to agentTasks.mastra_run_id
3. Task status → awaiting_approval + WebSocket event
4. User calls: PUT /api/v1/tasks/:taskId/workflow/approve
5. Lambda → relay: POST /api/tasks/:taskId/resume
6. Relay fetches mastraRunId from DB
7. Reconstructs: workflow.createRun({ runId: mastraRunId })
8. Calls: run.resume({ step: 'approval', resumeData: { approved: true } })
9. Workflow continues → searches → merge → compose
10. Task status → review
```

### Quota Enforcement

Before `workflow.createRun()`:

```typescript
await checkMessageQuota(tenantId, plan)  // messages/month gate (429 if over)
await checkTokenQuota(tenantId, plan)    // llm_tokens/month gate (throws if over)
```

Token limits:
| Plan | llm_tokens/month |
|---|---|
| free | 10,000 |
| starter | 100,000 |
| business | 1,000,000 |
| enterprise | unlimited |

---

## 18. Development Loop

```
1. Edit workflow/agent/tool code
2. npm run build (in apps/relay)
3. pm2 restart agent-relay
4. Open Studio: http://localhost:3001/studio
5. Test in Studio → iterate
6. When quality is good → it's already live
```

Studio runs against your live relay. What works in Studio works in production.

### Testing via curl

```bash
# Create and start a workflow run
RUN_ID=$(curl -s -X POST http://localhost:3001/api/workflows/taskExecution/createRun \
  -H "Content-Type: application/json" -d '{}' | jq -r '.runId')

curl -s -X POST "http://localhost:3001/api/workflows/taskExecution/$RUN_ID/start" \
  -H "Content-Type: application/json" \
  -d '{
    "inputData": {
      "taskTitle": "Research top CRM tools for Indian SMEs",
      "tenantId": "YOUR_TENANT_ID",
      "autoApprove": true
    }
  }' | jq '{status: .status, summary: .result.summary}'
```

---

## 19. Workflow Roadmap

### What Exists
```
taskExecution.ts (searchWorkflow)
  → plan → approval → foreach(search) → merge → compose
  → Exa search, generic resultItemSchema
  → Token tracking per step
  → Suspend/resume wired
```

### What's Planned (Separate Sessions)

**searchWorkflow (complete current)**
- Add Crawl4AI (self-hosted) — replaces web_fetch
- Add Tavily as second search source
- Rename to searchWorkflow.ts

**documentWorkflow**
- retrieve_documents (existing MCP tool)
- attachment context (existing)
- No web search needed
- Tasks: summarize policy, analyze contract, answer from knowledge base

**jobSearchWorkflow (specialized)**
- Apify actors for Naukri, LinkedIn
- Resume matching step
- Premium feature

**actionWorkflow**
- MCP tool execution (Gmail, Calendar, Zoho)
- ALWAYS suspends for approval
- Irreversible actions need human gate

**researchWorkflow (scheduled background)**
- EventBridge cron trigger
- AgentBrowser for JS-heavy sites
- Pre-crawls and stores in tenant DB
- searchWorkflow queries pre-crawled DB first

**router (after all workflows)**
- Detects task type
- Routes to correct workflow
- Keyword + heuristic detection

---

## 20. Code Reference: Memory Configuration

```typescript
import { PostgresStore } from '@mastra/pg'
import { Memory } from '@mastra/memory'
import pg from 'pg'

let store: PostgresStore | null = null
let memory: Memory | null = null

export function getMastraStore(): PostgresStore {
  if (store) return store

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  store = new PostgresStore({
    id: 'mastra-pg-store',
    pool,
    schemaName: 'mastra',
  })

  return store
}

export function getMastraMemory(): Memory {
  if (memory) return memory

  memory = new Memory({
    storage: getMastraStore(),
    options: {
      lastMessages: 10,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
  })

  return memory
}
```

---
## 21. Multi-Agent Architecture (PM System)

### Finalized Project Tree

```
apps/relay/
├── skills/                                    ← content, not code
│   ├── prd-writing/
│   │   └── SKILL.md                           ✅ done
│   ├── requirements-gathering/
│   │   └── SKILL.md                           ✅ done
│   ├── roadmap-planning/
│   │   └── SKILL.md                           ← TO ADD (Phase 2)
│   └── task-breakdown/
│       └── SKILL.md                           ← TO ADD (Phase 3)
│
└── src/mastra/
    ├── index.ts                               ✅ registers everything
    │
    ├── agents/
    │   ├── platformAgent.ts                   ✅ chat only, PRD suffix removed
    │   ├── pmAgent.ts                         ← TO BUILD (Phase 1)
    │   ├── prdAgent.ts                        ✅ workspace + workflows + scorers
    │   ├── roadmapAgent.ts                    ← TO BUILD (Phase 2)
    │   ├── taskAgent.ts                       ← TO BUILD (Phase 3)
    │   └── formatterAgent.ts                  ✅ unchanged
    │
    ├── workflows/
    │   ├── prdWorkflow.ts                     ✅ gatherStep→writeStep→formatStep
    │   ├── roadmapWorkflow.ts                 ← TO BUILD (Phase 2)
    │   ├── taskWorkflow.ts                    ← TO BUILD (Phase 3)
    │   ├── taskExecution.ts                   ✅ unchanged
    │   ├── documentWorkflow.ts                ✅ unchanged
    │   ├── steps/
    │   │   └── dodVerifyStep.ts               ✅ unchanged
    │   └── scorers.ts                         ✅ dodPassScorer
    │
    ├── scorers/
    │   ├── prdCompleteness.ts                 ✅ done
    │   ├── roadmapCompleteness.ts             ← TO BUILD (Phase 2)
    │   └── taskClarity.ts                     ← TO BUILD (Phase 3)
    │
    ├── workspace/
    │   ├── prdWorkspace.ts                    ✅ done, path fixed
    │   ├── roadmapWorkspace.ts                ← TO BUILD (Phase 2)
    │   └── taskWorkspace.ts                   ← TO BUILD (Phase 3)
    │
    ├── tools/
    │   ├── fetchAgentContext.ts               ← TO BUILD (Phase 1)
    │   └── savePRD.ts                         ← TO BUILD (Phase 1)
    │
    ├── model.ts                               ✅ unchanged
    ├── memory.ts                              ✅ unchanged
    ├── thinking.ts                            ✅ unchanged
    └── tools.ts                               ✅ MCP client cache
```

### Build Phases

```
Phase 1 — NOW
  pmAgent.ts
  tools/fetchAgentContext.ts + tools/savePRD.ts
  agent_prds DB table
  chatStream.ts routing (PM intent → pmAgent)

Phase 2 — NEXT
  roadmapAgent.ts + roadmapWorkspace.ts + roadmapWorkflow.ts
  skills/roadmap-planning/SKILL.md
  scorers/roadmapCompleteness.ts

Phase 3 — LATER
  taskAgent.ts + taskWorkspace.ts + taskWorkflow.ts
  skills/task-breakdown/SKILL.md
  scorers/taskClarity.ts
```

### Agent Responsibilities — One Job Per Agent

```
platformAgent   → chat interface only. Routes PM-intent to pmAgent.
                  NEVER handles PRD, roadmap, or task generation directly.

pmAgent         → supervisor/orchestrator only. Delegates to specialists.
                  NEVER generates PRD or roadmap content itself.

prdAgent        → PRD generation and refinement only.
                  NEVER generates roadmap or task breakdown.

roadmapAgent    → roadmap from approved PRD only.
                  NEVER generates PRD or task breakdown.

taskAgent       → task breakdown from approved roadmap only.
                  NEVER generates PRD or roadmap.

formatterAgent  → structured JSON output only. Unchanged.
```

### Supervisor Pattern — Correct Implementation

.network() is DEPRECATED. Do NOT use it.
Use .stream() or .generate() on the supervisor agent instead.

```ts
// CORRECT
const stream = await pmAgent.stream(userMessage, {
  maxSteps: 10,
  delegation: {
    onDelegationStart: async (context) => {
      return { proceed: true }
    }
  }
})

// WRONG — deprecated, do not use
await pmAgent.network(userMessage)
```

Rules:
- Every subagent MUST have a description field on the Agent config
- pmAgent decides delegation based on subagent descriptions
- Use .stream() for chat responses, .generate() for non-streaming

### A2A Protocol — Future Only

A2A is Google's open standard for cross-platform agent communication.
Mastra supports it via @mastra/client-js A2A class.

DO NOT implement A2A now. Current agents are all internal to the
same Mastra instance — use supervisor pattern instead.

```
Supervisor Pattern  ← same Mastra instance  ← USE NOW
A2A                 ← cross-platform/server ← FUTURE ONLY
MCP                 ← agent-to-tool         ← already in use
```

---
## 22. PRD Agent — Design Decisions

### Output Format

```
80% → markdown   triggers: default, simple requirements
20% → HTML       triggers: user says "detailed" / "full" / "formatted"

NEVER generate PDF or DOCX directly.
Export is on-demand only — user clicks Export → backend
calls docx/pdf skill → saved to documents table.
```

### PRD Lifecycle

```
user → platformAgent (chat)
     → detects PM intent
     → routes to pmAgent
     → pmAgent delegates to prdAgent
     → prdWorkflow runs: gatherStep → writeStep → formatStep
     → streams markdown/HTML artifact to frontend
     → user refines iteratively
     → saved to agent_prds (status: draft)
     → user submits for approval (status: pending_approval)
     → leadership approves (status: approved)
     → pmAgent delegates to roadmapAgent (Phase 2)
```

### agent_prds Table Schema

```sql
id                    uuid primary key default gen_random_uuid()
tenant_id             uuid not null references tenants(id)
agent_id              uuid not null references agents(id)
title                 varchar not null
content               text not null
content_type          varchar not null default 'markdown'
                      -- 'markdown' | 'html'
status                varchar not null default 'draft'
                      -- draft | pending_approval | approved | rejected
version               integer not null default 1
created_from_task_ids uuid[]
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
```

### Memory Decision

prdAgent has NO Mastra memory configured.
Reason: PRD generation is a task, not a conversation.

Pattern instead:
- Active session: conversation history via thread/resourceId (automatic)
- Resume session: load saved agent_prds.content into requestContext
  at session start — inject as initial context, not memory

```ts
// In chatStream.ts when user reopens a PRD session:
const existingPrd = await fetchPRDDraft(agentId)
if (existingPrd) {
  requestContext.set('existingPrdDraft', existingPrd.content)
  requestContext.set('existingPrdId', existingPrd.id)
}
```
```
