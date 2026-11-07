// The shared look of the login, password reset and new password pages.
export const authInput = "w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base";
export const authLabel = "block text-sm font-medium text-stone-700";
export const authButton = "w-full rounded-full bg-[#c8f03c] px-4 py-3 text-sm font-semibold text-[#0b0c0a] hover:bg-[#d6f86a]";

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-stone-100 px-4 text-stone-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200/70">
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
