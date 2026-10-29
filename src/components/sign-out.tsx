"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "text-muted hover:text-text" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      className={`text-sm ${className}`}
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Se déconnecter
    </button>
  );
}
