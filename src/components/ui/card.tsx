import clsx from "clsx";

/** Section à plat : un filet net au-dessus, pas de boîte. La hiérarchie vient de la typographie et de l'espacement. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={clsx("border-t border-border pt-5", className)} />;
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <header className="mb-4">
      <h2>{children}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </header>
  );
}
