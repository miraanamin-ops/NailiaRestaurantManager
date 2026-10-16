// The reply when handling someone's WhatsApp message fails. It's sent once:
// by the handler that failed (which then throws OwnerToldError so the queue
// knows), or, if the job died some other way (a crash, a timeout), by the
// queue when the job dies (lib/queue/handlers.ts). The builder is alerted
// either way; the owner never hears more than this.
export const SORRY = "Sorry, something went wrong on my side. Please try again in a minute. 🙏";

// The person has already had the "Sorry" reply; the error is still a failure.
export class OwnerToldError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "OwnerToldError";
  }
}
