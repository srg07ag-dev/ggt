/**
 * Vérifie la configuration SMTP avant le lancement.
 *   SMTP_URL=smtps://… EMAIL_FROM="GGT <no-reply@domaine>" npx tsx scripts/smtp-check.ts [destinataire]
 * Sans destinataire : teste seulement la connexion et l'authentification. Avec : envoie un message d'essai.
 */
import nodemailer from "nodemailer";

const url = process.env.SMTP_URL;
const from = process.env.EMAIL_FROM;
if (!url || !from) {
  console.error("SMTP_URL et EMAIL_FROM sont requis.");
  process.exit(2);
}
const t = nodemailer.createTransport(url);
try {
  await t.verify();
  console.log("Connexion et authentification SMTP : OK");
  const to = process.argv[2];
  if (to) {
    const info = await t.sendMail({ from, to, subject: "Essai GGT", text: "Ce message confirme que l'envoi d'e-mails GGT fonctionne." });
    console.log(`Message accepté par le serveur (${info.messageId}). Vérifiez sa réception et qu'il n'est pas classé en spam.`);
  }
} catch (e) {
  console.error("Échec :", e instanceof Error ? e.message : e);
  process.exit(1);
}
