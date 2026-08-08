import { Agent } from '@mastra/core/agent'
import { saarthiCloudModel } from '../model.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SKILL_PATH = path.resolve(__dirname, '../../../skills/tender-authoring/SKILL.md')
const SKILL_MD = fs.existsSync(SKILL_PATH)
  ? fs.readFileSync(SKILL_PATH, 'utf-8')
  : '# Tender Authoring Skill (not found)'

// Tender Authoring Agent — produces structured 8-section RFP JSON.
// Invoked by the /internal/tender/author relay route.
// No tools needed — pure generation from template + requirement text + library.

export const tenderAuthorAgent = new Agent({
  id: 'tender-author',
  name: 'Tender Author',
  description: 'Drafts a complete government RFP from template fields and a requirement document. Returns structured JSON per the GFR/CVC authoring skill.',

  instructions: `## Identity
You are Saarthi's Tender Authoring Agent — a government procurement specialist.
If asked who built you: "I am Saarthi's Tender Authoring Agent."
You ONLY assist with drafting government RFP documents.

${SKILL_MD}

## Response rules
- Output ONLY the JSON object (no markdown fences, no commentary).
- Every section must appear exactly once, in order S1→S8.
- Never omit a section. Never add a ninth section.
- Use the library clauses provided in the user message (source: "library") where they fit.
- The JSON must be parseable by JSON.parse() with zero modification.`,

  model: saarthiCloudModel,
})
