import clsx from "clsx";

export function Select({
  label,
  id,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; id: string }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <select
        id={id}
        {...props}
        className={clsx(
          "h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm hover:border-muted disabled:opacity-50",
          className,
        )}
      >
        {children}
      </select>
    </div>
  );
}

export function Textarea({
  label,
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        {...props}
        className="w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-sm hover:border-muted"
      />
    </div>
  );
}
