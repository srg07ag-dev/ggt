# GGT — CRM, facturation et gestion d'entreprise

Monolithe modulaire : Next.js (App Router), TypeScript strict, Tailwind, PostgreSQL + Drizzle, Better Auth.

## Démarrage
```bash
cp .env.example .env.local        # adapter DATABASE_URL et BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run dev
```
En développement, les e-mails (vérification, mot de passe oublié) s'affichent dans la console du serveur (`EMAIL_MODE=console`).

## Vérifications
```bash
npm run typecheck && npm run lint
npm test                           # Vitest : isolation, permissions, ventes, finances, membres, audit, limitation de débit (base ggt_test)
npm run build && scripts/e2e.sh    # parcours Playwright desktop + mobile (serveur de test sur :3100, e-mails dans un fichier)
```

## Exploitation et sécurité
- `docs/OPERATIONS.md` : variables d'environnement, rôles PostgreSQL, sauvegardes et restauration, proxy, limites, supervision.
- `docs/SECURITY.md` : mesures en place et limites connues avant l'ouverture publique.
- `scripts/backup.sh`, `scripts/restore.sh`, `scripts/verify-backup.sh` : sauvegarde, restauration, exercice de restauration.
