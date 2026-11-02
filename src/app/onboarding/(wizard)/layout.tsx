import { AppShell } from "@/components/app-shell";

// No page links here: the owner is logging in or still setting up.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={false}>{children}</AppShell>;
}
