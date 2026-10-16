// Runs before every test file. Starting a queue worker is an HTTP call to our own
// app (lib/queue/kick.ts); in tests there's no app to call, so it's answered here
// without touching the network. Tests run workers themselves (runWorker).
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/jobs/work")) return new Response(JSON.stringify({ started: true }), { status: 200 });
  return realFetch(input, init);
}) as typeof fetch;
