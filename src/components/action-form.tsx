"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action";

/** Bouton d'action serveur avec affichage de l'erreur métier. */
export function ActionButton({
  action,
  children,
  variant = "primary",
  confirm,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col gap-1"
    >
      <Button type="submit" variant={variant} loading={pending}>
        {children}
      </Button>
      {state?.error && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
