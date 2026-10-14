import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// La CSP utilise un nonce par requête : les pages doivent être rendues dynamiquement.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "GGT", template: "%s · GGT" },
  description: "CRM, facturation et gestion d'entreprise.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
