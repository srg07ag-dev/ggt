import clsx from "clsx";

const tones = {
  neutral: "bg-accent-soft text-muted",
  accent: "bg-accent-soft text-on-accent-soft",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}
