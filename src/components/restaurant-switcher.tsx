// For the builder (who can see every restaurant): pick which one the page shows.
// A plain GET form, so it works without any script.
export function RestaurantSwitcher({ choices, current, path }: { choices: { id: string; name: string }[]; current: string; path: string }) {
  if (choices.length < 2) return null;
  return (
    <form action={path} method="get" className="mb-4 flex items-center gap-2 rounded-2xl bg-[#121410] px-3 py-2 ring-1 ring-[#1e221b]">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6e7468]">Builder</span>
      <select
        name="r"
        defaultValue={current}
        className="min-w-0 flex-1 rounded-lg bg-[#171a14] px-2 py-1.5 text-[14px] text-[#edefe8] ring-1 ring-[#2c3127] focus:outline-none"
      >
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button className="rounded-full bg-[#1e221b] px-3 py-1.5 text-[13px] text-[#edefe8] ring-1 ring-[#2c3127]">Show</button>
    </form>
  );
}
