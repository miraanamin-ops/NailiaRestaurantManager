import { AppShell } from "@/components/app-shell";

// No page links here: a simple page for the password.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={false}>{children}</AppShell>;
}
