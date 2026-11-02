"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importStoredSales, salesUploadTarget } from "@/app/onboarding/actions";

// Onboarding's sales upload. A year of sales can be bigger than a normal form
// upload allows, so the file goes from the browser straight into the restaurant's
// private storage (a one-time upload address from the server), with a progress
// bar, and then the server reads it with the usual POS import.
export function SalesUpload({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "reading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const upload = async () => {
    if (!file) return;
    setError(null);
    setStage("uploading");
    setProgress(0);
    const target = await salesUploadTarget(restaurantId, file.name, file.size);
    if ("error" in target) {
      setError(target.error);
      setStage("idle");
      return;
    }
    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", target.url);
      xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", file);
      xhr.send(body);
    });
    if (!ok) {
      setError("The upload didn't finish. Check your connection and try again.");
      setStage("idle");
      return;
    }
    setStage("reading");
    const next = await importStoredSales(restaurantId, target.path, file.name, file.type || "application/octet-stream");
    startTransition(() => router.push(next));
  };

  const mb = file ? (file.size / 1024 / 1024).toFixed(1) : null;
  return (
    <div className="space-y-3 rounded-xl bg-stone-50 p-4">
      <label className="block">
        <span className="text-sm font-medium">Your sales file</span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={stage !== "idle"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-stone-600 file:mr-3 file:rounded-full file:border-0 file:bg-stone-200 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-stone-900"
        />
      </label>
      {stage === "idle" && (
        <button
          type="button"
          onClick={upload}
          disabled={!file}
          className="block w-full rounded-full bg-[#c8f03c] px-4 py-3.5 text-center text-base font-semibold text-[#0b0c0a] transition hover:bg-[#d6f86a] disabled:opacity-40"
        >
          {file ? `Upload ${file.name} (${mb} MB)` : "Choose a file first"}
        </button>
      )}
      {stage !== "idle" && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full bg-emerald-600 transition-all ${stage === "reading" ? "animate-pulse" : ""}`}
              style={{ width: `${stage === "reading" ? 100 : Math.max(4, progress ?? 0)}%` }}
            />
          </div>
          <p className="text-sm text-stone-600">
            {stage === "uploading" ? `Uploading… ${progress ?? 0}%` : "Reading your file and adding up each day… this can take a minute for a whole year."}
          </p>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
