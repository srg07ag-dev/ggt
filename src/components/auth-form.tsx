"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function AuthForm({ mode, next = "/app", defaultEmail }: { mode: "login" | "signup"; next?: string; defaultEmail?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string>();
  const [resent, setResent] = useState(false);
  const [unverified, setUnverified] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    setUnverified(undefined);
    setLoading(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    if (mode === "signup") {
      const res = await authClient.signUp.email({ email, password, name: String(f.get("name")), callbackURL: next });
      setLoading(false);
      if (res.error) return setError(res.error.message ?? "Une erreur est survenue.");
      // sans session : la vérification de l'e-mail est obligatoire avant la première connexion
      if (!res.data?.token) return setPendingEmail(email);
    } else {
      const res = await authClient.signIn.email({ email, password, callbackURL: next });
      setLoading(false);
      if (res.error) {
        if (res.error.status === 403) return setUnverified(email);
        return setError(res.error.message ?? "Identifiants incorrects.");
      }
      if (res.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) return; // le client redirige vers /two-factor
    }
    router.push(next);
    router.refresh();
  }

  async function resend(email: string) {
    await authClient.sendVerificationEmail({ email, callbackURL: next });
    setResent(true);
  }

  if (pendingEmail) {
    return (
      <div role="status" className="space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Vérifiez votre boîte e-mail</h2>
        <p className="text-muted">Nous avons envoyé un lien de confirmation à <strong className="text-text">{pendingEmail}</strong>. Cliquez dessus pour activer votre compte (valable 1 heure).</p>
        <button className="text-accent" onClick={() => resend(pendingEmail)}>{resent ? "E-mail renvoyé" : "Renvoyer l'e-mail"}</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && <Field id="name" name="name" label="Nom complet" required autoComplete="name" />}
      <Field id="email" name="email" type="email" label="E-mail" required autoComplete="email" defaultValue={defaultEmail} />
      <Field
        id="password"
        name="password"
        type="password"
        label="Mot de passe"
        required
        minLength={10}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        hint={mode === "signup" ? "10 caractères minimum." : undefined}
      />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {unverified && (
        <div role="alert" className="space-y-1 text-sm text-danger">
          <p>Adresse e-mail non confirmée. Un nouveau lien vient d&apos;être envoyé à {unverified} si le compte existe.</p>
        </div>
      )}
      <Button type="submit" loading={loading} className="w-full">
        {mode === "signup" ? "Créer mon compte" : "Se connecter"}
      </Button>
      {mode === "login" && <p className="text-center text-sm"><Link className="text-muted hover:text-accent" href="/forgot-password">Mot de passe oublié ?</Link></p>}
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>Déjà inscrit ? <Link className="text-accent" href={next === "/app" ? "/login" : `/login?next=${encodeURIComponent(next)}`}>Se connecter</Link></>
        ) : (
          <>Pas encore de compte ? <Link className="text-accent" href={next === "/app" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}>Créer un compte</Link></>
        )}
      </p>
    </form>
  );
}
