// Links into the DinerAI app (pure: no imports, used by pages and PDFs).
// /open-app hands over to the app's Chat with the words ready to send
// (dinerai://chat?prefill=...); on a computer, or without the app, it shows the
// words to type in the app's Chat instead.

export const APP_SCHEME = "dinerai";

export function appDeepLink(text: string) {
  return text ? `${APP_SCHEME}://chat?prefill=${encodeURIComponent(text)}` : `${APP_SCHEME}://chat`;
}

// `base` is empty for links on our own pages, the app's address for PDFs and emails.
export function appChatLink(text: string, base = "") {
  return `${base}/open-app${text ? `?say=${encodeURIComponent(text)}` : ""}`;
}
