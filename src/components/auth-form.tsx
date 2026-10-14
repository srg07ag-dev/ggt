"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    const res =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: String(f.get("name")) })
        : await authClient.signIn.email({ email, password });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "Une erreur est survenue.");
    router.push("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && <Field id="name" name="name" label="Nom complet" required autoComplete="name" />}
      <Field id="email" name="email" type="email" label="E-mail" required autoComplete="email" />
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} className="w-full">
        {mode === "signup" ? "Créer mon compte" : "Se connecter"}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>Déjà inscrit ? <Link className="text-accent" href="/login">Se connecter</Link></>
        ) : (
          <>Pas encore de compte ? <Link className="text-accent" href="/signup">Créer un compte</Link></>
        )}
      </p>
    </form>
  );
}
