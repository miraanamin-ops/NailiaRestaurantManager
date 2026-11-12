// @vitest-environment jsdom
// The staffing card and the rota check table on the web (owner's plan, 12 Nov 2026).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QuestionCard } from "@/components/chat/question-card";
import type { QuestionCardData } from "@/components/chat/types";

afterEach(cleanup);

const staffingCard: QuestionCardData = {
  q: "team.staffing",
  options: [
    { id: "ok", label: "Looks right" },
    { id: "own", label: "Change something" },
  ],
  multi: false,
  confirm: true,
  skip: true,
  layout: "buttons",
  input: { optionId: "own", placeholder: "e.g. 2 chefs" },
  staffing: {
    rows: [
      {
        role: "chef",
        label: "Chef",
        hint: "chef, cook",
        min: 2,
        per: 15,
        orders: "orders",
        suggested: { min: 2, per: 15 },
        learned: { min: 1, per: 18, estimate: false },
        edges: "Starts 30 minutes before opening",
      },
      {
        role: "manager",
        label: "Manager",
        hint: "",
        min: 1,
        per: null,
        orders: "",
        suggested: { min: 1, per: null },
        learned: null,
        edges: null,
      },
    ],
    notes: [],
    source: "mixed",
  },
};

describe("the staffing card", () => {
  test("− and + change the numbers; Save sends them; what each is based on is shown", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard data={staffingCard} onAnswer={onAnswer} />);
    expect(screen.getByText(/Your rotas: 1, \+1 per 18 · For your size: 2, \+1 per 15/)).toBeTruthy();
    // The typed choice is for WhatsApp; here the steppers do it.
    expect(screen.queryByRole("radio", { name: "Change something" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More: Chef at least" }));
    fireEvent.click(screen.getByRole("button", { name: "Fewer: Chef 1 more per" }));
    fireEvent.click(screen.getByRole("button", { name: "Fewer: Manager at least" }));
    // The manager has no busy rule, so no second stepper.
    expect(screen.queryByRole("button", { name: "More: Manager 1 more per" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save these numbers" }));
    expect(onAnswer).toHaveBeenCalledWith({
      choiceIds: ["ok"],
      staffing: { chef: { min: 3, per: 12 }, manager: { min: 0, per: null } },
      label: "Save these numbers",
    });
  });

  test("the rotas read: a table to check, with That's right and room to say what's wrong", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        data={{
          q: "team.rotas_check",
          options: [
            { id: "ok", label: "That's right" },
            { id: "own", label: "Something's wrong" },
          ],
          multi: false,
          confirm: true,
          skip: true,
          layout: "buttons",
          input: { optionId: "own", placeholder: "e.g. Sara is a server" },
          table: { columns: ["Name", "Role"], rows: [["Ali", "Chef"]] },
        }}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Ali" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Something's wrong" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Sara is a server"), {
      target: { value: "Ali is a KP" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onAnswer).toHaveBeenCalledWith({
      choiceIds: ["own"],
      text: "Ali is a KP",
      label: "Ali is a KP",
    });
  });
});
