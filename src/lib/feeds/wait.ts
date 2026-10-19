// A pause between calls to a rate-limited provider (football-data.org, Ticketmaster).
// Its own module so tests can skip the wait.
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
