// Which server errors reach the builder, and how (security review O1). Pure,
// unit-tested in tests/server-errors.test.ts; src/instrumentation.ts calls it from
// Next.js's onRequestError hook, then sends it with alertBuilder (the same problem
// alerts at most once every 6 hours).
//
// Never the request's address or its query (they can carry report, export and
// reward tokens): only the route's file path, e.g. /report/[token].

export type ServerErrorAlert = { key: string; message: string };

// Next.js uses thrown values for notFound() and redirect(): not errors.
const CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|HANGING_PROMISE_REJECTION)/;

export function serverErrorAlert(err: unknown, context: { routePath?: string; routeType?: string }): ServerErrorAlert | null {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  const message = err instanceof Error ? err.message : String(err);
  if (CONTROL_FLOW.test(digest) || CONTROL_FLOW.test(message)) return null;
  const route = context.routePath || "unknown route";
  const firstLine = message.split("\n")[0].slice(0, 300);
  return {
    key: `server-error:${route}:${hash(firstLine)}`,
    message: `Server error on ${route} (${context.routeType ?? "request"}): ${firstLine}${digest ? `\nDigest: ${digest}` : ""}\nFull details are in Vercel's logs for this time.`,
  };
}

// A short, stable fingerprint of the message so the same error alerts once, not every time.
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
