# DinerAI app (iPhone and Android)

Expo (SDK 58) + Expo Router. Plan, decisions and phases: `../docs/app-plan.md` (step 50).
Read `AGENTS.md` before touching Expo APIs: they change every SDK release.

## Run it on a phone

```bash
cd mobile
npm install
npx expo start --tunnel      # then scan the QR code with Expo Go (iPhone camera, or the Expo Go app on Android)
```

The app talks only to the web app's `/api/app/*` routes (login, refresh, me, ...), at
`EXPO_PUBLIC_API_URL` (default https://app.dinerai.co.uk, the live site). To use a local
web app, set `EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:3000` in `mobile/.env.local`.

## How it's put together

- `src/app/`: screens (Expo Router). `_layout.tsx` = logged in → `(tabs)`, else `sign-in`; the lock screen on top.
- `src/lib/api.ts`: login, refresh and logged-in calls; tokens in the phone's secure storage, never the database directly.
- `src/lib/session.tsx`: who's logged in, and the Face ID / fingerprint lock (after 5 minutes away).
- `src/components/ui.tsx`: Screen, Card, T (text), Button. `src/constants/theme.ts`: DinerAI colours, light and dark.
- Placeholder icon (`assets/images/icon.png`) until the owner's designed one arrives.

## Checks

```bash
npx tsc --noEmit && npx expo lint && npx expo-doctor
```

Face ID can't be tested in Expo Go on iPhone (it falls back to the passcode); it needs a development build (`npx eas-cli@latest build --profile development`).
