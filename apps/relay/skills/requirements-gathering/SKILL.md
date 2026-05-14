---
name: requirements-gathering
description: How to extract complete, unambiguous requirements from stakeholders through structured questioning before writing any specification.
version: 1.0.0
tags: [requirements, discovery, stakeholders, planning]
---

# Requirements Gathering Skill

## When to Use This Skill

Use this skill before writing any spec, PRD, or technical design when the user's request is vague, incomplete, or has missing stakeholder context. The goal is to surface hidden assumptions and surface conflicts early — not to interrogate the user.

Keep the conversation efficient. Ask clustered questions (3–5 at a time), not one at a time. Summarise what you've learned before moving to the next cluster.

## Step 1: Identify Stakeholders

Before collecting requirements, understand who is affected. Ask:

- **Requestor**: Who is asking for this? What is their role?
- **Primary users**: Who will use this feature day-to-day?
- **Secondary users**: Who is affected but not the main audience? (admins, support, ops)
- **Decision makers**: Who can change or veto requirements?
- **Downstream systems**: What other systems or teams depend on this?

Map stakeholders to a simple table: Name / Role / Interest / Influence.

## Step 2: Extract Functional Requirements

Functional requirements describe *what the system does*. Use these question frameworks:

### Event-Response Framework
For each key action: "When [trigger], the system [response]."
- What events trigger this feature?
- What does the system do in response to each event?
- What data does each event carry?
- What happens on failure or edge cases?

### User Journey Framework
Walk through the feature as a user:
1. What brings the user to this feature?
2. What is the first thing they see or do?
3. What are the decision points along the way?
4. What is the happy-path end state?
5. What are the failure states and how are they handled?

### Data Framework
- What data does this feature create, read, update, or delete?
- Who owns each piece of data?
- What are the retention, privacy, or compliance requirements on that data?
- What validations must the data pass?

## Step 3: Extract Non-Functional Requirements

Non-functional requirements describe *how well the system performs*. Cover each category:

| Category | Key Questions |
|---|---|
| **Performance** | What response time is acceptable? What is peak load? |
| **Reliability** | What is the acceptable downtime? What happens during an outage? |
| **Security** | Who can access this? What data is sensitive? Any compliance requirements? |
| **Scalability** | How many users now? In 12 months? In 3 years? |
| **Maintainability** | Who will own this long-term? What is the expected change rate? |
| **Compatibility** | What browsers, devices, or API versions must be supported? |

## Step 4: Validate and Prioritise

Once requirements are drafted, run them through these checks:

### Completeness Check
- Is there a requirement for every user story?
- Is every external system interaction specified?
- Are all error states handled?

### Consistency Check
- Do any requirements contradict each other?
- Do any requirements duplicate each other?
- Are all terms used consistently?

### Prioritisation (MoSCoW)
Label each requirement:
- **Must have** — system fails without it
- **Should have** — high value, workaround exists
- **Could have** — nice-to-have if time allows
- **Won't have** — explicitly out of scope for this release

## Step 5: Confirm Understanding

Before handing off to a PRD or spec, summarise your understanding back to the user in this format:

> **My understanding:** [2–3 sentences describing what you're building and for whom]
>
> **Key requirements I'll capture:**
> - [Functional requirement 1]
> - [Functional requirement 2]
> - ...
>
> **Assumptions I'm making:**
> - [Assumption 1]
> - [Assumption 2]
>
> **Still unclear:**
> - [Open question 1]

Ask the user to confirm or correct before proceeding.

## Anti-Patterns to Avoid

- Do not accept "the system should be fast" — always ask for a number
- Do not merge requirements — one sentence, one behaviour
- Do not skip non-functional requirements — they cause the most rework
- Do not write requirements in the future tense ("will") — use present tense ("does")
- Do not list solutions as requirements — "users can export to CSV" is a requirement; "we'll use Papa Parse" is not
