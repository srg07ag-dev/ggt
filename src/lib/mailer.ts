import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { getConfig } from "./config";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | undefined;

/**
 * Envoi d'e-mail. smtp : production. console/file : développement et tests uniquement (config.ts les refuse en production).
 * Les liens sont des secrets : on ne journalise rien en production.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const cfg = getConfig();
  if (cfg.emailMode === "smtp") {
    transporter ??= nodemailer.createTransport(cfg.smtpUrl!);
    await transporter.sendMail({ from: cfg.emailFrom, to: mail.to, subject: mail.subject, text: mail.text });
    return;
  }
  if (cfg.emailMode === "file") {
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.MAIL_OUTBOX_DIR || ".mail-outbox");
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    await appendFile(/*turbopackIgnore: true*/ path.join(dir, "outbox.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...mail }) + "\n");
    return;
  }
  console.info(`[mail:console] à ${mail.to} — ${mail.subject}\n${mail.text}`);
}

export const mails = {
  verify: (to: string, url: string): Mail => ({
    to,
    subject: "Confirmez votre adresse e-mail",
    text: `Bonjour,\n\nPour activer votre compte GGT, confirmez votre adresse e-mail :\n${url}\n\nCe lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  }),
  reset: (to: string, url: string): Mail => ({
    to,
    subject: "Réinitialisation de votre mot de passe",
    text: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien :\n${url}\n\nIl est valable 1 heure et ne peut servir qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.`,
  }),
  invitation: (to: string, company: string, url: string): Mail => ({
    to,
    subject: `Invitation à rejoindre ${company}`,
    text: `Bonjour,\n\nVous êtes invité(e) à rejoindre « ${company} » sur GGT :\n${url}\n\nLe lien est personnel, valable 7 jours et ne peut servir qu'une fois.`,
  }),
};
