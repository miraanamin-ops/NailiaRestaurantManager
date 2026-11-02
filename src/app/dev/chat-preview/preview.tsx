"use client";
import { useEffect, useState } from "react";
import { ChatLayout } from "@/components/chat/chat-layout";
import type { ChatMessage, ProgressData, StepStatus } from "@/components/chat/types";

// Sample conversations for signing off the chat's look (local copies only: page.tsx).
// Tapping things works, so the states can be tried by hand; nothing is sent anywhere.

const STEPS = [
  ["hello", "Hello"],
  ["google", "Google profile"],
  ["tone", "Your tone"],
  ["make_it_right", "Making it right"],
  ["menu", "Your menu"],
  ["hours_faqs", "Hours and FAQs"],
] as const;

const progress = (statuses: StepStatus[]): ProgressData => ({
  steps: STEPS.map(([key, title], i) => ({ key, title, status: statuses[i] })),
  position: Math.max(1, statuses.findIndex((s) => s === "in_progress") + 1 || statuses.length),
  total: STEPS.length,
});

const basics = {
  type: "confirmation" as const,
  card: {
    title: "Your basics",
    fields: [
      { key: "owner_name", label: "Your name", value: "Amina Khan" },
      { key: "name", label: "Restaurant", value: "Ember & Spice Grill" },
      { key: "address", label: "Address", value: "12 High Street, London E1 6AN" },
      { key: "cuisine", label: "Cuisine", value: null },
      { key: "role", label: "Your role", value: "Owner" },
    ],
  },
};

export const SCENES: Record<string, { progress: ProgressData; messages: ChatMessage[]; typing: boolean; skippable: boolean; chosen?: Record<string, string>; stepsOpen?: boolean }> = {
  hello: {
    progress: progress(["in_progress", "not_started", "not_started", "not_started", "not_started", "not_started"]),
    typing: false,
    skippable: false,
    messages: [
      { id: "1", role: "dina", text: "Hi Amina, I'm Dina, your DinerAI manager. I'm an AI, and I'll get Ember & Spice Grill set up with you in about 20 minutes." },
      { id: "2", role: "dina", text: "First, let's check I've got the basics right. I couldn't find your cuisine, so that's blank for now.", component: basics },
    ],
  },
  google: {
    progress: progress(["done", "in_progress", "not_started", "not_started", "not_started", "not_started"]),
    typing: true,
    skippable: true,
    chosen: { "3": "yes" },
    messages: [
      { id: "1", role: "dina", text: "Lovely, that's your basics saved." },
      {
        id: "2",
        role: "dina",
        text: "Next, Google. Connect it and I'll reply to your reviews, post updates and track calls and directions for you.",
      },
      { id: "3", role: "dina", text: "Do you have a Google profile for the restaurant?", component: { type: "quick_replies", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "unsure", label: "Not sure" }] }, answered: true },
      { id: "4", role: "owner", text: "Yes" },
    ],
  },
  tone: {
    progress: progress(["done", "skipped", "in_progress", "not_started", "not_started", "not_started"]),
    typing: false,
    skippable: true,
    messages: [
      { id: "1", role: "dina", text: "No problem, we can do Google later. Now your tone: pick one and every reply and post will sound like you." },
      {
        id: "2",
        role: "dina",
        text: "Here's a typical 5-star review: \"Came for my sister's birthday and honestly the mixed grill was the best I've had in ages. The staff were lovely with the kids and even brought out a candle for the cake.\" Which reply sounds most like you?",
        component: {
          type: "choice_cards",
          cards: [
            { id: "warm", title: "Warm and personal", body: "Sarah, thank you so much! We're so glad your sister's birthday was a special one, and that the kids had a great time too. Can't wait to welcome you all back soon." },
            { id: "polished", title: "Polished and professional", body: "Dear Sarah, thank you for celebrating your sister's birthday with us. We're delighted you enjoyed the mixed grill and our team's service." },
            { id: "fun", title: "Fun and chatty", body: "Best mixed grill in ages? We'll take that! 🎉 Thanks Sarah, it was a joy having you all in for the birthday." },
            { id: "short", title: "Short and simple", body: "Thanks Sarah! So glad you all enjoyed it. See you again soon." },
          ],
        },
      },
    ],
  },
  menu: {
    progress: progress(["done", "skipped", "done", "done", "in_progress", "not_started"]),
    typing: false,
    skippable: true,
    stepsOpen: true,
    messages: [
      { id: "1", role: "dina", text: "Your menu next. Share it and I'll write captions, suggest offers and answer allergen questions using your real dishes." },
      { id: "2", role: "dina", text: "Send me photos of each page, or a PDF if you have one.", component: { type: "upload", accept: "document", multiple: true, label: "Add menu photos or a PDF" } },
    ],
  },
  summary: {
    progress: progress(["done", "skipped", "done", "done", "done", "partial"]),
    typing: false,
    skippable: false,
    messages: [
      { id: "1", role: "dina", text: "That's setup done for now, Amina. Here's everything I have." },
      {
        id: "2",
        role: "dina",
        text: "You can change any of it here, or just tell me.",
        component: {
          type: "summary",
          summary: {
            done: 4,
            total: 6,
            items: [
              { key: "hello", title: "The basics", status: "done", detail: "Ember & Spice Grill, halal grill, 12 High Street, London E1 6AN", editHref: "#" },
              { key: "tone", title: "Your tone", status: "done", detail: "Warm and personal for praise, polished for complaints", editHref: "#" },
              { key: "make_it_right", title: "Making it right", status: "done", detail: "Free dessert on the next visit; complaints go to Amina", editHref: "#" },
              { key: "menu", title: "Your menu", status: "done", detail: "34 dishes in 6 sections; allergens confirmed for 12", editHref: "#" },
              { key: "hours_faqs", title: "Hours and FAQs", status: "partial", detail: "Hours confirmed; FAQs not yet", editHref: "#" },
            ],
            locked: [{ key: "google", title: "Google profile", unlock: "Connect Google and I'll reply to your reviews, post updates and track calls and directions for you." }],
            next: ["Your first morning brief arrives tomorrow at 9am on WhatsApp.", "Your Monday report comes on Monday morning.", "Your QR codes are ready to print."],
          },
        },
      },
    ],
  },
};

