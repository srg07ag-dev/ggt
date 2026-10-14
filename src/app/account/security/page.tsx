import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { SecurityPanel } from "./security-panel";

export const metadata = { title: "Sécurité du compte" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ need2fa?: string }> }) {
  const { need2fa } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login?next=/account/security");
  const sessions = await auth.api.listSessions({ headers: await headers() });
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <Link href="/app" className="text-sm text-muted hover:text-accent">← Retour</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sécurité du compte</h1>
        <p className="text-sm text-muted">{session.user.email}</p>
        {need2fa && <p role="status" className="mt-3 rounded-[var(--radius)] border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">L&apos;administration de la plateforme exige la double authentification : activez-la ci-dessous pour continuer.</p>}
      </div>
      <SecurityPanel twoFactorEnabled={Boolean(session.user.twoFactorEnabled)} currentToken={session.session.token} sessions={sessions.map((x) => ({ id: x.id, token: x.token, ipAddress: x.ipAddress, userAgent: x.userAgent, createdAt: x.createdAt.toISOString() }))} />
    </main>
  );
}
