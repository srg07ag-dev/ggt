export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center app-bg px-4 py-10">
      <div className="w-full max-w-sm glass space-y-6 rounded-[var(--radius-lg)] p-8">
        <p className="text-xl font-bold tracking-tight text-accent">GGT</p>
        <div className="space-y-6">{children}</div>
      </div>
    </main>
  );
}
