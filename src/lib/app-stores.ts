// Where to download the DinerAI app. Set APP_STORE_URL and PLAY_STORE_URL in Vercel
// once the app is in the stores; until then pages say it's on its way.
export function appStoreLinks(env: Record<string, string | undefined> = process.env) {
  const links: { label: string; href: string }[] = [];
  if (env.APP_STORE_URL?.startsWith("https://")) links.push({ label: "App Store (iPhone)", href: env.APP_STORE_URL });
  if (env.PLAY_STORE_URL?.startsWith("https://")) links.push({ label: "Google Play (Android)", href: env.PLAY_STORE_URL });
  return links;
}
