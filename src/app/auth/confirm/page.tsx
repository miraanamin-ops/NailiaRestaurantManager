import type { Metadata } from "next";
import { Confirm } from "./confirm";

export const metadata: Metadata = { title: "Logging in…", robots: { index: false, follow: false } };

// Where the link in the login email lands. With the standard Supabase email the
// login details arrive after the "#" in the address, which only the browser can
// see, so a small script hands them to the server (/auth/session). This works
// even if the email opens in a different browser app from the one you asked from.
export default function ConfirmPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 p-6 text-center text-stone-700">
      <Confirm />
    </div>
  );
}
