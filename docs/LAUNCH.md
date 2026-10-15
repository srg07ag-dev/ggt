# Lancement : checklist et décisions

Ce document sépare ce qui est **fait et vérifié dans le dépôt** de ce qui **reste à faire par vous** (infrastructure, contrats, décisions juridiques).
Rien ci-dessous ne doit être coché « fait » sans l'avoir réellement exécuté.

## A. Vérifié dans le dépôt

| Contrôle | Où | Comment le rejouer |
|---|---|---|
| Typage, lint, tests unitaires | CI | `npm run typecheck && npm run lint && npm test` |
| Chaque action serveur, route et page exige une session ; chaque fonction métier vérifie le droit ; pas de `dangerouslySetInnerHTML`, pas de secret en dur, pas d'import serveur côté client | `tests/authz-structure.test.ts` | `npm test` |
| Sondes sur le serveur de production : pas d'énumération de comptes, CSRF, cookie HttpOnly/SameSite, redirections ouvertes, en-têtes de sécurité, webhook inconnu | `e2e/probes.spec.ts` | `scripts/e2e.sh e2e/probes.spec.ts` |
| Parcours complets (CRM, ventes, finance, compta, membres, abonnements), bureau et mobile | `e2e/*.spec.ts` | `npm run build && scripts/e2e.sh` |
| Isolation entre entreprises (RLS forcée) et immuabilité (déclencheurs) | `tests/` | `npm test` |
| Performance sur 20 000 contacts, 30 000 tâches, 8 000 factures, 20 000 écritures, 50 000 lignes d'audit : toutes les lectures sous 1,5 s | `scripts/loadtest.ts` | `DATABASE_URL=…/ggt_test NODE_OPTIONS=--conditions=react-server npx tsx scripts/loadtest.ts` |
| Le paquet autonome (`output: "standalone"`) génère bien un PDF | vérifié à la main, polices et dépendances de pdfkit incluses | construire l'image puis télécharger un PDF de facture |
| Journal JSON, identifiant de requête (`x-request-id`), événements `security.*` | `src/lib/log.ts`, `src/instrumentation.ts` | voir §C |

**Non vérifié ici** : la construction de l'image Docker (pas de démon Docker dans l'environnement de développement) et l'exécution de la CI GitHub. Construisez l'image et regardez la première exécution de la CI avant de vous y fier.

## B. Mise en production (à faire)

1. **Base** : PostgreSQL 16 managé avec sauvegardes et PITR. Créer les rôles avec `scripts/db-roles.sql`, migrer avec `ggt_owner` (`docker build --target tools`, `npm run db:migrate`), puis faire tourner l'application avec `ggt_app` (sans `BYPASSRLS`). **Vérifier qu'aucune requête applicative ne tourne avec le propriétaire** : la RLS ne protège que le rôle restreint.
2. **Secrets** : dans le gestionnaire de secrets de l'hébergeur, jamais dans le dépôt ni l'image : `BETTER_AUTH_SECRET`, `DATABASE_URL`, `SMTP_URL`, secrets de webhook de paiement.
3. **TLS et proxy** : HTTPS obligatoire (`BETTER_AUTH_URL` en https, sinon l'application refuse de démarrer). Le proxy doit **écraser** `X-Forwarded-For` (voir `docs/OPERATIONS.md` §4).
4. **E-mail** : fournisseur SMTP choisi, domaine d'envoi avec SPF, DKIM et DMARC. Tester vérification d'adresse et mot de passe oublié de bout en bout.
5. **Stockage des justificatifs** : volume persistant sauvegardé (ou stockage objet à brancher, ce qui est un développement à prévoir).
6. **Sauvegardes** : planifier `scripts/backup.sh`, copier hors site, et **faire un exercice de restauration** avec `scripts/verify-backup.sh` avant l'ouverture, puis chaque trimestre.
7. **Premier administrateur de plateforme** : `npx tsx scripts/make-admin.ts <email>` puis activer son 2FA (obligatoire pour la console).
8. **Facturation désactivée par défaut** : ne l'activer qu'une fois prestataire de paiement, plans et mentions légales décidés (§D).

## C. Supervision

- Sonde : `GET /api/health` toutes les minutes (200 = base joignable, 503 sinon).
- Journaux : une ligne JSON par événement (`{"t","level","event",…}`). Aucun mot de passe, jeton ni e-mail n'y figure. Chaque réponse porte `x-request-id`, à faire apparaître dans les journaux du proxy.
- Alertes recommandées :
  - `event = "request.error"` (erreur serveur non gérée) : toute occurrence en rafale ;
  - `event = "security.rate_limited"` : pic anormal = tentative d'abus ;
  - `event = "security.forbidden"` : accès refusé répété pour un même compte ;
  - `event = "security.webhook_bad_signature"` : toute occurrence ;
  - `event = "mail.*_failed"` : l'inscription ou la réinitialisation est cassée ;
  - âge de la dernière sauvegarde, espace disque du stockage et de la base.
- Cette supervision est à brancher chez votre hébergeur : le dépôt émet les signaux, il ne les collecte pas.

## D. Décisions qui vous appartiennent

| Sujet | Pourquoi c'est bloquant |
|---|---|
| Prestataire de paiement | Le webhook est prêt (HMAC, anti-rejeu, idempotent) mais aucun prestataire n'est branché. Aucune facture d'abonnement n'est « payée » sans événement vérifié. |
| Règles du Togo (fiscalité, plan comptable, mentions) | Rien n'est livré : il faut un expert qui cite sa source (`scripts/ruleset.ts`). Sans règle validée, aucune estimation n'est produite. |
| Politique de prorata, remises, essais | Aujourd'hui : pas de prorata, période payée d'avance, changement de plan refusé si une période future est déjà payée. |
| Mentions légales, CGU, politique de confidentialité, DPA | À rédiger avec un juriste, selon les pays visés. |
| Conservation et suppression des données | Une facture émise doit être conservée selon la loi du pays : la suppression d'un compte client ne peut pas tout effacer. Définir durées, export et anonymisation (à développer). |
| Entreprises existantes lors de l'activation de la facturation | Leur laisser une période d'essai ou les basculer sur un plan gratuit ? |
| 2FA obligatoire pour les propriétaires | Recommandé ; aujourd'hui obligatoire seulement pour les administrateurs de plateforme. |
| Contrôle des mots de passe compromis (type HIBP) | Envoie un préfixe de hachage à un tiers : à accepter ou non. |
| Test d'intrusion externe | Les tests du dépôt réduisent le risque mais ne remplacent pas un regard extérieur avant d'accueillir des données réelles. |
