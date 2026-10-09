# Naila (working name)

An AI marketing assistant for independent restaurants, run by the owner over
WhatsApp: the AI drafts the work, the owner taps Approve, Edit or Skip, and
nothing goes out unless it passes plain-code safety rules.

- What's built, the stack and the design rules: [CLAUDE.md](CLAUDE.md)
- Database changes: numbered SQL files in [`supabase/`](supabase), pasted into
  Supabase > SQL Editor; `node --env-file=.env.local scripts/check-schema.mjs`
  shows which have been run
- Tests: `npm test` · local app: `npm run dev`

All keys live in environment variables (Vercel, and `.env.local` locally), never in code.
