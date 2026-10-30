// Files an owner sends while setting up (menu photos, a PDF menu, CSV or Excel
// exports): which are accepted, the size limit, and what Dina says about the
// rest. Plain code, unit-tested (tests/dina-whatsapp.test.ts). Saving them is
// in uploads-store.ts, in the private onboarding-uploads bucket (migration 051).

// WhatsApp (through Twilio) carries files up to 16 MB, so that's ours too.
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
// At most this many files from one message.
export const MAX_FILES_PER_MESSAGE = 10;

export type UploadKind = "photo" | "pdf" | "csv" | "excel";

// The type each kind is saved as, and its file ending.
export const UPLOAD_TYPES: Record<UploadKind, { contentType: string; ext: string; noun: string }> = {
  photo: { contentType: "image/jpeg", ext: "jpg", noun: "photo" },
  pdf: { contentType: "application/pdf", ext: "pdf", noun: "PDF" },
  csv: { contentType: "text/csv", ext: "csv", noun: "CSV file" },
  excel: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", noun: "Excel file" },
};

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);

// What a file really is, from its first bytes; the label it came with (Twilio's
// MediaContentType) only decides between CSV and other plain text. Anything else
// (a video, a voice note, a Word file, a zip) is null: not accepted.
export function uploadKind(label: string, bytes: Uint8Array): { kind: UploadKind; contentType: string; ext: string } | null {
  const type = label.toLowerCase().split(";")[0].trim();
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "photo", contentType: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "photo", contentType: "image/png", ext: "png" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return { kind: "photo", contentType: "image/webp", ext: "webp" };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf", contentType: "application/pdf", ext: "pdf" };
  // .xlsx is a zip; only accepted when it's labelled as a spreadsheet (a Word file is a zip too).
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && /spreadsheetml|ms-excel|excel/.test(type)) return { kind: "excel", ...UPLOAD_TYPES.excel };
  // Old .xls (and other Office 97 files): again only when labelled as Excel.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) && /ms-excel|excel/.test(type)) return { kind: "excel", contentType: "application/vnd.ms-excel", ext: "xls" };
  // CSV: labelled as CSV (or plain text, or Excel's habit of calling CSVs ms-excel) and really text.
  if (/csv|comma-separated|text\/plain|ms-excel/.test(type) && looksLikeText(bytes)) return { kind: "csv", ...UPLOAD_TYPES.csv };
  return null;
}

// Text: no zero bytes in the first 4 KB, and some commas, semicolons or tabs.
function looksLikeText(bytes: Uint8Array) {
  const head = bytes.subarray(0, 4096);
  if (!head.length || head.includes(0)) return false;
  return head.some((b) => b === 0x2c || b === 0x3b || b === 0x09);
}

export type Received = { kind: UploadKind };
export type Refused = { reason: "type" | "size" | "failed"; label: string };

// "3 photos and a PDF"
export function describeFiles(files: Received[]) {
  const counts = new Map<UploadKind, number>();
  for (const f of files) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => {
    const noun = UPLOAD_TYPES[kind].noun;
    return n === 1 ? `${/^[AEIOU]/i.test(noun) ? "an" : "a"} ${noun}` : `${n} ${noun}s`;
  });
  return parts.length <= 1 ? (parts[0] ?? "nothing") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// What the owner hears about files that weren't kept: friendly, and what to send instead.
export function refusedText(refused: Refused[]) {
  if (!refused.length) return null;
  const tooBig = refused.some((r) => r.reason === "size");
  const wrongType = refused.some((r) => r.reason === "type");
  const failed = refused.some((r) => r.reason === "failed");
  const one = refused.length === 1;
  if (tooBig && !wrongType && !failed)
    return `${one ? "That file is" : "Some of those files are"} too big for me (the most is 16 MB). Could you send a smaller copy, or a photo of each page instead?`;
  if (failed && !wrongType && !tooBig) return `I couldn't download ${one ? "that file" : "some of those files"}. Could you send ${one ? "it" : "them"} again?`;
  return `I can't open ${one ? "that kind of file" : "some of those files"}. I can take photos, PDFs, and CSV or Excel files${tooBig ? " up to 16 MB" : ""}. Could you send it as one of those?`;
}
