import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

// La CSP utilise un nonce par requête : les pages doivent être rendues dynamiquement.
export const dynamic = "force-dynamic";

const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto" });

export const metadata: Metadata = {
  title: { default: "GGT", template: "%s · GGT" },
  description: "CRM, facturation et gestion d'entreprise.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={roboto.variable}>
      <body>{children}</body>
    </html>
  );
}
