import clsx from "clsx";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      {...props}
      className={clsx("rounded-[var(--radius-lg)] border border-border bg-surface p-5", className)}
    />
  );
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <header className="mb-4">
      <h2 className="text-sm font-semibold">{children}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </header>
  );
}
