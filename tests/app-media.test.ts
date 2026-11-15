// What a picture or file becomes in the app's chat (15 Nov): a photo shows as itself, a
// PDF is its caption and a tappable link (never "[image]"), the old email picture is dropped.
import { describe, expect, test } from "vitest";
import { appMedia } from "@/lib/notify";

describe("appMedia", () => {
  test("a photo shows; a PDF becomes a link with its caption; an email picture is dropped", () => {
    expect(appMedia("", "https://x.supabase.co/storage/v1/object/public/post-photos/a.jpg", "c")).toEqual({ text: "", image: "https://x.supabase.co/storage/v1/object/public/post-photos/a.jpg" });
    expect(appMedia("", "https://app.dinerai.co.uk/rota/tok/pdf", "📄 The rota as a PDF, ready to forward")).toEqual({ text: "📄 The rota as a PDF, ready to forward\nhttps://app.dinerai.co.uk/rota/tok/pdf", image: null });
    expect(appMedia("Your email", "https://app.dinerai.co.uk/api/email-preview/draft-1?s=x", "c")).toEqual({ text: "Your email", image: null });
    expect(appMedia("Hi", null, "c")).toEqual({ text: "Hi", image: null });
  });
});
