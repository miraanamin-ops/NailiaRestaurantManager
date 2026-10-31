// @vitest-environment jsdom
// Phase 6's web cards: the Google steps (screenshots, our email to copy, the two
// buttons), the message to forward, the Connect Google button, and the review
// shown above the tone cards.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChoiceCards } from "@/components/chat/choice-cards";
import { ForwardCard, LinkCard, StepsCard } from "@/components/chat/how-to-cards";

afterEach(cleanup);

const steps = [
  { n: 1, text: "Search your restaurant's name.", image: "/onboarding/google/phone-1.png" },
  { n: 2, text: "Add our email: m@dinerai.co.uk", image: "/onboarding/google/phone-2.png", copy: "m@dinerai.co.uk" },
];
const actions = [
  { id: "invited", label: "Done, I've invited you" },
  { id: "email_steps", label: "Email me these steps" },
];

describe("StepsCard", () => {
  test("numbered steps, each with its screenshot; the email with a copy button; the line under them", () => {
    render(<StepsCard title="Adding DinerAI on Google" steps={steps} note="Manager, not Owner." video={null} actions={actions} onAction={() => {}} />);
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual(["/onboarding/google/phone-1.png", "/onboarding/google/phone-2.png"]);
    expect(screen.getByText("m@dinerai.co.uk")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("Manager, not Owner.")).toBeTruthy();
  });

  test("copies the email", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<StepsCard title="t" steps={steps} note="n" video={null} actions={actions} onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("m@dinerai.co.uk");
  });

  test("its buttons say which was tapped; answered, they can't be tapped again", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StepsCard title="t" steps={steps} note="n" video={null} actions={actions} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Email me these steps" }));
    expect(onAction).toHaveBeenCalledWith(actions[1]);
    rerender(<StepsCard title="t" steps={steps} note="n" video={null} actions={actions} onAction={onAction} disabled chosenId="invited" />);
    expect((screen.getByRole("button", { name: "Done, I've invited you" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Done, I've invited you" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("a video slot shows when there is one", () => {
    render(<StepsCard title="t" steps={steps} note="n" video="/onboarding/google/phone.mp4" actions={actions} onAction={() => {}} />);
    expect(screen.getByLabelText("Video of the steps").getAttribute("src")).toBe("/onboarding/google/phone.mp4");
  });
});

describe("ForwardCard and LinkCard", () => {
  test("the message to forward, with its own copy button", () => {
    render(<ForwardCard intro="Forward this:" text={"Hi, could you add DinerAI?\n1. Open the profile."} />);
    expect(screen.getByText(/Hi, could you add DinerAI\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the message" })).toBeTruthy();
  });

  test("Connect Google: a button to the page, with the hint above it", () => {
    render(<LinkCard label="Connect Google" href="/settings/google?r=1&back=onboarding" hint="Use the Google account you manage your profile with." />);
    expect(screen.getByRole("link", { name: "Connect Google" }).getAttribute("href")).toBe("/settings/google?r=1&back=onboarding");
    expect(screen.getByText("Use the Google account you manage your profile with.")).toBeTruthy();
  });
});

describe("ChoiceCards with a review", () => {
  const cards = [
    { id: "warm", title: "Warm and personal", body: "Sarah, thank you so much!" },
    { id: "short", title: "Short and simple", body: "Thanks Sarah!" },
  ];
  test("the review sits above the cards, with its stars; a typical one says so", () => {
    render(<ChoiceCards cards={cards} quote={{ author: "Sarah", rating: 5, text: "Best mixed grill in ages.", real: false }} onPick={() => {}} />);
    expect(screen.getByText("“Best mixed grill in ages.”")).toBeTruthy();
    expect(screen.getByLabelText("5 out of 5 stars")).toBeTruthy();
    expect(screen.getByText("A typical review, to set your tone.")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
  test("a real review doesn't say it's typical", () => {
    render(<ChoiceCards cards={cards} quote={{ author: "Priya", rating: 2, text: "Cold chips.", real: true }} onPick={() => {}} />);
    expect(screen.queryByText("A typical review, to set your tone.")).toBeNull();
    expect(screen.getByLabelText("2 out of 5 stars")).toBeTruthy();
  });
});
