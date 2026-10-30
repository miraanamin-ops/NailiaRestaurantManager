// @vitest-environment jsdom
// The chat as a whole, and its smaller pieces: messages (Dina's and the owner's),
// the typing indicator, the typing box, which component goes under which
// message, and "Skip for now" only on skippable steps.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChatLayout, type ChatHandlers } from "@/components/chat/chat-layout";
import { Composer } from "@/components/chat/composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import type { ChatMessage, ProgressData } from "@/components/chat/types";

afterEach(cleanup);

const handlers = (): ChatHandlers => ({ onSend: vi.fn(), onPick: vi.fn(), onChoose: vi.fn(), onFiles: vi.fn(), onConfirm: vi.fn(), onSkip: vi.fn(), onJump: vi.fn() });
const progress: ProgressData = { position: 2, total: 6, steps: [{ key: "hello", title: "Hello", status: "done" }, { key: "google", title: "Google profile", status: "in_progress" }] };

describe("MessageBubble, TypingIndicator and Composer", () => {
  test("Dina's messages are labelled as hers; the owner's aren't", () => {
    render(
      <>
        <MessageBubble role="dina" text="Hello, I'm Dina." />
        <MessageBubble role="owner" text="Hi!" />
      </>,
    );
    expect(screen.getByText("Hello, I'm Dina.").textContent).toBe("Dina: Hello, I'm Dina.");
    expect(screen.getByText("Hi!").textContent).toBe("Hi!");
  });

  test("the typing indicator is announced", () => {
    render(<TypingIndicator />);
    expect(screen.getByRole("status").textContent).toMatch(/Dina is typing/);
  });

  test("Enter sends the trimmed message and clears the box; Shift+Enter and empty messages don't send", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("Message Dina") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "  we're a halal grill  " } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("we're a halal grill");
    expect(box.value).toBe("");
  });

  test("the send button waits while Dina answers; the box is 16px so phones don't zoom", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled />);
    const box = screen.getByLabelText("Message Dina");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(box.className).toMatch(/text-\[16px\]/);
  });
});

describe("ChatLayout", () => {
  const messages: ChatMessage[] = [
    { id: "m1", role: "dina", text: "Hi, I'm Dina, your DinerAI manager." },
    { id: "m2", role: "dina", text: "Do you have a Google profile?", component: { type: "quick_replies", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] } },
    { id: "m3", role: "owner", text: "Yes" },
  ];

  test("shows the conversation in order, with Dina's name and the progress (no 'AI' label: owner's call, 30 Oct)", () => {
    render(<ChatLayout restaurantName="Ember & Spice Grill" progress={progress} messages={messages} typing={false} skippable={false} handlers={handlers()} />);
    expect(screen.getByText("Your DinerAI manager · setting up Ember & Spice Grill")).toBeTruthy();
    const items = screen.getByRole("list", { name: "Conversation with Dina" }).querySelectorAll(":scope > li");
    expect([...items].map((li) => li.textContent)).toEqual([expect.stringMatching(/your DinerAI manager/), expect.stringMatching(/Google profile\?YesNo/), "Yes"]);
    expect(screen.getAllByText("Setup 2 of 6").length).toBeGreaterThan(0);
  });

  test("the header has 'Continue on WhatsApp' when there's somewhere to go, and not otherwise", () => {
    const { unmount } = render(
      <ChatLayout restaurantName="R" progress={progress} messages={messages} typing={false} skippable={false} whatsappHref="/onboarding/in?r=abc" handlers={handlers()} />,
    );
    expect(screen.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toBe("/onboarding/in?r=abc");
    unmount();
    render(<ChatLayout restaurantName="R" progress={progress} messages={messages} typing={false} skippable={false} handlers={handlers()} />);
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
  });

  test("a tap on a quick reply says which message it answered", () => {
    const h = handlers();
    render(<ChatLayout restaurantName="R" progress={progress} messages={messages} typing={false} skippable={false} handlers={h} />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(h.onPick).toHaveBeenCalledWith("m2", { id: "no", label: "No" });
  });

  test("'Skip for now' only on a skippable step; while Dina types, skipping and sending wait", () => {
    const h = handlers();
    const { rerender } = render(<ChatLayout restaurantName="R" progress={progress} messages={messages} typing={false} skippable={false} handlers={h} />);
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    rerender(<ChatLayout restaurantName="R" progress={progress} messages={messages} typing skippable handlers={h} />);
    expect(screen.getByRole("status").textContent).toMatch(/Dina is typing/);
    expect((screen.getByRole("button", { name: "Skip for now" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("each component goes under its own message: cards, upload, confirmation and summary", () => {
    const all: ChatMessage[] = [
      { id: "a", role: "dina", text: "Pick a tone.", component: { type: "choice_cards", cards: [{ id: "warm", title: "Warm", body: "x" }, { id: "short", title: "Short", body: "y" }] } },
      { id: "b", role: "dina", text: "Your menu.", component: { type: "upload", accept: "photo", multiple: true, label: "Add menu photos" } },
      { id: "c", role: "dina", text: "Check these.", component: { type: "confirmation", card: { title: "Your basics", fields: [{ key: "name", label: "Restaurant", value: "R" }] } } },
      { id: "d", role: "dina", text: "Done.", component: { type: "summary", summary: { done: 1, total: 6, items: [], locked: [], next: [] } } },
    ];
    const h = handlers();
    render(<ChatLayout restaurantName="R" progress={progress} messages={all} typing={false} skippable={false} handlers={h} />);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(h.onChoose).toHaveBeenCalledWith("a", { id: "short", title: "Short", body: "y" });
    expect(screen.getByLabelText("Add menu photos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(h.onConfirm).toHaveBeenCalledWith("c", {});
    expect(screen.getByText("1 of 6 done")).toBeTruthy();
  });
});
