"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory } from "@/lib/onboarding/profile-data";
import { UK_ALLERGENS } from "@/lib/onboarding/profile-data";
import { readMenu, uploadMenuPhoto } from "../actions";

const button = "block w-full rounded-xl bg-stone-900 px-4 py-4 text-center text-base font-semibold text-white disabled:opacity-50";
const secondary = "block w-full rounded-xl bg-white px-4 py-4 text-center text-base font-semibold text-stone-900 ring-1 ring-stone-300 disabled:opacity-50";

// Phone photos are big; shrink each one in the browser before uploading.
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo"))), "image/jpeg", 0.82));
}

export function MenuPhotos({ restaurantId, initialCount }: { restaurantId: string; initialCount: number }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(initialCount);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      let i = 0;
      for (const file of Array.from(files)) {
        setStatus(`Uploading photo ${++i} of ${files.length}…`);
        const form = new FormData();
        form.append("photo", await shrink(file), "menu.jpg");
        const result = await uploadMenuPhoto(restaurantId, form);
        if (result.error) throw new Error(result.error);
        setCount(result.count!);
      }
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "That upload didn't work. Please try again.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function read() {
    setBusy(true);
    setStatus("Reading your menu… this takes about a minute. ⏳");
    const result = await readMenu(restaurantId);
    if (result.error || !result.items) {
      setStatus(result.error ?? "I couldn't read any dishes from those photos. Try clearer photos (flat, in good light).");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={count ? secondary : button}>
        📷 {count ? "Add more photos" : "Take or choose photos"}
      </button>
      {count > 0 && (
        <button type="button" disabled={busy} onClick={read} className={button}>
          Read my menu ({count} photo{count === 1 ? "" : "s"})
        </button>
      )}
      {status && <p className="text-center text-sm text-stone-600">{status}</p>}
    </div>
  );
}

// The menu Claude read, as an editable table: fix names and prices, remove or add dishes.
export function MenuEditor({ initial, save, label = "This is right, save my menu" }: { initial: MenuCategory[]; save: (menu: MenuCategory[]) => Promise<void>; label?: string }) {
  const [menu, setMenu] = useState(initial);
  const [pending, start] = useTransition();
  const edit = (fn: (m: MenuCategory[]) => void) =>
    setMenu((m) => {
      const copy = m.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) }));
      fn(copy);
      return copy;
    });
  const field = "min-w-0 rounded-lg border border-stone-300 px-2.5 py-2 text-base";

  return (
    <div className="space-y-5">
      {menu.map((c, ci) => (
        <div key={ci} className="space-y-2">
          <input
            value={c.category}
            onChange={(e) => edit((m) => (m[ci].category = e.target.value))}
            className={`${field} w-full font-semibold`}
            aria-label="Section name"
          />
          {c.items.map((item, ii) => (
            <div key={ii} className="flex gap-2">
              <input
                value={item.name}
                onChange={(e) => edit((m) => (m[ci].items[ii].name = e.target.value))}
                className={`${field} flex-1`}
                aria-label="Dish"
              />
              <div className="relative w-24 shrink-0">
                <span className="pointer-events-none absolute left-2.5 top-2.5 text-stone-500">£</span>
                <input
                  value={item.price ? String(item.price) : ""}
                  onChange={(e) => edit((m) => (m[ci].items[ii].price = Number(e.target.value.replace(/[^\d.]/g, "")) || 0))}
                  inputMode="decimal"
                  className={`${field} w-full pl-6`}
                  aria-label="Price"
                />
              </div>
              <button
                type="button"
                onClick={() => edit((m) => m[ci].items.splice(ii, 1))}
                className="shrink-0 rounded-lg px-2 text-stone-400"
                aria-label={`Remove ${item.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => edit((m) => m[ci].items.push({ name: "", price: 0, description: null, allergens: [], allergens_confirmed: false }))}
            className="text-sm font-medium text-emerald-700"
          >
            + Add a dish
          </button>
        </div>
      ))}
      <button type="button" onClick={() => edit((m) => m.push({ category: "New section", items: [{ name: "", price: 0, description: null }] }))} className="text-sm font-medium text-emerald-700">
        + Add a section
      </button>
      <button type="button" disabled={pending} onClick={() => start(() => save(menu))} className={button}>
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}

// Suggested allergens per dish: tap a dish to change its allergens, then confirm them all.
export function AllergenEditor({ initial, save, label = "I've checked these, confirm" }: { initial: MenuCategory[]; save: (menu: MenuCategory[]) => Promise<void>; label?: string }) {
  const [menu, setMenu] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (ci: number, ii: number, a: string) =>
    setMenu((m) =>
      m.map((c, x) =>
        x !== ci
          ? c
          : {
              ...c,
              items: c.items.map((i, y) => {
                if (y !== ii) return i;
                const has = i.allergens?.includes(a);
                return { ...i, allergens: has ? i.allergens!.filter((v) => v !== a) : [...(i.allergens ?? []), a] };
              }),
            },
      ),
    );

  return (
    <div className="space-y-4">
      {menu.map((c, ci) => (
        <div key={ci}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{c.category}</p>
          <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-stone-200">
            {c.items.map((item, ii) => {
              const key = `${ci}-${ii}`;
              return (
                <li key={key} className="p-3">
                  <button type="button" onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-start justify-between gap-3 text-left">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-right text-sm text-stone-600">{item.allergens?.length ? item.allergens.join(", ") : "none"} ✏️</span>
                  </button>
                  {open === key && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {UK_ALLERGENS.map((a) => {
                        const on = item.allergens?.includes(a);
                        return (
                          <button
                            key={a}
                            type="button"
                            onClick={() => toggle(ci, ii, a)}
                            className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"}`}
                          >
                            {on ? "✓ " : ""}
                            {a}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button type="button" disabled={pending} onClick={() => start(() => save(menu))} className={button}>
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}
