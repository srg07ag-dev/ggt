import clsx from "clsx";

const tones = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex h-5 items-center rounded-[4px] px-1.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
