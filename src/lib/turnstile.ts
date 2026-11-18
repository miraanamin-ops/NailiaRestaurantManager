import "server-only";

// Cloudflare Turnstile: the free "I'm human" check on the customer sign-up form.
// TURNSTILE_SITE_KEY is shown on the form; TURNSTILE_SECRET_KEY checks the answer.
// Without the keys, or if Cloudflare can't be reached, the check is skipped
// everywhere except production, where the form is refused instead (fail closed:
// a missing key or an outage must never quietly switch the robot check off).

export function turnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || null;
}

export async function verifyTurnstile(token: string, ip: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (isProduction()) {
      console.error("TURNSTILE_SECRET_KEY is missing on production: sign-up refused");
      return { ok: false, error: "not-configured" };
    }
    return { ok: true, skipped: true };
  }
  if (!token) return { ok: false, error: "missing" };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const out = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return out.success ? { ok: true } : { ok: false, error: (out["error-codes"] ?? []).join(",") || "failed" };
  } catch (err) {
    console.error("Turnstile check failed", err);
    // Cloudflare unreachable: refused on production (the person can try again),
    // let through elsewhere so local and preview testing keeps working.
    if (isProduction()) return { ok: false, error: "unavailable" };
    return { ok: true, skipped: true };
  }
}

function isProduction() {
  return process.env.VERCEL_ENV === "production";
}