export function ChatPreview({ scene }: { scene: string }) {
  const s = SCENES[scene] ?? SCENES.hello;
  const [messages, setMessages] = useState(s.messages);
  const [chosen, setChosen] = useState(s.chosen ?? {});
  const owner = (text: string) => setMessages((m) => [...m, { id: String(m.length + 1), role: "owner", text }]);
  // A loud warning if anything makes the page wider than the screen (no sideways scrolling, ever).
  const [overflow, setOverflow] = useState<number | null>(null);
  useEffect(() => {
    const check = () => {
      const wide = document.documentElement.scrollWidth - window.innerWidth;
      setOverflow(wide > 0 ? wide : null);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [messages.length]);
  return (
    <>
      {overflow !== null && (
        <p role="alert" className="fixed inset-x-0 top-0 z-50 bg-red-600 p-2 text-center text-sm font-bold text-white">
          {overflow}px wider than the screen
        </p>
      )}
      <ChatLayout
      restaurantName="Ember & Spice Grill"
      progress={s.progress}
      messages={messages}
      typing={s.typing}
      skippable={s.skippable}
      chosen={chosen}
      stepsOpen={s.stepsOpen}
      handlers={{
        onSend: owner,
        onPick: (id, o) => (setChosen((c) => ({ ...c, [id]: o.id })), owner(o.label)),
        onChoose: (id, c) => (setChosen((x) => ({ ...x, [id]: c.id })), owner(c.title)),
        onFiles: (_id, files) => owner(`📎 ${files.map((f) => f.name).join(", ")}`),
        onConfirm: (_id, changes) => owner(Object.keys(changes).length ? `Changed: ${Object.values(changes).join(", ")}` : "Looks right"),
        onSkip: () => owner("Skip for now"),
        onJump: (key) => owner(`Let's do ${key} now`),
      }}
      />
    </>
  );
}
