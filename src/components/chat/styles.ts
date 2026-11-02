// Shared class names for the chat, from the DinerAI brand tokens in globals.css
// (ink, mist, fog, signal, ember). Big tap targets: 48px tall at least.

export const tap = "min-h-12 rounded-full px-5 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-default";
export const primary = `${tap} bg-signal text-ink-950 hover:bg-[#d6f86a] disabled:opacity-40`;
export const secondary = `${tap} border border-ink-700 bg-ink-900 text-mist hover:border-signal/60 disabled:opacity-40`;
export const card = "rounded-2xl border border-ink-700 bg-ink-900";
