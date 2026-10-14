# Sécurité — vue d'ensemble

## Ce qui est en place (et testé)

- **Isolation par entreprise** : contrôle d'accès côté serveur à chaque requête + RLS PostgreSQL forcée + clés étrangères composites
  (`tests/isolation.test.ts`, `crm.test.ts`, `sales.test.ts`, `finance.test.ts`, `members.test.ts`, `e2e/`).
- **Rôles** (propriétaire, administrateur, responsable, collaborateur, comptable, lecteur) évalués côté serveur ; un refus d'accès renvoie un 404.
- **Authentification** : mots de passe hachés par Better Auth, 10 caractères minimum, vérification d'e-mail obligatoire,
  réinitialisation par lien à usage unique (1 h) qui révoque toutes les sessions, double authentification TOTP + codes de secours,
  liste et révocation des sessions, limitation de débit par IP et par compte.
- **Données financières** : factures émises, avoirs, lignes, paiements, opérations et journal d'audit **immuables dans la base**
  (déclencheurs) ; numérotation sans trou ; montants en entiers.
- **Fichiers** : type vérifié d'après le contenu, 10 Mo maximum, stockage privé, empreinte SHA-256, téléchargement uniquement avec session
  et appartenance, `nosniff` + CSP `sandbox`.
- **Exports CSV** : protégés contre l'injection de formules, tracés dans l'audit.
- **En-têtes** : CSP avec nonce (pas de script en ligne), HSTS, `frame-ancestors 'none'`, Permissions-Policy, COOP.
- **Configuration** validée au démarrage ; aucun secret côté client.
- **Journal d'audit** en ajout seul, consultable par les rôles autorisés.

## Limites connues (à décider avant l'ouverture publique)

| Sujet | État | Recommandation |
|---|---|---|
| 2FA | Facultative | La rendre obligatoire pour les propriétaires / administrateurs |
| Mots de passe compromis | Non vérifiés | Activer le contrôle « Have I Been Pwned » (plugin Better Auth) si les sorties réseau le permettent |
| Chiffrement des fichiers au repos | Dépend du disque / du volume | Chiffrement du volume ou stockage objet chiffré |
| Sauvegardes | Scripts fournis, planification à votre charge | Cron + copie hors site + exercice hebdomadaire |
| Détection d'anomalies, alertes | Non | Brancher la supervision sur `/api/health` et les 429 |
| Droit à l'effacement / export des données d'un utilisateur | Non | À concevoir avec votre conseil juridique |
| Revue externe | Non | Test d'intrusion avant le lancement commercial |
| `npm audit` | 4 alertes modérées : ancien `esbuild` embarqué par `drizzle-kit` (outil de migration, aucun serveur esbuild n'est lancé) | Suivre les mises à jour de `drizzle-kit` ; ne pas utiliser `npm audit fix --force` (rétrogradation cassante) |
| `style-src 'unsafe-inline'` | Présent (styles générés par Next.js) | Acceptable : aucun script en ligne n'est autorisé |
