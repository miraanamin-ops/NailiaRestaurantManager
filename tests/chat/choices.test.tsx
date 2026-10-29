// @vitest-environment jsdom
// Quick replies, choice cards and the "Skip for now" button: one tap answers,
// an answered question keeps its choice highlighted and can't be pressed again.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChoiceCards } from "@/components/chat/choice-cards";
import { QuickReplies } from "@/components/chat/quick-replies";
import { SkipButton } from "@/components/chat/skip-button";

afterEach(cleanup);
const options = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "Not sure" },
];

describe("QuickReplies", () => {
  test("a tap sends that option", () => {
    const onPick = vi.fn();
    render(<QuickReplies options={options} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    expect(onPick).toHaveBeenCalledWith({ id: "unsure", label: "Not sure" });
  });

  test("once answered: the choice is highlighted and nothing can be pressed", () => {
    const onPick = vi.fn();
    render(<QuickReplies options={options} onPick={onPick} disabled chosenId="yes" />);
    expect(screen.getByRole("button", { name: "Yes" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "No" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onPick).not.toHaveBeenCalled();
  });

  test("every button is a big tap target", () => {
    render(<QuickReplies options={options} onPick={() => {}} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/\bmin-h-12\b/);
  });
});

describe("ChoiceCards", () => {
  const cards = [
    { id: "warm", title: "Warm and personal", body: "Sarah, thank you so much!" },
    { id: "short", title: "Short and simple", body: "Thanks Sarah!" },
  ];

  test("each card shows its title and example, as a radio; a tap picks it", () => {
    const onPick = vi.fn();
    render(<ChoiceCards cards={cards} onPick={onPick} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].textContent).toMatch(/Warm and personal.*Sarah, thank you so much!/);
    fireEvent.click(radios[1]);
    expect(onPick).toHaveBeenCalledWith(cards[1]);
  });

  test("the chosen card is checked; once answered the others can't be picked", () => {
    const onPick = vi.fn();
    render(<ChoiceCards cards={cards} onPick={onPick} chosenId="warm" disabled />);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("SkipButton", () => {
  test("says 'Skip for now' and skips; not while Dina is answering", () => {
    const onSkip = vi.fn();
    const { rerender } = render(<SkipButton onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    rerender(<SkipButton onSkip={onSkip} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
