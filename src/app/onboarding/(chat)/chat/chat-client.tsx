"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatLayout } from "@/components/chat/chat-layout";
import { readEvents } from "@/components/chat/stream";
import type { ChatMessage, ProgressData } from "@/components/chat/types";

// The web chat, talking to Dina: each tap or message goes to /api/onboarding/chat
// and her answer streams back (typing, what she's doing, then each checked message).
// The owner's own words show at once; a send that fails can simply be tried again
// (the same clientId is answered once).

type Action =
  | { kind: "start" }
  | { kind: "message"; text: string }
  | { kind: "answer"; messageId: string; choiceId: string; label: string }
  | { kind: "confirm"; messageId: string; changes: Record<string, string> }
  | { kind: "skip" }
  | { kind: "jump"; step: string };

export function ChatClient(props: {
  restaurantId: string;
  restaurantName: string;
  messages: ChatMessage[];
  chosen: Record<string, string>;
  progress: ProgressData;
  skippable: boolean;
  needsStart: boolean;
}) {
  const [messages, setMessages] = useState(props.messages);
  const [chosen, setChosen] = useState(props.chosen);
  const [progress, setProgress] = useState(props.progress);
  const [skippable, setSkippable] = useState(props.skippable);
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const send = useCallback(
    async (action: Action, ownerText?: string) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      const clientId = crypto.randomUUID();
      if (ownerText) {
        // Everything Dina asked before this counts as answered now.
        setMessages((m) => [...m.map((x) => (x.role === "dina" ? { ...x, answered: true } : x)), { id: clientId, role: "owner", text: ownerText }]);
      }
      setTyping(true);
      try {
        const res = await fetch("/api/onboarding/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ r: props.restaurantId, action: action.kind === "start" ? action : { ...action, clientId } }),
        });
        if (!res.ok || !res.body) {
          const why = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(why?.error ?? "I couldn't reach Dina. Please try again.");
        }
        await readEvents(res.body, (e) => {
          if (e.type === "status") setStatus(e.text);
          if (e.type === "message") {
            setStatus(null);
            setMessages((m) => [...m, e.message]);
          }
          if (e.type === "state") {
            setProgress(e.progress);
            setSkippable(e.skippable);
          }
          if (e.type === "error") setError(e.text);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "I couldn't reach Dina. Please try again.");
      } finally {
        setTyping(false);
        setStatus(null);
        busy.current = false;
      }
    },
    [props.restaurantId],
  );

  // The very first visit: Dina says hello.
  const started = useRef(false);
  useEffect(() => {
    if (props.needsStart && !started.current) {
      started.current = true;
      void send({ kind: "start" });
    }
  }, [props.needsStart, send]);

  return (
    <ChatLayout
      restaurantName={props.restaurantName}
      progress={progress}
      messages={messages}
      typing={typing}
      status={status}
      error={error}
      skippable={skippable}
      chosen={chosen}
      handlers={{
        onSend: (text) => void send({ kind: "message", text }, text),
        onPick: (messageId, o) => {
          setChosen((c) => ({ ...c, [messageId]: o.id }));
          void send({ kind: "answer", messageId, choiceId: o.id, label: o.label }, o.label);
        },
        onChoose: (messageId, card) => {
          setChosen((c) => ({ ...c, [messageId]: card.id }));
          void send({ kind: "answer", messageId, choiceId: card.id, label: card.title }, card.title);
        },
        onConfirm: (messageId, changes) => {
          const text = Object.keys(changes).length ? `Changes: ${Object.values(changes).join(", ")}` : "Looks right";
          void send({ kind: "confirm", messageId, changes }, text);
        },
        // Files come with the menu step (phase 7); until then the button explains.
        onFiles: () => setError("Sending files to Dina comes with the menu step, in the next build."),
        onSkip: () => void send({ kind: "skip" }, "Skip for now"),
        onJump: (step) => void send({ kind: "jump", step }, "Let's do that step now"),
      }}
    />
  );
}
