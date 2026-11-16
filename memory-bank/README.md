# Memory Bank: how to use

This folder is the persistent project memory for FIO Manager. Read it all at the start of every session, before touching code, then update it as work progresses.

| File | Purpose | Update when |
|---|---|---|
| `projectbrief.md` | What we build, for whom, scope and non-goals | Scope changes |
| `productContext.md` | Why it exists, user workflows, UX goals | Product direction changes |
| `systemPatterns.md` | Architecture, data model, state machine, design decisions | Any architectural change or new decision |
| `techContext.md` | Stack, versions, env vars, cluster facts, dev and deploy commands, constraints | Tooling or environment changes |
| `activeContext.md` | Current focus, recent changes, open issues, next steps | At the end of every session |
| `progress.md` | Done / not done, decision log, lessons learned | When a feature lands or a decision is made |

Rules:
- Keep entries factual and short. Prefer "decision + reason" over narrative.
- Never store credentials here (cluster passwords, tokens). Ask the user for them each session.
- If code and memory bank disagree, trust the code, then fix the memory bank.
