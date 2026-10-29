"use client";
import { useEffect, useRef } from "react";
import { ChoiceCards } from "./choice-cards";
import { Composer } from "./composer";
import { ConfirmationCard } from "./confirmation-card";
import { DinaAvatar, MessageBubble } from "./message-bubble";
import { ProgressBar } from "./progress-bar";
import { QuickReplies } from "./quick-replies";
import { SkipButton } from "./skip-button";
import { SummaryCard } from "./summary-card";
import { TypingIndicator } from "./typing-indicator";
import type { ChatMessage, ChatOption, ChoiceCard, ProgressData } from "./types";
import { UploadCard } from "./upload-card";

// The web chat with Dina, drawn from props only (the page that talks to the
// server owns the state). Phone first: one column, the header and progress at the
// top, the typing box and "Skip for now" pinned at the bottom. From laptop width,
// the steps sit open in a sidebar.

export type ChatHandlers = {
  onSend: (text: string) => void;
  onPick: (messageId: string, option: ChatOption) => void;
  onChoose: (messageId: string, card: ChoiceCard) => void;
  onFiles: (messageId: string, files: File[]) => void;
  onConfirm: (messageId: string, changes: Record<string, string>) => void;
  onSkip: () => void;
  onJump: (stepKey: string) => void;
};

export function ChatLayout({
  restaurantName,
  progress,
  messages,
  typing,
  skippable,
  chosen = {},
  uploadStatus = {},
  stepsOpen = false,
  handlers,
}: {
  restaurantName: string;
  progress: ProgressData;
  messages: ChatMessage[];
  typing: boolean;
  skippable: boolean;
  // What the owner picked under each message (by message id), to keep it highlighted.
  chosen?: Record<string, string>;
  uploadStatus?: Record<string, string>;
  // The phone step list starts open (previews).
  stepsOpen?: boolean;
  handlers: ChatHandlers;
}) {
  // The newest message in view: straight there when the chat opens, smoothly as new ones arrive.
  const end = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    end.current?.scrollIntoView?.({ behavior: opened.current ? "smooth" : "auto", block: "end" });
    opened.current = true;
  }, [messages.length, typing]);

  return (
    <div className="dai-app flex min-h-dvh flex-col bg-ink-950 text-mist">
      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 pt-3 lg:pb-3">
          <DinaAvatar size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold leading-tight text-mist">Dina</p>
            <p className="truncate text-[13px] text-fog">Your DinerAI manager · AI · setting up {restaurantName}</p>
          </div>
        </div>
        <div className="mx-auto w-full max-w-5xl px-4 pb-2 lg:hidden">
          <ProgressBar progress={progress} onJump={handlers.onJump} defaultOpen={stepsOpen} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4">
        <aside className="hidden w-64 shrink-0 pt-6 lg:block">
          <div className="sticky top-24">
            <ProgressBar progress={progress} onJump={handlers.onJump} variant="sidebar" />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <ol aria-label="Conversation with Dina" className="flex-1 space-y-4 py-6">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              return (
                <li key={m.id}>
                  <MessageBubble role={m.role} text={m.text} showAvatar={!(prev && prev.role === "dina" && m.role === "dina")}>
                    {m.role === "dina" && m.component ? <Component message={m} chosen={chosen[m.id]} uploadStatus={uploadStatus[m.id]} handlers={handlers} /> : null}
                  </MessageBubble>
                </li>
              );
            })}
            {typing && (
              <li>
                <TypingIndicator />
              </li>
            )}
          </ol>
          <div ref={end} />
          <div className="sticky bottom-0 -mx-4 border-t border-ink-800 bg-ink-950/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 backdrop-blur-md">
            {skippable && (
              <div className="flex justify-center">
                <SkipButton onSkip={handlers.onSkip} disabled={typing} />
              </div>
            )}
            <Composer onSend={handlers.onSend} disabled={typing} />
          </div>
        </main>
      </div>
    </div>
  );
}

function Component({ message, chosen, uploadStatus, handlers }: { message: ChatMessage; chosen?: string; uploadStatus?: string; handlers: ChatHandlers }) {
  const c = message.component!;
  const done = Boolean(message.answered);
  switch (c.type) {
    case "quick_replies":
      return <QuickReplies options={c.options} disabled={done} chosenId={chosen} onPick={(o) => handlers.onPick(message.id, o)} />;
    case "choice_cards":
      return <ChoiceCards cards={c.cards} disabled={done} chosenId={chosen} onPick={(card) => handlers.onChoose(message.id, card)} />;
    case "upload":
      return <UploadCard accept={c.accept} multiple={c.multiple} label={c.label} disabled={done} status={uploadStatus} onFiles={(f) => handlers.onFiles(message.id, f)} />;
    case "confirmation":
      return <ConfirmationCard card={c.card} disabled={done} onConfirm={(ch) => handlers.onConfirm(message.id, ch)} />;
    case "summary":
      return <SummaryCard summary={c.summary} />;
  }
}
