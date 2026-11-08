# Switching WhatsApp from the sandbox to our own number (workplan 2.5)

Our sender: **+44 7403 690497** (Twilio, display name "Dinerai", online since 8 Nov 2026).
The code needs no change: everything follows `TWILIO_WHATSAPP_NUMBER` (`src/lib/onboarding/channel.ts`).
When it isn't the sandbox, the "join happy-tiger" step disappears from sign-up, setup and the staff
instructions, and the opener templates are used (step 46).

## Before

1. All templates approved: `node --env-file=.env.local scripts/whatsapp-templates.mjs` shows
   `approved` for every one (the general opener is `dinerai_account_message_v2`; `dinerai_update_waiting_v1`
   is no longer used).

## The switch (about 15 minutes, in this order)

1. **Twilio**: Messaging > Senders > WhatsApp senders > +447403690497 > Edit Sender >
   "Webhook URL for incoming messages": `https://app.dinerai.co.uk/api/whatsapp`, method HTTP POST. Save.
2. **Vercel** > nailiarestaurantmanager > Settings > Environment Variables, **Production only**:
   - `TWILIO_WHATSAPP_NUMBER` = `whatsapp:+447403690497`
   - `BUILDER_WHATSAPP_FROM` = `whatsapp:+14155238886` (builder alerts stay on the sandbox, which your phone has joined)
   Previews and local keep the sandbox (leave those unset).
3. **Redeploy** production (Deployments > latest > Redeploy) so the new setting is used.
4. **Supabase (live) SQL**: move real restaurants to the new number (demo and placeholder ones untouched):
   ```sql
   update restaurants set whatsapp_from = 'whatsapp:+447403690497'
   where whatsapp_from = 'whatsapp:+14155238886' and not coalesce(is_demo, false);
   ```
5. **Test**: from your phone, send "HELP" to +44 7403 690497. The answer comes from DinerAI. Then a
   test sign-up (`/start`): no join step, and the link code is sent to the new number.

## Notes

- The 24-hour window is per number: a message the owner sent to the sandbox doesn't open the new one.
  For a day after the switch, a reply-style message may fail; the next morning's brief opener fixes it.
- Undo: delete the two Vercel settings, redeploy, and run the SQL the other way round.
