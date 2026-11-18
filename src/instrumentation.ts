import type { Instrumentation } from "next";

// Server errors on the live site reach the builder (security review O1): every page,
// API route and form action that crashes is sent to alertBuilder (email and WhatsApp,
// the same problem at most once every 6 hours), so problems show up before an owner
// reports them. Which errors and what's sent: lib/server-error-rules.ts.
// Only on production (previews and local would be noise), only in the Node.js runtime.
export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL_ENV !== "production") return;
  try {
    const { serverErrorAlert } = await import("@/lib/server-error-rules");
    const alert = serverErrorAlert(err, context);
    if (!alert) return;
    const { alertBuilder } = await import("@/lib/builder-alerts");
    await alertBuilder(alert.key, alert.message);
  } catch (reportErr) {
    console.error("Couldn't report a server error to the builder", reportErr);
  }
};
