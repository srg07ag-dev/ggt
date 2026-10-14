import { AuthForm } from "@/components/auth-form";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: "Connexion" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bon retour</h1>
      {reset && <p role="status" className="text-sm text-success">Mot de passe modifié. Connectez-vous avec le nouveau.</p>}
      <AuthForm mode="login" next={safeNext(next)} />
    </>
  );
}
