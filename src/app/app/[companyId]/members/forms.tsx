"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { changeRoleAction, inviteAction } from "./actions";

type RoleOpt = { value: string; label: string };

export function InviteForm({ companyId, roles }: { companyId: string; roles: RoleOpt[] }) {
  const [state, action, pending] = useActionState(inviteAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  const [copied, setCopied] = useState(false);
  const link = state?.path && typeof window !== "undefined" ? `${window.location.origin}${state.path}` : undefined;
  return (
    <div className="space-y-4">
      <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end" onSubmit={() => setCopied(false)}>
        <Field id="invite-email" name="email" type="email" label="E-mail de la personne à inviter" required />
        <Select id="invite-role" name="role" label="Rôle" defaultValue={roles.find((r) => r.value === "member")?.value ?? roles[0]?.value}>
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Button type="submit" loading={pending}>Inviter</Button>
        {state?.error && <p role="alert" className="text-sm text-danger sm:col-span-3">{state.error}</p>}
      </form>
      {link && (
        <div role="status" className="space-y-2 rounded-[var(--radius)] border border-border-strong bg-accent-soft p-4 text-sm">
          <p className="font-medium">Invitation créée. Copiez ce lien et envoyez-le à la personne : il ne sera plus affiché.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={link} aria-label="Lien d'invitation" className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? "Copié" : "Copier"}</Button>
          </div>
          <p className="text-xs text-muted">Valable 7 jours, à usage unique, réservé à l&apos;adresse e-mail saisie.</p>
        </div>
      )}
    </div>
  );
}

export function RoleSelect({ companyId, userId, current, roles }: { companyId: string; userId: string; current: string; roles: RoleOpt[] }) {
  const [state, action, pending] = useActionState(changeRoleAction.bind(null, companyId, userId), undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <select
        name="role"
        defaultValue={current}
        aria-label="Rôle"
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9 rounded-full border border-border-strong bg-surface px-3 text-sm"
      >
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {state?.error && <span role="alert" className="max-w-56 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
