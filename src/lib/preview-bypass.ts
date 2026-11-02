// Preview deployments sit behind Vercel's login (Deployment Protection), so
// anything that calls a preview from outside a browser needs Vercel's "Protection
// Bypass for Automation" key: Twilio (the webhook link, and the pictures it
// fetches) and our own call that starts a queue worker. Vercel puts the key in
// VERCEL_AUTOMATION_BYPASS_SECRET once it's switched on (Settings > Deployment
// Protection). Production isn't protected, so nothing changes there.
// No imports, unit-tested (tests/preview-bypass.test.ts).

const secret = (env: Record<string, string | undefined>) => (env.VERCEL_ENV === "preview" ? env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null : null);

// Headers for a call to our own preview.
export function bypassHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const s = secret(env);
  return s ? { "x-vercel-protection-bypass": s } : {};
}

// A link Twilio fetches (a picture), with the key added on a preview.
export function bypassUrl(url: string, env: Record<string, string | undefined> = process.env) {
  const s = secret(env);
  if (!s) return url;
  return `${url}${url.includes("?") ? "&" : "?"}x-vercel-protection-bypass=${encodeURIComponent(s)}`;
}
