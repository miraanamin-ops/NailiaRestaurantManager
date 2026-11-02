// @vitest-environment jsdom
// The confirmation card ("Is this right?") and the summary card at the end.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ConfirmationCard } from "@/components/chat/confirmation-card";
import { SummaryCard } from "@/components/chat/summary-card";
import type { ConfirmationData, SummaryData } from "@/components/chat/types";

afterEach(cleanup);

const basics: ConfirmationData = {
  title: "Your basics",
  fields: [
    { key: "name", label: "Restaurant", value: "Ember & Spice Grill" },
    { key: "cuisine", label: "Cuisine", value: null },
  ],
};

describe("ConfirmationCard", () => {
  test("shows each value, and says so when one is missing", () => {
    render(<ConfirmationCard card={basics} onConfirm={() => {}} />);
    expect(screen.getByText("Your basics")).toBeTruthy();
    expect(screen.getByText("Ember & Spice Grill")).toBeTruthy();
    expect(screen.getByText("Not given yet")).toBeTruthy();
  });

  test("'Looks right' confirms with no changes", () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard card={basics} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  test("'Change something' opens boxes; saving sends only what changed", () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard card={basics} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Change something" }));
    fireEvent.change(screen.getByLabelText("Cuisine"), { target: { value: "  Halal grill " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onConfirm).toHaveBeenCalledWith({ cuisine: "Halal grill" });
    // Back to the rows afterwards.
    expect(screen.getByRole("button", { name: "Looks right" })).toBeTruthy();
  });

  test("Cancel leaves everything as it was and sends nothing", () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard card={basics} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Change something" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Not given yet")).toBeTruthy();
  });

  test("once answered, its buttons can't be pressed", () => {
    render(<ConfirmationCard card={basics} onConfirm={() => {}} disabled />);
    expect((screen.getByRole("button", { name: "Looks right" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Change something" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const summary: SummaryData = {
  done: 4,
  total: 6,
  items: [
    { key: "hello", title: "The basics", status: "done", detail: "Ember & Spice Grill, halal grill", editHref: "/settings#basics" },
    { key: "hours_faqs", title: "Hours and FAQs", status: "partial", detail: "Hours confirmed; FAQs not yet" },
  ],
  locked: [{ key: "google", title: "Google profile", unlock: "Connect Google and I'll reply to your reviews." }],
  next: ["Your first morning brief arrives tomorrow at 9am on WhatsApp."],
};

describe("SummaryCard", () => {
  test("shows how much is done, each item with its change link, what's locked and what's next", () => {
    render(<SummaryCard summary={summary} />);
    expect(screen.getByText("4 of 6 done")).toBeTruthy();
    const basicsRow = screen.getByText("The basics").closest("li")!;
    expect(within(basicsRow).getByRole("link", { name: "Change" }).getAttribute("href")).toBe("/settings#basics");
    expect(within(screen.getByText("Hours and FAQs").closest("li")!).queryByRole("link")).toBeNull();
    expect(screen.getByText(/Connect Google and I'll reply to your reviews/)).toBeTruthy();
    expect(screen.getByText(/first morning brief arrives tomorrow/)).toBeTruthy();
  });

  test("with nothing locked or planned, those sections aren't shown", () => {
    render(<SummaryCard summary={{ ...summary, locked: [], next: [] }} />);
    expect(screen.queryByText("Still to unlock")).toBeNull();
    expect(screen.queryByText("What happens next")).toBeNull();
  });
});
