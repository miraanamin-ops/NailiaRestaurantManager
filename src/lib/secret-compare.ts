import { createHash, timingSafeEqual } from "node:crypto";

// Compares a request's "Authorization: Bearer ..." header with a secret in
// constant time, so the answer's timing gives nothing away about the secret.
// Both sides are hashed first, so different lengths compare safely too.
export function bearerMatches(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
