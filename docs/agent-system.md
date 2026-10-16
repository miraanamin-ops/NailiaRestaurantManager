# DinerAI agent system

How the agent organisation works, for anyone (or any AI) building on this codebase. Read this before changing anything in `/agents` or the agent pipeline.

## What `/agents` is

The files in `/agents` are runtime instructions for DinerAI's own AI agents. They are loaded by the app as system prompts. They are not instructions for the coding assistant.

```
/agents
  house-rules.md       loaded by every agent, first
  gm.md                the only agent that messages the owner
  reputation.md        reviews and replies
  growth.md            customers, campaigns, specials
  visibility.md        Google, photos, content briefs
  insights.md          numbers, reports, menu engineering
  checker.md           reviews every draft
  profile-keeper.md    keeps the restaurant profile up to date
  /tests
    /<agent>/          saved real examples per agent
```

## How an agent call is built

1. Parse the agent file's front matter: `model`, `tools`, `triggers`, `version`.
2. System prompt = `house-rules.md` + the agent's file.
3. Context = the restaurant profile (from the database, never a file) + the job's data.
4. Only the tools listed in front matter are offered. Enforce this as an allow-list in code.
5. Map `sonnet` and `haiku` to model IDs in one config file (currently `claude-sonnet-5-5` and `claude-haiku-5-5`).

## The pipeline

```
trigger → job → maker agent → checker → (owner via GM, or Auto) → release gate → channel
```

- **Jobs:** every job has a unique ID and is idempotent, so retries never send twice.
- **Maker output:** validated against the shared draft schema (house rules section 9 plus the agent's own fields). Invalid output: retry once, then fail the job and alert the watchdog.
- **Checker:** fail sends the draft back to the maker with the fix notes. After 2 failed revisions, escalate to the owner via the GM.
- **Approval:** drafts needing approval join the GM's next brief or alert. Auto drafts go straight to the gate.
- **Logging:** every step is written to the audit log with the job ID, agent, version and verdict.

## The release gate (plain code, never AI)

The gate is the last step before anything leaves the system. It checks:

- Approved by the owner, or the task is set to Auto for this restaurant and the checker passed it. Every task defaults to Approve; only the builder can switch a task to Auto, from an admin setting. Campaigns, offers, hours, menu and profile changes can never be Auto.
- Recipient opted in and hasn't sent STOP (for email, STOP is the unsubscribe link)
- No customer gets more than one campaign in any 7 days (birthday messages excepted)
- Inside the send window (9am to 9pm)
- Discount at or under the restaurant's cap
- Unsubscribe link present in every campaign email
- Not a duplicate of something already sent
- PAUSE is off
- Simulation, as a gate step (the switches in `src/lib/switches.ts`): with EMAIL_REDIRECT on (always in preview and development) no email reaches a real customer, GOOGLE_MODE=simulated posts nothing to Google, and no agent is live unless AGENTS_LIVE_ALLOWED allows it (false is a kill switch)

These rules live only in code. Never move them into a prompt, and never let a prompt or the profile keeper loosen them.

## Tools to build

| Tool | Used by | What it does |
| --- | --- | --- |
| `query_metrics` | Insights | Computes every number in code. Agents never do arithmetic. |
| `resolve_sources` | Checker | Fetches the real data behind each `sources_used` entry |
| `get_rendered_preview` | Checker | Mobile screenshot of the email, post or card |
| `propose_profile_change`, `apply_profile_change` | Profile keeper | Versioned profile updates with undo |
| `get_decision_log` | Profile keeper | Approvals, edits and skips with before and after |
| `route_to_specialist` | GM | Hands an owner request to one specialist |

## Rules for changing this system

- Don't edit an agent file unless asked to.
- When an agent file changes, bump its `version`, add a changelog line, and run its tests in `/agents/tests/<agent>/` before merging.
- Agent tests run on every push, alongside the existing tests.
- New agent tools must be added to that agent's front matter and the allow-list together.
- Never give an agent a tool that sends, publishes or spends. Only the release gate does that.
- With EMAIL_REDIRECT on and GOOGLE_MODE dummy or simulated, nothing reaches a real customer or platform. TEST_MODE is deprecated: it only fills in a switch that is not set.

## Build order

1. Shared draft schema, `house-rules.md` loading, and the checker with `resolve_sources`.
2. Split Reputation out of the current single brain and pass its tests.
3. Visibility, Growth and Insights, one at a time, each passing its tests before going live.
4. Slim the GM down to a Haiku router plus the brief composer.
5. Profile keeper, built on the existing saved edits.
