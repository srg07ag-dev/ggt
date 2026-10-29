import Link from "next/link";
import { ActionButton } from "@/components/action-form";
import { SignOutButton } from "@/components/sign-out";
import { getSession } from "@/lib/session";
import { previewInvitation } from "@/modules/core/members";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/modules/core/permissions";
import { acceptInvitationAction } from "./actions";

export const metadata = { title: "Invitation" };

const MESSAGES = {
  invalid: "Ce lien d'invitation n'est pas valide.",
  expired: "Cette invitation a expiré. Demandez-en une nouvelle à la personne qui vous a invité.",
  used: "Cette invitation a déjà été utilisée.",
  revoked: "Cette invitation a été annulée.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([previewInvitation(token), getSession()]);
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md space-y-5 glass rounded-[var(--radius-lg)] p-6">
        {preview.status !== "ok" ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Invitation indisponible</h1>
            <p className="text-sm text-muted">{MESSAGES[preview.status]}</p>
            <Link href="/app" className="text-sm font-medium text-accent">Aller à mon espace</Link>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Rejoindre {preview.companyName}</h1>
              <p className="mt-1 text-sm text-muted">Rôle proposé : <strong className="text-text">{ROLE_LABELS[preview.role]}</strong>. {ROLE_DESCRIPTIONS[preview.role]}</p>
              <p className="mt-1 text-sm text-muted">Invitation destinée à <strong className="text-text">{preview.email}</strong>.</p>
            </div>
            {session ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">Connecté en tant que {session.user.email}.</p>
                <ActionButton action={acceptInvitationAction.bind(null, token)}>Accepter l&apos;invitation</ActionButton>
                {session.user.email.toLowerCase() !== preview.email && <div><SignOutButton /></div>}
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Link href={`/signup?next=${next}`} className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover">Créer un compte</Link>
                <Link href={`/login?next=${next}`} className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2">Se connecter</Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
