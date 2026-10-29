import clsx from "clsx";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "tonal" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-card hover:bg-accent-hover",
  tonal: "bg-accent-soft text-on-accent-soft hover:brightness-95",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-2",
  ghost: "text-accent hover:bg-accent-soft",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-5 text-sm font-semibold transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
