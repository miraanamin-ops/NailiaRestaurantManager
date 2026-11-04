# The business review after onboarding

Built 3 Nov 2026 (step 40 in CLAUDE.md). Code: `src/lib/review/`. Migration: `supabase/058_business_review.sql` (rollback: `supabase/rollback/business_review_rollback.sql`).

## What the owner gets

1. Dina's last setup message adds: "Give me about 5 minutes to review your business. I'll message you here."
2. About 5 to 10 minutes later, one WhatsApp message: rating against nearby rivals, reviews with no reply (replies drafted), the Google profile score with fixes ready, what customers love and complain about, the next events with campaigns drafted, the QR poster, about how much time it saved, a "Let's go" button and the link to the full review page.
3. "Let's go" (or GO) walks them through it, one step at a time: replies (Approve all only for 4 to 5 star replies that passed every check), the harder replies one by one, profile fixes, what customers say, which community dates to plan for, the planned campaigns and posts, the poster. "Next?" after each. STOP or LATER ends it, and everything left waits in the morning brief.
4. That evening (8pm, or 2 hours later if the review came after 6pm, never after 9pm): a receipt of what went out, what's waiting and the time saved. Otherwise it's in the next morning brief.

See `docs/business-review-transcript.md` for every message, from a real run on the three fixture sites.

## Who gets it

- Automatically: test and demo sites now. Real sites once `OPEN_TO_REAL_SITES` in `src/lib/review/config.ts` is `true`, and only with the builder's OK.
- By hand: the admin console, `/onboarding/admin/business-review`, for any restaurant with WhatsApp linked. You type the name to confirm. Google dry run still applies, because every write goes through the release gate.
- Never twice for a restaurant (one row in `business_reviews`). "Run again" on the admin page or `RUN BUSINESS REVIEW` (test tools) replaces it. What it drafted stays in the queue.

## Settings and outside pieces

| What | Where | Status |
|---|---|---|
| Migration 058 | Supabase > SQL Editor, on live and on dev | To run |
| `GOOGLE_PLACES_API_KEY` | Vercel env (already set for onboarding) | Rivals need it on real sites; test and demo sites use fixtures |
| `PLACES_DAILY_MAX` | Vercel env (default 100) | A review uses 2 to 3 calls; the review page 1 per rival per view |
| Template `dinerai_business_review_ready_v1` | Twilio Content, needs Meta's approval | Waits for the real WhatsApp sender. On the sandbox the review waits for the owner's next message and the link is emailed |

## Costs (Claude)

A connected site with 22 unanswered reviews costs about $1 to $2: each reply is a write plus two checks. Tagging 60 reviews (Haiku) costs a few cents. Each event's campaign and post costs about 10p. A site with few reviews costs about 10p. Rivals are Google Places: about 2 to 3 calls per review.

## Known limits

- Answers to Dina's questions (Christmas hours, a menu link, vegetarian options) go to the assistant like any message. They update the restaurant's details, not Google directly; the next profile fixes pick them up.
- Categories, photos and cover photos are copy-paste steps for the owner (the API isn't used for those).
- Moon-sighted dates (Ramadan, both Eids) are expected dates, marked uncertain until the mosques confirm.
- School half terms are the East London councils' (Tower Hamlets, Newham, Redbridge). Other areas would need their own.
- Email campaigns wait while nobody is on the customer list. They stay in the queue (and the brief) until there are subscribers.
