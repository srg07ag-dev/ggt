"use client";

import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

type SessionRow = { id: string; token: string; ipAddress?: string | null; userAgent?: string | null; createdAt: Date | string };

function PasswordCard() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [loading, setLoading] = useState(false);
  return (
    <Card>
      <CardTitle hint="Les autres appareils seront déconnectés.">Mot de passe</CardTitle>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setLoading(true);
          setMsg(undefined);
          const res = await authClient.changePassword({ currentPassword: String(f.get("current")), newPassword: String(f.get("next")), revokeOtherSessions: true });
          setLoading(false);
          if (res.error) return setMsg({ ok: false, text: res.error.message ?? "Mot de passe actuel incorrect." });
          form.reset();
          setMsg({ ok: true, text: "Mot de passe modifié." });
        }}
      >
        <Field id="cur" name="current" type="password" label="Mot de passe actuel" required autoComplete="current-password" />
        <Field id="new" name="next" type="password" label="Nouveau mot de passe" required minLength={10} autoComplete="new-password" />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={loading}>Modifier</Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
        </div>
      </form>
    </Card>
  );
}

function TwoFactorCard({ enabled: initial }: { enabled: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [step, setStep] = useState<"idle" | "verify" | "done">("idle");
  const [qr, setQr] = useState<string>();
  const [secretUri, setSecretUri] = useState<string>();
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function start(password: string) {
    setError(undefined);
    setLoading(true);
    const res = await authClient.twoFactor.enable({ password });
    setLoading(false);
    if (res.error || !res.data || res.data.method !== "totp") return setError("Mot de passe incorrect.");
    setSecretUri(res.data.totpURI);
    setQr(await QRCode.toDataURL(res.data.totpURI, { margin: 1, width: 192 }));
    setCodes(res.data.backupCodes);
    setStep("verify");
  }

  return (
    <Card>
      <CardTitle hint="Un code temporaire est demandé à chaque connexion, en plus du mot de passe.">Double authentification</CardTitle>
      <div className="mb-3">{enabled ? <Badge tone="success">Activée</Badge> : <Badge tone="warning">Désactivée</Badge>}</div>

      {!enabled && step === "idle" && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void start(String(new FormData(e.currentTarget).get("password"))); }}>
          <div className="min-w-56 flex-1"><Field id="tf-pw" name="password" type="password" label="Mot de passe (confirmation)" required autoComplete="current-password" /></div>
          <Button type="submit" loading={loading}>Activer</Button>
        </form>
      )}

      {step === "verify" && (
        <div className="space-y-4 text-sm">
          <p>1. Scannez ce QR code avec une application d&apos;authentification (Google Authenticator, Authy, 1Password…).</p>
          {qr && (
            // data: URL générée localement : next/image n'apporte rien ici
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code d'activation" width={192} height={192} className="rounded border border-border" />
          )}
          <details><summary className="cursor-pointer text-muted">Saisie manuelle</summary><code className="mt-1 block break-all text-xs">{secretUri}</code></details>
          <p>2. Notez vos codes de secours : chacun ne sert qu&apos;une fois si vous perdez votre téléphone. Ils ne seront plus affichés.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-4">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <p>3. Saisissez le code à 6 chiffres affiché pour terminer.</p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(undefined);
              setLoading(true);
              const res = await authClient.twoFactor.verifyTotp({ code: String(new FormData(e.currentTarget).get("code")).trim() });
              setLoading(false);
              if (res.error) return setError("Code incorrect.");
              setEnabled(true);
              setStep("done");
            }}
          >
            <div className="w-40"><Field id="tf-code" name="code" label="Code" inputMode="numeric" required autoComplete="one-time-code" /></div>
            <Button type="submit" loading={loading}>Confirmer</Button>
          </form>
        </div>
      )}

      {enabled && step !== "verify" && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            setLoading(true);
            const res = await authClient.twoFactor.disable({ password: String(new FormData(e.currentTarget).get("password")) });
            setLoading(false);
            if (res.error) return setError("Mot de passe incorrect.");
            setEnabled(false);
            setStep("idle");
          }}
        >
          <div className="min-w-56 flex-1"><Field id="tf-off" name="password" type="password" label="Mot de passe pour désactiver" required autoComplete="current-password" /></div>
          <Button type="submit" variant="secondary" loading={loading}>Désactiver</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

function SessionsCard({ currentToken, rows }: { currentToken: string; rows: SessionRow[] }) {
  const router = useRouter();
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card>
      <CardTitle hint="Appareils actuellement connectés à votre compte.">Sessions actives</CardTitle>
      <ul className="divide-y divide-border text-sm">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.userAgent ?? "Appareil inconnu"}</span>
              <span className="block text-xs text-muted">{s.ipAddress ?? "IP inconnue"} · {fmt.format(new Date(s.createdAt))}</span>
            </span>
            {s.token === currentToken ? (
              <Badge tone="accent">Cet appareil</Badge>
            ) : (
              <Button variant="secondary" onClick={async () => { await authClient.revokeSession({ token: s.token }); router.refresh(); }}>Déconnecter</Button>
            )}
          </li>
        ))}
      </ul>
      {rows.length > 1 && (
        <div className="mt-3"><Button variant="secondary" onClick={async () => { await authClient.revokeOtherSessions(); router.refresh(); }}>Déconnecter tous les autres appareils</Button></div>
      )}
    </Card>
  );
}

export function SecurityPanel({ twoFactorEnabled, currentToken, sessions }: { twoFactorEnabled: boolean; currentToken: string; sessions: SessionRow[] }) {
  return (
    <div className="space-y-4">
      <PasswordCard />
      <TwoFactorCard enabled={twoFactorEnabled} />
      <SessionsCard currentToken={currentToken} rows={sessions} />
    </div>
  );
}
