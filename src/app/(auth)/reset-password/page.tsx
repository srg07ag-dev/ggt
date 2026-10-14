"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

function Form() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  if (!token) return <p role="alert" className="text-sm text-danger">Lien invalide ou expiré. <Link className="text-accent" href="/forgot-password">Demander un nouveau lien</Link></p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        setLoading(true);
        const res = await authClient.resetPassword({ newPassword: String(new FormData(e.currentTarget).get("password")), token });
        setLoading(false);
        if (res.error) return setError("Lien invalide ou expiré. Demandez-en un nouveau.");
        router.push("/login?reset=1");
      }}
    >
      <Field id="password" name="password" type="password" label="Nouveau mot de passe" required minLength={10} autoComplete="new-password" hint="10 caractères minimum. Tous vos appareils seront déconnectés." />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={loading} className="w-full">Enregistrer</Button>
    </form>
  );
}

export default function ResetPassword() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau mot de passe</h1>
      <Suspense><Form /></Suspense>
    </>
  );
}
