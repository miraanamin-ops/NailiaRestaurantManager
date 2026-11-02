// The web chat with Dina takes the whole screen: its own header (Dina and the
// progress) replaces the DinerAI bar the other onboarding pages have.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="dai-app flex min-h-dvh flex-1 flex-col bg-ink-950">{children}</div>;
}
