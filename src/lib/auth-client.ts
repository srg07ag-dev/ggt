import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      // la page de vérification 2FA conserve la destination demandée (ex. une invitation)
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get("next");
        // rechargement complet voulu : le cookie de pré-authentification 2FA vient d'être posé
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/two-factor${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      },
    }),
  ],
});
