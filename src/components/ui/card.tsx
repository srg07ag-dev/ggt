import clsx from "clsx";

/** Carte blanche arrondie à ombre douce, posée sur la feuille de contenu. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={clsx("rounded-[var(--radius-lg)] bg-surface p-6 shadow-card", className)} />;
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <header className="mb-4">
      <h2>{children}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </header>
  );
}
