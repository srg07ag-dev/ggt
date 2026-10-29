export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-frame to-frame-2 px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-[var(--radius-lg)] bg-surface p-8 shadow-pop">
        <p className="text-xl font-bold tracking-tight text-accent">GGT</p>
        <div className="space-y-6">{children}</div>
      </div>
    </main>
  );
}
