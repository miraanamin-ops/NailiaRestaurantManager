// @vitest-environment jsdom
// The chat page's client part, talking to a stand-in endpoint: the owner's words
// show at once, the typing dots and what Dina is doing while she works, then her
// messages; a failure shows a message and the owner can carry on.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ChatClient } from "@/app/onboarding/(chat)/chat/chat-client";

const progress = { position: 1, total: 6, steps: [{ key: "hello", title: "Hello", status: "in_progress" as const }] };
const base = { restaurantId: "aaaaaaaa-0000-4000-8000-0000000000a1", restaurantName: "Ember & Spice Grill", chosen: {}, progress, skippable: false };

// A response whose events arrive one at a time, released by the test.
function streamed() {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  return {
    response: new Response(body, { status: 200 }),
    push: (e: object) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)),
    end: () => controller.close(),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  if (!globalThis.crypto?.randomUUID) vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatClient", () => {
  test("first visit: Dina says hello on her own", async () => {
    const s = streamed();
    fetchMock.mockResolvedValue(s.response);
    render(<ChatClient {...base} messages={[]} needsStart />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toEqual({ kind: "start" });
    await act(async () => {
      s.push({ type: "typing" });
      s.push({ type: "message", message: { id: "d1", role: "dina", text: "Hi Amina, I'm Dina." } });
      s.push({ type: "done" });
      s.end();
    });
    await waitFor(() => expect(screen.getByText("Hi Amina, I'm Dina.", { exact: false })).toBeTruthy());
  });

  test("a message: shown at once, then typing with what she's doing, then her reply; the box waits meanwhile", async () => {
    const s = streamed();
    fetchMock.mockResolvedValue(s.response);
    render(<ChatClient {...base} messages={[{ id: "d0", role: "dina", text: "What cuisine do you serve?" }]} needsStart={false} />);
    const box = screen.getByLabelText("Message Dina");
    fireEvent.change(box, { target: { value: "Halal grill" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByText("Halal grill")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => s.push({ type: "status", text: "Saving your basics…" }));
    await waitFor(() => expect(screen.getByText("Saving your basics…")).toBeTruthy());
    await act(async () => {
      s.push({ type: "message", message: { id: "d1", role: "dina", text: "Lovely, saved." } });
      s.push({ type: "state", progress: { ...progress, position: 2 }, skippable: true });
      s.push({ type: "done" });
      s.end();
    });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("Lovely, saved.", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.action).toMatchObject({ kind: "message", text: "Halal grill", clientId: expect.any(String) });
  });

  test("tapping a quick reply sends it as an answer to that message, and keeps it highlighted", async () => {
    const s = streamed();
    fetchMock.mockResolvedValue(s.response);
    render(<ChatClient {...base} messages={[{ id: "d1", role: "dina", text: "Owner or manager?", component: { type: "quick_replies", options: [{ id: "owner", label: "Owner" }, { id: "manager", label: "Manager" }] } }]} needsStart={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Manager" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toMatchObject({ kind: "answer", messageId: "d1", choiceId: "manager", label: "Manager" });
    expect(screen.getByRole("button", { name: "Manager" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Owner" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (s.push({ type: "done" }), s.end()));
  });

  test("when Dina can't be reached, the owner sees why and can carry on", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "That's a lot of messages in a short time. Give it a few minutes." }), { status: 429 }));
    render(<ChatClient {...base} messages={[]} needsStart={false} />);
    const box = screen.getByLabelText("Message Dina");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/a lot of messages/));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(box, { target: { value: "again" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
