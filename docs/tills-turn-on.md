# Turning on till connections (step 43)

Everything is built and tested on the `tills` branch. Nothing is live. This is
the list for the day we switch it on.

## Where it stands (6 Nov 2026)

| Till | Code | Tested | Waiting on |
|---|---|---|---|
| Dummy till | done | dev database, end to end (`tests/e2e/tills.e2e.ts`) | nothing |
| Square | done | real sandbox OAuth from the browser on dev: 15 orders, £280.25, matched | production keys (same app, switch to Production) |
| Epos Now | done | not against a real account | their Software Partnership Team (sign-up sent 6 Nov); a test API device |
| Lightspeed K-Series | done | not against a real account | partner application (needs company details) |
| Toast | done | not against a real account | partner application (needs company details) |

Decisions: sales and menu items only, no till customer data. Spreadsheets stay as the fallback.

## Turning it on

1. **Bring the branch up to date** with `main` and run the full test suite.
2. **Database:** run `supabase/060_till_connections.sql` on live (Supabase > SQL Editor). It only adds, so it's safe before the code is live. (Already on dev.)
3. **Vercel settings (Production):**
   - `TILL_TOKEN_KEY`: a new 32-byte random key, base64. Make a new one for live; don't reuse the dev one. **Once set, never change it**: stored till logins can't be read without it.
   - Square: `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET` (the **Production** ones), `SQUARE_ENVIRONMENT=production`. In Square's dashboard add the Production redirect URL `https://app.dinerai.co.uk/api/till/square/callback`.
   - Lightspeed (once approved): `LIGHTSPEED_CLIENT_ID`, `LIGHTSPEED_CLIENT_SECRET`, `LIGHTSPEED_ENVIRONMENT`; redirect URL `https://app.dinerai.co.uk/api/till/lightspeed/callback`. If their trial sign-in address isn't `auth.lsk-demo.app`, set `LIGHTSPEED_AUTH_HOST`.
   - Toast (once approved): `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`.
   - Epos Now needs only `TILL_TOKEN_KEY`. **Setting that key alone shows the Epos Now option to owners**, so set it only when Epos Now is meant to be on.
4. **Merge** the branch, wait for the Vercel deploy to show Ready.
5. **Check** on a demo restaurant: Settings > Till shows only the tills whose settings are in place; connect, wait for the first sync, check takings against the till.

A till without its settings simply doesn't appear (`missingSettings` in `src/lib/tills/providers.ts`).

## Local testing notes

- Local settings are in this worktree's `.env.local` only (Square sandbox: `SQUARE_ENVIRONMENT=sandbox`, App ID, secret, `SQUARE_SANDBOX_ACCESS_TOKEN` for making test orders, dev `TILL_TOKEN_KEY`).
- Run the dev server with `--webpack`: this worktree's `node_modules` is a link to `naila-dina`'s, and Turbopack refuses that.
- Square test orders: create an order with ad-hoc line items, then pay it with `source_id: "cnon:card-nonce-ok"`; it becomes COMPLETED and the sync reads it.
- Square's sandbox OAuth needs the test shop open in the same browser first (Developer dashboard > Sandbox test accounts > Open in Square Dashboard).
