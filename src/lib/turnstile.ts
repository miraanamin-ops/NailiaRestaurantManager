import "server-only";

// Cloudflare Turnstile: the free "I'm human" check on the customer sign-up form.
// TURNSTILE_SITE_KEY is shown on the form; TURNSTILE_SECRET_KEY checks the answer.
// Without the keys the check is skipped (rate limits still apply).

export function turnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || null;
}

export async function verifyTurnstile(token: string, ip: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: "missing" };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const out = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return out.success ? { ok: true } : { ok: false, error: (out["error-codes"] ?? []).join(",") || "failed" };
  } catch (err) {
    // Cloudflare unreachable: let people sign up (rate limits still protect the form).
    console.error("Turnstile check failed", err);
    return { ok: true, skipped: true };
  }
}
