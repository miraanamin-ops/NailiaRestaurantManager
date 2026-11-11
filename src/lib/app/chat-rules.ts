// The app's Chat tab (step 50, phase 3), as plain code (tests/app-chat.test.ts).
// The chat runs on the WhatsApp bot's own engine (lib/app/chat.ts); these rules turn
// what the bot "sends" into chat bubbles: the buttons WhatsApp would have shown, as
// quick replies carrying the same ids the bot reads back (lib/bot/parse.ts), the
// draft each message is about, and the history from the messages table.
import type { ButtonTarget } from "@/lib/whatsapp";

// Where app messages are logged: the owner's own number on one side and "app" on the
// other, so the bot's history (which filters by the owner's number) includes them,
// while WhatsApp's 24-hour window (inbound to our WhatsApp number) ignores them.
export const APP_ADDRESS = "app";
// The number an app turn's channel "sends" to: a placeholder (lib/switches.ts), so a
// message that somehow skipped the app's sink is never sent anywhere.
export const APP_CHANNEL_TO = "whatsapp:+447700900489";

export type ChatButton = { id: string; title: string };
// What one bot message carries besides its words. Saved in messages.app.
export type ChatMeta = {
  buttons?: ChatButton[];
  draftId?: string | null; // the draft it shows (a card in the app while it's waiting)
  image?: string | null; // a picture the bot sent (an email preview)
  file?: { path: string; name: string; contentType: string } | null; // what the owner sent
  clientId?: string | null; // the app's own id for an owner message (one answer per message)
};
export type ChatMessage = { text: string } & ChatMeta;

const SKIP_REASON_TITLES = ["Wrong tone", "Wrong offer", "Not now"];

// The quick replies for one bot message: the same buttons, in the same order, with
// the same ids, as the WhatsApp templates in lib/whatsapp.ts.
export function chatButtons(withButtons: boolean | ButtonTarget | undefined): ChatButton[] {
  if (!withButtons) return [];
  if (withButtons === true) return [
    { id: "approve", title: "Approve" },
    { id: "edit", title: "Edit" },
    { id: "skip", title: "Skip" },
  ];
  const id = withButtons.draftId;
  switch (withButtons.buttons) {
    case "question":
      return [
        { id: `public:${id}`, title: "Reply publicly" },
        { id: `private:${id}`, title: "Handle privately" },
        { id: `both:${id}`, title: "Both" },
      ];
    case "hours":
      return [
        { id: `same:${id}`, title: "Same hours" },
        { id: `closed:${id}`, title: "Closed" },
        { id: `different:${id}`, title: "Different hours" },
      ];
    case "choice":
      return (withButtons.options ?? []).slice(0, 3).map((title, i) => ({ id: `choose:${id}:${i + 1}`, title }));
    case "idea":
      return [
        { id: `like:${id}`, title: "Like it" },
        { id: `skipidea:${id}`, title: "Skip" },
      ];
    case "offer":
      return [
        { id: `quietoffer:${id}`, title: "Draft an offer" },
        { id: `noquiet:${id}`, title: "Not now" },
      ];
    case "reasons":
      return SKIP_REASON_TITLES.map((title, i) => ({ id: `reason:${id}:${i + 1}`, title }));
    default:
      return [
        { id: `approve:${id}`, title: "Approve" },
        { id: `edit:${id}`, title: "Edit" },
        { id: `skip:${id}`, title: "Skip" },
      ];
  }
}

// The draft a message shows as a card: the one its buttons are about. Not for the
// quiet-night offer (its id is a forecast row) or skip reasons (the draft is gone).
// `true` means the draft on screen, which the caller looks up (onScreenId).
export function chatDraftId(withButtons: boolean | ButtonTarget | undefined, onScreenId: string | null): string | null {
  if (!withButtons) return null;
  if (withButtons === true) return onScreenId;
  if (withButtons.buttons === "offer" || withButtons.buttons === "reasons") return null;
  return withButtons.draftId;
}

// WhatsApp's *bold* and _italic_ as plain words (the app shows plain text).
export const plainText = (text: string) => text.replace(/\*([^*\n]+)\*/g, "$1").replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1$2").trim();

// ---------- Files the owner sends ----------

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // what Claude reads (lib/photos.ts)
export const MAX_FILE_BYTES = 16 * 1024 * 1024; // as on WhatsApp

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

