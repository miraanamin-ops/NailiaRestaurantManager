"use client";
import { useRef, useState } from "react";
import { card, primary } from "./styles";

// Asking for a photo, a PDF or a spreadsheet. The whole card is one big target; on a
// phone, "photo" offers the camera or the gallery.

export const ACCEPT: Record<"photo" | "document" | "spreadsheet" | "any", string | undefined> = {
  photo: "image/*",
  document: "application/pdf,image/*",
  spreadsheet: ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  any: undefined,
};

const HINT: Record<keyof typeof ACCEPT, string> = {
  photo: "A photo from your camera or gallery",
  document: "A PDF or a photo",
  spreadsheet: "A CSV or Excel file (.csv, .xlsx)",
  any: "Any file",
};

export function UploadCard({
  accept,
  multiple,
  label,
  onFiles,
  disabled = false,
  status,
}: {
  accept: keyof typeof ACCEPT;
  multiple: boolean;
  label: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  // e.g. "Uploading 2 of 3…" or "3 photos sent"
  status?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  return (
    <div className={`${card} p-4`}>
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label={label}
        accept={ACCEPT[accept]}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          setNames(files.map((f) => f.name));
          onFiles(files);
          e.target.value = "";
        }}
      />
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} className={`${primary} flex w-full items-center justify-center gap-2`}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
      <p className="mt-2 text-center text-[13px] text-fog">{status ?? (names.length ? names.join(", ") : `${HINT[accept]}${multiple ? ", one or more" : ""}`)}</p>
    </div>
  );
}
