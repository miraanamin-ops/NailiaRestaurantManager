// One message. Dina's on the left with her initial; the owner's on the right in
// the signal colour. A component (buttons, cards, upload) sits under Dina's words.
export function DinaAvatar({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-signal font-semibold text-ink-950">
      D
    </span>
  );
}

export function MessageBubble({ role, text, children, showAvatar = true }: { role: "dina" | "owner"; text: string; children?: React.ReactNode; showAvatar?: boolean }) {
  if (role === "owner") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-line break-words rounded-2xl rounded-br-md bg-signal px-4 py-3 text-[15px] leading-relaxed text-ink-950">{text}</p>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2">
      {showAvatar ? <DinaAvatar /> : <span aria-hidden className="w-8 shrink-0" />}
      <div className="min-w-0 max-w-[85%] flex-1 space-y-3 sm:flex-none">
        <p className="w-fit max-w-full whitespace-pre-line break-words rounded-2xl rounded-bl-md border border-ink-700 bg-ink-850 px-4 py-3 text-[15px] leading-relaxed text-mist">
          <span className="sr-only">Dina: </span>
          {text}
        </p>
        {children}
      </div>
    </div>
  );
}
