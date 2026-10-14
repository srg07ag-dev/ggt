# Exploitation

Ce document décrit ce qu'il faut configurer **avant d'ouvrir le produit au public**. Les contrôles automatisés
vivent dans `tests/` et `e2e/` ; ce qui dépend de votre infrastructure est listé ici.

## 1. Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion de l'application (rôle **sans** `BYPASSRLS`, non superutilisateur — voir §2). |
| `BETTER_AUTH_SECRET` | 32 caractères minimum, aléatoire (`openssl rand -base64 32`). Les valeurs d'exemple sont refusées en production. |
| `BETTER_AUTH_URL` | URL publique, **en https** en production. |
| `EMAIL_MODE`, `SMTP_URL`, `EMAIL_FROM` | `smtp` obligatoire en production (vérification d'e-mail, mot de passe oublié). |
| `REQUIRE_EMAIL_VERIFICATION` | Vrai par défaut en production ; ne peut pas être désactivé. |
| `TRUSTED_IP_HEADER` | En-tête portant l'IP réelle du client (défaut `x-forwarded-for`). **Voir §4.** |
| `STORAGE_DIR` | Justificatifs : volume persistant et sauvegardé (ou stockage objet à brancher). |

Au démarrage, `src/lib/config.ts` **refuse** une configuration dangereuse en production (secret faible, http, e-mail en
mode console/fichier, vérification désactivée, SMTP absent). `ALLOW_INSECURE_TEST_CONFIG` n'existe que pour les tests e2e : ne jamais le définir.

## 2. Rôles PostgreSQL (moindre privilège)

L'isolation entre entreprises repose sur la RLS PostgreSQL (`FORCE ROW LEVEL SECURITY`) **et** sur les contrôles applicatifs.
La RLS ne protège que si le rôle de l'application ne peut pas la contourner :

```sql
-- Migrations (propriétaire des tables) — utilisé seulement par `npm run db:migrate`
CREATE ROLE ggt_owner LOGIN PASSWORD '…';
-- Application : ne possède pas les tables, ni SUPERUSER, ni BYPASSRLS
CREATE ROLE ggt_app LOGIN PASSWORD '…' NOBYPASSRLS NOSUPERUSER;
GRANT CONNECT ON DATABASE ggt TO ggt_app;
GRANT USAGE ON SCHEMA public TO ggt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ggt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ggt_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ggt_app;
-- Sauvegardes : lecture seule, autorisée à contourner la RLS (nécessaire à pg_dump)
CREATE ROLE ggt_backup LOGIN PASSWORD '…' BYPASSRLS;
GRANT pg_read_all_data TO ggt_backup;
```

⚠ `pg_dump` échoue avec le rôle applicatif (la RLS forcée l'empêche de lire) : c'est volontaire, utilisez `ggt_backup`.

### Règles réglementaires (fiscalité, comptabilité) — données de plateforme

La table `ruleset` n'appartient à aucune entreprise : elle contient les règles par pays (taux, obligations, référentiels). **Aucune règle n'est livrée.**
Pour qu'une règle soit appliquée, un expert nommé doit la valider en citant sa source ; elle devient alors **immuable** (toute évolution = nouvelle version avec ses dates de validité, l'historique n'est jamais réécrit).

```bash
npx tsx scripts/ruleset.ts propose regle.json
npx tsx scripts/ruleset.ts validate <id> --source "Texte officiel, article, date" --by "Nom de l'expert"
npx tsx scripts/ruleset.ts retire <id> --to 2026-12-31
npx tsx scripts/ruleset.ts list TG
```

À exécuter avec un rôle de plateforme. Le rôle applicatif ne doit avoir que le droit de lecture : `REVOKE INSERT, UPDATE, DELETE ON ruleset FROM ggt_app;`.
Les entreprises définissent elles-mêmes leur plan de comptes (import CSV) : le produit n'en impose ni n'en suggère aucun.

## 3. Sauvegardes et restauration

```bash
BACKUP_DATABASE_URL=postgres://ggt_backup:…@hôte/ggt  BACKUP_DIR=/var/backups/ggt  STORAGE_DIR=/var/lib/ggt/storage \
  scripts/backup.sh                         # base + justificatifs + empreintes SHA-256 + relevé des volumes
```

- Planifiez-la (cron / ordonnanceur de l'hébergeur) **au moins chaque jour** ; `KEEP_DAYS` règle la rétention locale.
- **Copiez les sauvegardes hors du serveur** (autre région / autre fournisseur). `BACKUP_GPG_RECIPIENT` les chiffre.
- **Exercice de restauration** (à planifier, par exemple chaque semaine) :
  ```bash
  DATABASE_URL=postgres://admin:…@hôte/ggt BACKUP_DATABASE_URL=postgres://ggt_backup:…@hôte/ggt scripts/verify-backup.sh
  ```
  Il restaure la dernière sauvegarde dans une base jetable, vérifie que la RLS forcée et les déclencheurs d'immutabilité sont revenus
  et compare les volumes au relevé. Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde.
- Restauration réelle : `scripts/restore.sh <db-….dump> <url-cible> [--force] [--files <files-….tar.gz> <dossier>]` (vérifie les empreintes
  et refuse d'écraser une base non vide sans `--force`).
- Objectifs à décider avec vous : perte de données maximale acceptable (RPO) et durée de remise en service (RTO).

## 4. Proxy et adresse IP des clients

La limitation de débit par IP lit `TRUSTED_IP_HEADER`. **N'exposez jamais l'application directement à Internet** : placez-la derrière un
proxy / répartiteur de charge qui **écrase** cet en-tête avec l'IP réelle. Sinon un attaquant fabrique son propre `X-Forwarded-For`
et contourne la limite par IP (la limite par compte, 20 tentatives / 15 min, reste active).

## 5. Limitations en place

| Cible | Limite |
|---|---|
| Connexion | 5 / min / IP ; 20 / 15 min / adresse e-mail |
| Inscription | 10 / min / IP |
| Mot de passe oublié, renvoi de vérification | 3 / 5 min / IP |
| Code 2FA | 5 / min / IP, verrouillage après échecs répétés |
| Essais de jetons d'invitation | 10 / 15 min / utilisateur |
| Invitations créées | 30 / h / entreprise |
| Exports CSV | 30 / h / utilisateur |
| Téléversements | 100 / h / utilisateur |
| PDF / téléchargements | 120 / min, 300 / min / utilisateur |

Les compteurs sont en base (partagés entre instances).

## 6. Supervision

- `GET /api/health` : 200 `{"status":"ok"}` si la base répond, sinon 503. À brancher sur votre outil de supervision.
- À surveiller : taux de 429, échecs d'envoi d'e-mail (« Échec d'envoi » dans les journaux), espace disque du stockage, âge de la dernière sauvegarde.
- Journal d'audit par entreprise : page « Journal d'audit » (propriétaire, administrateur, comptable).

## 7. Incident

1. Secret compromis → faire tourner `BETTER_AUTH_SECRET` (déconnecte tout le monde) et les mots de passe de base.
2. Compte compromis → l'utilisateur (ou un administrateur) change le mot de passe : toutes les sessions sont révoquées.
3. Restauration → §3, puis rejouer `scripts/verify-backup.sh`.
