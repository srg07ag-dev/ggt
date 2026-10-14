import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Inscription" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Créer votre compte</h1>
      <AuthForm mode="signup" />
    </>
  );
}
