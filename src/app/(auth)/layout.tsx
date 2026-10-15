export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <p className="text-[15px] font-semibold tracking-tight">GGT</p>
        <div className="space-y-6">{children}</div>
      </div>
    </main>
  );
}