export type FileCheck = { ok: true; contentType: string; ext: string; photo: boolean } | { ok: false; reason: string };

// What a phone says a file is can be vague ("application/octet-stream" for a CSV),
// so the name's extension decides when the type doesn't.
export function checkUpload(contentType: string | null | undefined, name: string, size: number): FileCheck {
  let type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  const ext = (name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "").replace("jpeg", "jpg");
  if (type === "image/jpg") type = "image/jpeg";
  if (!PHOTO_TYPES.includes(type) && !FILE_TYPES[type]) type = BY_EXTENSION[ext] ?? type;
  if (type === "text/comma-separated-values" || type === "application/csv") type = "text/csv";
  const photo = PHOTO_TYPES.includes(type);
  if (!photo && !FILE_TYPES[type]) {
    if (type === "image/heic" || type === "image/heif" || ext === "heic") return { ok: false, reason: "That photo is in Apple's HEIC format, which I can't read. Please send it again from the camera button: the app turns it into a normal photo." };
    if (ext === "xls") return { ok: false, reason: "That's an old Excel file (.xls). Please save it as .xlsx or CSV and send it again." };
    return { ok: false, reason: "I can read photos (JPEG, PNG or WebP), PDFs, CSV files and Excel files (.xlsx). That file isn't one of those." };
  }
  if (size <= 0) return { ok: false, reason: "That file was empty. Please try again." };
  if (photo && size > MAX_PHOTO_BYTES) return { ok: false, reason: "That photo is too large (over 5 MB). Please send a smaller one." };
  if (size > MAX_FILE_BYTES) return { ok: false, reason: "That file is too large (over 16 MB)." };
  return { ok: true, contentType: type, ext: photo ? type.split("/")[1].replace("jpeg", "jpg") : FILE_TYPES[type], photo };
}

// How an owner's file is written in the conversation (the same as the WhatsApp webhook for photos).
export function fileLine(photo: boolean, name: string, caption: string) {
  const c = caption.trim();
  return photo ? `[📷 photo]${c ? ` ${c}` : ""}` : `[📄 ${name.slice(0, 80)}]${c ? ` ${c}` : ""}`;
}

// ---------- History ----------

export type MessageRow = { id: string; direction: "inbound" | "outbound"; body: string | null; created_at: string; to_number: string | null; from_number: string | null; app?: ChatMeta | null };
export type ChatItem = {
  id: string;
  from: "owner" | "dinerai";
  text: string;
  at: string;
  channel: "app" | "whatsapp";
  buttons: ChatButton[];
  draftId: string | null; // shown as its card while it's still waiting
  image: string | null; // a picture DinerAI sent
  file: { name: string; photo: boolean } | null; // what the owner sent
};

// Rows (oldest first) as chat items. Buttons only on DinerAI's messages since the
// owner last said anything: older ones were answered or passed by, as on WhatsApp.
// A draft's card only while that draft is still waiting (waiting = its ids).
export function chatItems(rows: MessageRow[], waiting: ReadonlySet<string>): ChatItem[] {
  const lastOwner = rows.map((r) => r.direction).lastIndexOf("inbound");
  return rows
    .filter((r) => (r.body ?? "").trim() || r.app?.image || r.app?.file)
    .map((r) => {
      const meta = r.app ?? {};
      const fromOwner = r.direction === "inbound";
      const app = fromOwner ? r.to_number === APP_ADDRESS : r.from_number === APP_ADDRESS;
      const index = rows.indexOf(r);
      const draftId = meta.draftId && waiting.has(meta.draftId) ? meta.draftId : null;
      // A draft decided since (in the Inbox, on the website) takes its buttons with it.
      const live = !fromOwner && index > lastOwner && (!meta.draftId || draftId !== null);
      return {
        id: r.id,
        from: fromOwner ? ("owner" as const) : ("dinerai" as const),
        // An owner's file shows as the file itself, with only their caption as words.
        text: fromOwner ? (r.body ?? "").replace(meta.file ? /^\[(📷 photo|📄 [^\]]*)\]\s*/u : /$^/, "").trim() : plainText(r.body ?? ""),
        at: r.created_at,
        channel: app ? ("app" as const) : ("whatsapp" as const),
        buttons: live ? (meta.buttons ?? []) : [],
        draftId,
        image: meta.image ?? null,
        file: meta.file ? { name: meta.file.name, photo: meta.file.contentType.startsWith("image/") } : null,
      };
    });
}
