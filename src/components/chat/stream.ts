import type { ChatMessage, ProgressData } from "./types";

// The events the chat endpoint streams (app/api/onboarding/chat/route.ts), one JSON
// object per line, and a reader that hands each one over as soon as its line is
// complete, even when a line arrives split across chunks.

export type ChatEvent =
  | { type: "typing" }
  | { type: "status"; text: string }
  | { type: "message"; message: ChatMessage }
  | { type: "state"; progress: ProgressData; skippable: boolean }
  | { type: "done" }
  | { type: "error"; text: string };

export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: ChatEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (final: boolean) => {
    const lines = buffer.split("\n");
    buffer = final ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as ChatEvent);
      } catch {
        // A broken line is skipped; the rest still arrive.
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flush(false);
  }
  buffer += decoder.decode();
  flush(true);
}
