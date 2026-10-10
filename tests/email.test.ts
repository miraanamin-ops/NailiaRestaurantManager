// Customer email: where it goes, who it's from, the brand, and what every
// template must contain (unsubscribe and delete links, the Google link for all).
import { describe, expect, test } from "vitest";
import { brandFor, contrast, textOn, toneFor, validHex } from "@/lib/email/brand";
import { campaignContent, confirmContent, feedbackContent, googleReviewUrl, plainText, welcomeContent, type EmailContent } from "@/lib/email/content";
import { fromHeader, isDummyAddress, routeEmail, senderAddress } from "@/lib/email/route";
import { renderEmail } from "@/lib/email/templates";

const restaurant = {
  name: "Ember & Spice Grill",
  tagline: "Halal charcoal grill · Whitechapel",
  address: "12 Brick Lane, London E1",
  logo_url: "https://cdn.example/logo.png",
  brand_color: "#c2410c",
  brand_dark: "#1c1917",
  brand_voice: "Warm, friendly and family-run.",
  owner_name: "Amina Khan",
};
const brand = brandFor(restaurant);
const links = { unsubscribe: "https://site/unsubscribe/tok", deleteData: "https://site/delete/tok" };

describe("where an email goes", () => {
  const opts = { testMode: false, allowed: ["me@gmail.com"], builder: "me@gmail.com" };

  test("live: straight to the customer", () => {
    expect(routeEmail("Ayesha@Gmail.com", opts)).toEqual({ kind: "send", to: "ayesha@gmail.com", redirectedFrom: null });
  });
  test("dummy addresses and seed customers are never emailed", () => {
    expect(routeEmail("aisha.seed1@example.com", opts).kind).toBe("simulate");
    expect(routeEmail("someone@shop.test", opts).kind).toBe("simulate");
    expect(routeEmail("real@gmail.com", { ...opts, seed: true }).kind).toBe("simulate");
    expect(isDummyAddress("x@example.org")).toBe(true);
    expect(isDummyAddress("x@examplefoods.co.uk")).toBe(false);
  });
  test("TEST_MODE: the builder and owner get their own; everyone else is redirected to the builder", () => {
    const t = { ...opts, testMode: true, allowed: ["me@gmail.com", "owner@grill.co.uk"] };
    expect(routeEmail("owner@grill.co.uk", t)).toEqual({ kind: "send", to: "owner@grill.co.uk", redirectedFrom: null });
    expect(routeEmail("stranger@gmail.com", t)).toEqual({ kind: "send", to: "me@gmail.com", redirectedFrom: "stranger@gmail.com" });
    expect(routeEmail("stranger@gmail.com", { ...t, builder: null }).kind).toBe("simulate");
  });
  test("from our domain, with the restaurant's name", () => {
    expect(senderAddress({ EMAIL_FROM_DOMAIN: "mail.dinerai.co.uk" })).toBe("hello@mail.dinerai.co.uk");
    expect(senderAddress({})).toBe("onboarding@resend.dev");
    expect(fromHeader("Ember & Spice Grill", "hello@mail.dinerai.co.uk")).toBe('"Ember & Spice Grill" <hello@mail.dinerai.co.uk>');
    expect(fromHeader('Bad "Name" <x>\r\nBcc: y', "a@b.c")).toBe('"Bad Name xBcc: y" <a@b.c>');
  });
});

describe("brand", () => {
  test("colours: checked, with readable button text", () => {
    expect(validHex("#ABC")).toBe("#aabbcc");
    expect(validHex("red")).toBeNull();
    expect(textOn("#c2410c")).toBe("#ffffff");
    expect(textOn("#facc15")).toBe("#1c1917"); // yellow: dark text
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(brandFor({ ...restaurant, brand_color: "not a colour" }).color).toBe("#c2410c");
  });
  test("tone and sign-off from the brand voice", () => {
    expect(toneFor("Warm and chatty")).toBe("warm");
    expect(toneFor("Elegant, refined and understated")).toBe("polished");
    expect(toneFor("Cheeky and playful")).toBe("playful");
    expect(brand.signOff).toBe("See you soon,\nAmina and the Ember & Spice Grill team");
    expect(brandFor({ ...restaurant, owner_name: null }).signOff).toBe("See you soon,\nThe Ember & Spice Grill team");
  });
  test("only https logos (email apps block the rest)", () => {
    expect(brandFor({ ...restaurant, logo_url: "http://x/logo.png" }).logoUrl).toBeNull();
  });
});

