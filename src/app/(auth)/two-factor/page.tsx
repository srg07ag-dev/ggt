"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-next";

function Form() {
  const next = safeNext(useSearchParams().get("next"));
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        setLoading(true);
        const code = String(new FormData(e.currentTarget).get("code")).trim();
        const res = backup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
        setLoading(false);
        if (res.error) return setError("Code incorrect ou expiré.");
        window.location.assign(next);
      }}
    >
      <Field
        id="code"
        name="code"
        label={backup ? "Code de secours" : "Code à 6 chiffres"}
        required
        autoComplete="one-time-code"
        inputMode={backup ? "text" : "numeric"}
        autoFocus
      />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={loading} className="w-full">Vérifier</Button>
      <button type="button" className="block w-full text-center text-sm text-muted hover:text-accent" onClick={() => setBackup((b) => !b)}>
        {backup ? "Utiliser mon application d'authentification" : "Utiliser un code de secours"}
      </button>
    </form>
  );
}

export default function TwoFactor() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Vérification en deux étapes</h1>
      <p className="text-sm text-muted">Saisissez le code affiché par votre application d&apos;authentification.</p>
      <Suspense><Form /></Suspense>
    </>
  );
}
