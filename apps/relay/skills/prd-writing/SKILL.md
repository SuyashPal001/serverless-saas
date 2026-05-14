---
name: prd-writing
description: How to write a clear, complete Product Requirements Document (PRD) that engineering teams can act on immediately.
version: 1.0.0
tags: [product, requirements, planning, documentation]
---

# PRD Writing Skill

## When to Use This Skill

Use this skill when a user asks you to write a PRD, product spec, feature brief, or requirements document. Before writing anything, gather the information listed in the Clarifying Questions section below.

## Clarifying Questions to Ask First

Do not write a PRD until you have answers to these questions. Ask them all in a single message:

1. **What problem does this solve?** Who experiences it and how often?
2. **Who are the target users?** (role, technical level, internal vs external)
3. **What is the desired outcome?** What does success look like for users?
4. **What is explicitly out of scope?** What won't this solve?
5. **Are there hard constraints?** (deadline, platform, compliance, budget)
6. **Are there existing designs, tickets, or related docs to reference?**

If the user has already answered some of these, acknowledge them and only ask for what is missing.

## PRD Structure

Write every PRD using this exact structure. Do not skip sections.

### 1. Problem Statement
One paragraph. Describe the problem, who has it, and the business impact of leaving it unsolved. No solution language here.

### 2. Goals
Bullet list. 3–5 specific, measurable goals. Each goal should be verifiable — avoid vague words like "improve" or "better".

### 3. Non-Goals
Bullet list. Be explicit about what this PRD does NOT cover. This prevents scope creep during development.

### 4. User Stories
Use this format for each story:

> As a **[user type]**, I want to **[action]** so that **[outcome]**.

Include acceptance criteria for each story as a nested checklist.

### 5. Functional Requirements
Numbered list. Each requirement must be:
- **Specific**: describes exactly one behaviour
- **Testable**: a QA engineer can write a test for it
- **Independent**: does not duplicate another requirement

Use `MUST`, `SHOULD`, `MAY` (RFC 2119) to signal priority.

### 6. Non-Functional Requirements
Address each that applies:
- **Performance**: latency targets, throughput, SLA
- **Security**: auth, data handling, compliance (GDPR, SOC2, etc.)
- **Reliability**: uptime target, error rate budget
- **Scalability**: expected load, growth projections
- **Accessibility**: WCAG level if applicable

### 7. Success Metrics
Numbered list. For each metric:
- Metric name
- Current baseline (if known)
- Target value
- How it will be measured and by whom

### 8. Open Questions
Table with columns: Question | Owner | Due Date

List every decision that is not yet made. Do not leave open questions implicit.

## Output Format Guidelines

- Use Markdown throughout
- Keep the document under 1500 words — if it grows larger, split into sub-PRDs
- Write in present tense ("The system sends..." not "The system will send...")
- No implementation details — this is the *what*, not the *how*
- Link to designs, prototypes, or related tickets inline when referenced
- End every PRD with a one-line TL;DR at the top (after the title), before the Problem Statement