const all: EmailContent[] = [
  confirmContent(brand, { firstName: "Sam Smith", reward: "a free Mango Lassi", confirmUrl: "https://site/confirm/c", links }),
  welcomeContent(brand, { firstName: "Sam", reward: "a free Mango Lassi", rewardUrl: "https://site/reward/r", links }),
  campaignContent(brand, { birthday: false, subject: "Quiet Thursday?", body: "Hi {first_name},\n\nGrills are 20% off.", offer: "20% off grills", validity: "Thu 15 Oct only", firstName: "Sam", offerUrl: "https://site/offer/o", links, ownerCopy: false, trackingPixel: "https://site/api/t/open/o" }),
  campaignContent(brand, { birthday: true, subject: "Happy birthday!", body: "A treat for you.", offer: "Free dessert", validity: "this week", firstName: "Sam", offerUrl: "https://site/offer/b", links, ownerCopy: false, trackingPixel: null }),
  feedbackContent(brand, { firstName: "Sam", feedbackUrl: "https://site/feedback/f", googleUrl: "https://search.google.com/local/writereview?placeid=P1", links }),
];

describe("every customer email", () => {
  test.each(all.map((c) => [c.kind, c] as const))("%s has unsubscribe and delete-my-data links, in HTML and plain text", async (_kind, c) => {
    const { html, text } = await renderEmail(c);
    for (const out of [html, text]) {
      expect(out).toContain("https://site/unsubscribe/tok");
      expect(out).toContain("https://site/delete/tok");
    }
    expect(html).toContain("Delete my data");
    expect(html).toContain("Ember &amp; Spice Grill");
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain("#c2410c"); // the brand colour
    expect(html).toMatch(/max-width:\s*560px/); // mobile-first, single column
  });

  test("campaign: the owner's approved words, personalised, with the offer and its link", async () => {
    const { html, text } = await renderEmail(all[2]);
    expect(text).toContain("Hi Sam,");
    expect(html).toContain("20% off grills");
    expect(html).toContain("https://site/offer/o");
    expect(html).toContain("https://site/api/t/open/o");
  });

  test("the owner's copy says so, with no customer links", () => {
    const own = campaignContent(brand, { birthday: false, subject: "S", body: "B", offer: "O", validity: "V", firstName: "[First name]", offerUrl: "u", links, ownerCopy: true, trackingPixel: null });
    expect(own.subject).toBe("[Your copy] S");
    expect(own.footer.unsubscribeUrl).toBeNull();
  });
});

describe("feedback email: the Google link goes to everyone", () => {
  const c = all[4];
  test("Google review button and the private form are both there, before any rating", async () => {
    expect(c.buttons.map((b) => b.label)).toEqual(["Leave a Google review", "Tell us privately"]);
    expect(c.buttons[0].url).toBe("https://search.google.com/local/writereview?placeid=P1");
    const { html, text } = await renderEmail(c);
    expect(html).toContain("https://search.google.com/local/writereview?placeid=P1");
    expect(text).toContain("Leave a Google review: https://search.google.com/local/writereview?placeid=P1");
  });
  test("the stars only open the private form; none of them leads to Google", () => {
    expect(c.stars).toEqual([1, 2, 3, 4, 5].map((n) => `https://site/feedback/f?rating=${n}`));
    expect(c.stars!.some((u) => u.includes("google"))).toBe(false);
  });
  test("review link: Google's write-a-review box, or a Maps search without a place id", () => {
    expect(googleReviewUrl({ google_place_id: "ChIJ123", name: "X", address: null })).toBe("https://search.google.com/local/writereview?placeid=ChIJ123");
    expect(googleReviewUrl({ google_place_id: null, name: "Ember & Spice", address: "Brick Lane" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Ember%20%26%20Spice%2C%20Brick%20Lane",
    );
  });
});

describe("plain text", () => {
  test("has the heading, buttons as links and the sign-off", () => {
    const t = plainText(all[1]);
    expect(t).toContain("Welcome, Sam!");
    expect(t).toContain("Show at the till: https://site/reward/r");
    expect(t).toContain("See you soon,");
  });
});

describe("logo and colour from the restaurant's website (onboarding)", () => {
  test("theme colour and the apple-touch-icon, as full addresses", async () => {
    const { brandFromHtml } = await import("@/lib/onboarding/website");
    const html = `<head><meta name="theme-color" content="#7C2D12"><link rel="icon" href="/favicon.ico">
      <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"><link rel="apple-touch-icon" href="/apple.png"></head>`;
    expect(brandFromHtml(html, "https://grill.co.uk/menu")).toEqual({ color: "#7c2d12", logo: "https://grill.co.uk/apple.png" });
  });
  test("no small favicons, SVGs or made-up colours", async () => {
    const { brandFromHtml } = await import("@/lib/onboarding/website");
    const html = `<meta name="theme-color" content="red"><link rel="icon" href="/favicon.ico"><link rel="icon" sizes="512x512" href="/logo.svg">`;
    expect(brandFromHtml(html, "https://grill.co.uk/")).toEqual({ color: null, logo: null });
  });
});
