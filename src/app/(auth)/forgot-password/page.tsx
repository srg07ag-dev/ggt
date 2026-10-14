"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h1>
      {sent ? (
        // même message que le compte existe ou non : on ne révèle pas quelles adresses sont inscrites
        <p role="status" className="text-sm text-muted">Si un compte existe pour cette adresse, un lien de réinitialisation vient d&apos;être envoyé. Il est valable 1 heure.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            await authClient.requestPasswordReset({ email: String(new FormData(e.currentTarget).get("email")), redirectTo: "/reset-password" });
            setLoading(false);
            setSent(true);
          }}
        >
          <Field id="email" name="email" type="email" label="E-mail" required autoComplete="email" />
          <Button type="submit" loading={loading} className="w-full">Envoyer le lien</Button>
        </form>
      )}
      <p className="text-center text-sm"><Link className="text-accent" href="/login">Retour à la connexion</Link></p>
    </>
  );
}
