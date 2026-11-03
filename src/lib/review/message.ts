import "server-only";
import type { Restaurant } from "@/lib/supabase";
import { fallbackMessage, type ReviewFacts } from "./rules";

// The business review's WhatsApp message. Every number comes from the facts
// (counted by code); the words are code's own lines.
export async function writeReviewMessage(facts: ReviewFacts, _r: Restaurant): Promise<string> {
  return fallbackMessage(facts);
}
