# Intégrations : e-mail et paiement

Aucun prestataire n'est choisi. Le code est volontairement neutre ; voici ce qui est prêt et ce qui reste à faire une fois le choix fait.

## E-mail (SMTP)

Prêt : tout fournisseur SMTP fonctionne via `SMTP_URL` (ex. `smtps://utilisateur:secret@hôte:465`) et `EMAIL_FROM`.
1. Créer le compte, ajouter votre domaine d'envoi, publier les enregistrements **SPF, DKIM et DMARC** demandés.
2. Tester : `SMTP_URL=… EMAIL_FROM=… npx tsx scripts/smtp-check.ts vous@exemple.com`.
3. Renseigner les variables en production (gestionnaire de secrets). L'application refuse de démarrer sans SMTP.
4. Dérouler une inscription réelle (lien de vérification) et un « mot de passe oublié ».

## Paiement des abonnements

Prêt : `POST /api/billing/webhook/<prestataire>` accepte un événement signé et marque la facture d'abonnement payée
(jamais sans événement vérifié). Activation d'un prestataire = définir `BILLING_WEBHOOK_SECRET_<NOM>` ; sans ce secret la route répond 404.

Contrat actuel (`src/modules/billing/webhook.ts`) :
- en-tête `x-signature: t=<secondes>,v1=<HMAC-SHA256 hex de "<t>.<corps brut>">`, tolérance 5 min ;
- corps JSON : `{ "id", "type": "invoice.paid", "data": { "invoiceNumber", "amountMinor", "currency", "reference?", "method?" } }` ;
- idempotent par (prestataire, `id`) ; montant ou devise différents → rejeté (422), facture inconnue → 404.

Ce qui reste à faire après le choix du prestataire :
1. **Créer la session de paiement** : un appel serveur qui crée le paiement chez le prestataire pour une facture d'abonnement et redirige le client (aucune clé secrète côté client). Non développé.
2. **Adapter la vérification de signature** au schéma du prestataire (seule `verifyWebhook` change) et faire correspondre son événement de succès à notre `invoice.paid` (référence = numéro de facture envoyé dans les métadonnées).
3. Tester en mode bac à sable : paiement réussi, échoué, événement rejoué, montant altéré.
4. Décider remboursements et litiges (non gérés : à traiter par écriture manuelle auditée).
