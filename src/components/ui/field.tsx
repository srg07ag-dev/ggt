import clsx from "clsx";

export function Field({
  label,
  error,
  hint,
  id,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...props}
        className={clsx(
          "h-10 w-full rounded-[var(--radius-sm)] border bg-surface px-3 text-sm placeholder:text-muted",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-danger" : "border-border-strong ",
          className,
        )}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
