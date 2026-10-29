// @vitest-environment jsdom
// The upload card: the right file types per request, one or several files, and
// the names of what was chosen.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ACCEPT, UploadCard } from "@/components/chat/upload-card";

afterEach(cleanup);
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("UploadCard", () => {
  test("asks for the right kind of file", () => {
    expect(ACCEPT.photo).toBe("image/*");
    expect(ACCEPT.document).toMatch(/application\/pdf/);
    expect(ACCEPT.spreadsheet).toMatch(/\.csv.*\.xlsx/);
    render(<UploadCard accept="spreadsheet" multiple={false} label="Upload your sales file" onFiles={() => {}} />);
    expect(input("Upload your sales file").accept).toBe(ACCEPT.spreadsheet);
    expect(input("Upload your sales file").multiple).toBe(false);
    expect(screen.getByText(/A CSV or Excel file/)).toBeTruthy();
  });

  test("the big button opens the file picker; chosen files are sent and named", () => {
    const onFiles = vi.fn();
    render(<UploadCard accept="photo" multiple label="Add menu photos" onFiles={onFiles} />);
    const picker = input("Add menu photos");
    const click = vi.spyOn(picker, "click");
    fireEvent.click(screen.getByRole("button", { name: /Add menu photos/ }));
    expect(click).toHaveBeenCalled();
    const files = [new File(["a"], "page1.jpg", { type: "image/jpeg" }), new File(["b"], "page2.jpg", { type: "image/jpeg" })];
    fireEvent.change(picker, { target: { files } });
    expect(onFiles).toHaveBeenCalledWith(files);
    expect(screen.getByText("page1.jpg, page2.jpg")).toBeTruthy();
  });

  test("shows progress when given, and can't be used once answered", () => {
    render(<UploadCard accept="document" multiple label="Add your menu" onFiles={() => {}} status="Uploading 2 of 3…" disabled />);
    expect(screen.getByText("Uploading 2 of 3…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Add your menu/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(input("Add your menu").disabled).toBe(true);
  });
});
