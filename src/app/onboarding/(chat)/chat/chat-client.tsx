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
  | { kind: "jump"; step: string }
  | { kind: "files"; paths: string[] };

// Each file goes straight to private storage (a one-time link from
// /api/onboarding/upload), with its progress; the chat is told once all are in.
async function uploadFiles(restaurantId: string, files: File[], onProgress: (text: string) => void) {
  const res = await fetch("/api/onboarding/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ r: restaurantId, files: files.map((f) => ({ name: f.name, size: f.size, type: f.type || "application/octet-stream" })) }),
  });
  const out = (await res.json().catch(() => null)) as { targets?: { path: string; url: string }[]; error?: string } | null;
  if (!res.ok || !out?.targets) throw new Error(out?.error ?? "Couldn't start the upload. Please try again.");
  for (const [i, file] of files.entries()) {
    const target = out.targets[i];
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", target.url);
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(`Sending ${files.length > 1 ? `file ${i + 1} of ${files.length}: ` : ""}${Math.round((e.loaded / e.total) * 100)}%`);
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("That file didn't upload. Is it a photo, a PDF, or a CSV or Excel file?")));
      xhr.onerror = () => reject(new Error("The upload stopped. Please try again."));
      xhr.send(file);
    });
  }
  return out.targets.map((t) => t.path);
}

export function ChatClient(props: {
  restaurantId: string;
  restaurantName: string;
  messages: ChatMessage[];
  chosen: Record<string, string>;
  progress: ProgressData;
  skippable: boolean;
  needsStart: boolean;
  // A step to open straight away ("Change" on the summary card).
  jumpTo?: string | null;
}) {
  const [messages, setMessages] = useState(props.messages);
  const [chosen, setChosen] = useState(props.chosen);
  const [progress, setProgress] = useState(props.progress);
  const [skippable, setSkippable] = useState(props.skippable);
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
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

  // The very first visit: Dina says hello. Or, from the summary's "Change", that step.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (props.needsStart) {
      started.current = true;
      queueMicrotask(() => void send({ kind: "start" }));
    } else if (props.jumpTo) {
      started.current = true;
      const step = props.jumpTo;
      window.history.replaceState(null, "", `/onboarding/chat?r=${props.restaurantId}`);
      // Next tick, not inside the effect itself (React's rule against cascading renders).
      queueMicrotask(() => void send({ kind: "jump", step }, "Let's change that"));
    }
  }, [props.needsStart, props.jumpTo, props.restaurantId, send]);

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
      uploadStatus={uploadStatus}
      whatsappHref={`/onboarding/in?r=${props.restaurantId}`}
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
        onFiles: async (messageId, files) => {
          if (!files.length || busy.current) return;
          setError(null);
          const show = (text: string) => setUploadStatus((u) => ({ ...u, [messageId]: text }));
          try {
            show("Starting the upload…");
            const paths = await uploadFiles(props.restaurantId, files, show);
            show(`Sent ${files.length === 1 ? "1 file" : `${files.length} files`} ✓`);
            void send({ kind: "files", paths }, `📎 ${files.length === 1 ? files[0].name : `${files.length} files`}`);
          } catch (err) {
            show("");
            setError(err instanceof Error ? err.message : "The upload stopped. Please try again.");
          }
        },
        onSkip: () => void send({ kind: "skip" }, "Skip for now"),
        onJump: (step) => void send({ kind: "jump", step }, "Let's do that step now"),
      }}
    />
  );
}
