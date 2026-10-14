import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  serverExternalPackages: ["postgres", "pdfkit"],
  // En-têtes de sécurité (CSP avec nonce, HSTS…) : voir src/proxy.ts. X-Frame-Options reste en filet pour les vieux navigateurs.
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },
};

export default config;
