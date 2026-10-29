// @vitest-environment jsdom
// The progress bar: "Setup 2 of 6", the step list on a tap, and skipped or
// half-done steps that can be picked to do now.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProgressBar } from "@/components/chat/progress-bar";
import type { ProgressData } from "@/components/chat/types";

afterEach(cleanup);

const progress: ProgressData = {
  position: 3,
  total: 6,
  steps: [
    { key: "hello", title: "Hello", status: "done" },
    { key: "google", title: "Google profile", status: "skipped" },
    { key: "tone", title: "Your tone", status: "in_progress" },
    { key: "make_it_right", title: "Making it right", status: "not_started" },
    { key: "menu", title: "Your menu", status: "partial" },
    { key: "hours_faqs", title: "Hours and FAQs", status: "waiting" },
  ],
};

describe("ProgressBar", () => {
  test("shows where the owner is, and how many steps are done", () => {
    render(<ProgressBar progress={progress} />);
    expect(screen.getByText("Setup 3 of 6")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("6");
  });

  test("on a phone the steps open on a tap and close again", () => {
    render(<ProgressBar progress={progress} />);
    const toggle = screen.getByRole("button", { name: /Setup 3 of 6/ });
    expect(screen.queryByText("Your menu")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Your menu")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText("Your menu")).toBeNull();
  });

  test("only skipped and half-done steps can be picked; picking one jumps there and closes the list", () => {
    const onJump = vi.fn();
    render(<ProgressBar progress={progress} onJump={onJump} defaultOpen />);
    const doNow = screen.getAllByRole("button", { name: /Do it now/ });
    expect(doNow.map((b) => b.textContent)).toEqual([expect.stringMatching(/Google profile/), expect.stringMatching(/Your menu/)]);
    fireEvent.click(doNow[0]);
    expect(onJump).toHaveBeenCalledWith("google");
    expect(screen.queryByText("Your menu")).toBeNull();
    // Done, current, waiting and to-do steps aren't buttons.
    expect(screen.queryByRole("button", { name: /Hello/ })).toBeNull();
  });

  test("on a laptop the list is always open in the sidebar, with the current step marked", () => {
    render(<ProgressBar progress={progress} variant="sidebar" />);
    expect(screen.getByRole("navigation", { name: "Setup steps" })).toBeTruthy();
    expect(screen.getByText("Your tone").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
  });
});
