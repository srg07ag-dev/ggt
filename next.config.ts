import type { NextConfig } from "next";

// pdfkit et ses dépendances, chargées dynamiquement : le traçage automatique en oublie des fichiers.
const PDFKIT_FILES = ["pdfkit", "fontkit", "linebreak", "png-js", "fflate", "restructure", "brotli", "clone", "dfa", "fast-deep-equal", "tiny-inflate", "unicode-properties", "unicode-trie", "base64-js", "@swc/helpers", "@noble/ciphers", "@noble/hashes"];

const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone", // image Docker minimale : `node server.js`
  // pdfkit lit ses polices (.afm) sur le disque : on les inclut explicitement dans le paquet autonome.
  outputFileTracingIncludes: { "/**": PDFKIT_FILES.map((p) => `./node_modules/${p}/**`) },
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  serverExternalPackages: ["postgres", "pdfkit"],
  // En-têtes de sécurité (CSP avec nonce, HSTS…) : voir src/proxy.ts. X-Frame-Options reste en filet pour les vieux navigateurs.
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },
};

export default config;
