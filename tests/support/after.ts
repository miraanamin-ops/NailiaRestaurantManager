// Next's after() runs work once the response has gone. In tests it's collected
// here instead, so a test can wait for it (flushAfter) before checking results.
const pending: Promise<unknown>[] = [];

export function fakeAfter(fn: () => unknown) {
  pending.push(Promise.resolve().then(fn));
}

export async function flushAfter() {
  while (pending.length) await Promise.all(pending.splice(0));
}
