import clsx from "clsx";

/** Carte blanche arrondie à ombre douce, posée sur la feuille de contenu. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={clsx("glass rounded-[var(--radius-lg)] p-6", className)} />;
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <header className="mb-4">
      <h2>{children}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </header>
  );
}
