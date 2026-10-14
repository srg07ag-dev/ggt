import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Connexion" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bon retour</h1>
      <AuthForm mode="login" />
    </>
  );
}
