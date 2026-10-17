import "server-only";
import { getSupabase } from "@/lib/supabase";

// Shared bits for the operations helpers. Every query names its restaurant
// (tests/isolation.test.ts checks), and errors throw with the table's name.

export const db = () => getSupabase();

export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}
