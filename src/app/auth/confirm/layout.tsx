import { AppShell } from "@/components/app-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={false}>{children}</AppShell>;
}
