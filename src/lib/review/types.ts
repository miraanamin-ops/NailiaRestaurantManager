// What each part of the business review saves (business_review_parts.result).
// Counts only, worked out by code: the message and the page are built from these.
import type { Part } from "./config";

export type PartResults = {
  reviews_sync: { connected: boolean; rating: number | null; total: number | null; synced: number; unanswered: number };
  backlog: { unanswered: number; drafted: number; positiveReady: number; negative: number };
  themes: {
    reviewCount: number;
    praises: string[];
    complaint: { label: string; count: number } | null;
    skipped?: "few_reviews";
    complaints?: { label: string; count: number; example: string | null }[];
    summary?: string | null;
    action?: string | null;
  };
  // steps: the copy-paste instructions (things Google only lets the owner change).
  profile: { score: number; fixes: number; examples: string[]; asks: string[]; copyPaste: number; steps?: { label: string; text: string }[]; draftId?: string | null };
  // Aggregates only: rivals' own details are fetched fresh (Places terms).
  rivals: { ours: { rating: number; count: number } | null; nearby: { average: number; n: number } | null };
  events: { names: string[]; drafted: number; emailsHeld: boolean };
  poster: { ready: boolean };
};

export type PartResult<P extends Part = Part> = PartResults[P];

export type BusinessReview = {
  id: string;
  restaurant_id: string;
  status: "queued" | "running" | "sending" | "sent" | "waiting_window" | "failed" | "nothing";
  started_by: "onboarding" | "builder" | "test";
  google_connected: boolean | null;
  started_at: string | null;
  deadline_at: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  sent_via: "session" | "template" | "waiting" | null;
  facts: Record<string, unknown> | null;
  message: string | null;
  flow_step: string | null;
  flow_state: Record<string, unknown>;
  flow_started_at: string | null;
  flow_ended_at: string | null;
  receipt_due_at: string | null;
  receipt_sent_at: string | null;
  created_at: string;
};

export type PartRecord = {
  review_id: string;
  restaurant_id: string;
  part: Part;
  status: "queued" | "done" | "failed" | "skipped";
  result: Record<string, unknown> | null;
  error: string | null;
};
