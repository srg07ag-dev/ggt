# GGT — CRM, facturation et gestion d'entreprise

Monolithe modulaire : Next.js (App Router), TypeScript strict, Tailwind, PostgreSQL + Drizzle, Better Auth.

## Démarrage
```bash
cp .env.example .env.local        # adapter DATABASE_URL et BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run dev
```

## Vérifications
```bash
npm run typecheck && npm run lint
npm test                           # Vitest : isolation entre entreprises, permissions (base ggt_test)
npx playwright test                # parcours e2e desktop + mobile (serveur sur :3100)
```

## Sécurité multi-entreprises
- Autorisations vérifiées côté serveur (`requireMembership`), rôle par entreprise.
- Row-Level Security PostgreSQL (`FORCE`) sur les tables métier, liée à `app.company_id`.
- Journal d'audit en ajout seul (trigger).
