/**
 * Transport e-mail.
 *  - SMTP configuré (.env) : envoi réel.
 *  - Développement sans SMTP : l'e-mail est enregistré dans storage/mail-outbox (consultable sur /dev/emails)
 *    et son sujet est affiché dans la console, pour tester les liens sans serveur de messagerie.
 *  - Production sans SMTP : échec explicite (un lien de confirmation ne doit jamais être perdu en silence).
 */
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import config from "./app.js";

const isConfigured = Boolean(config.mail.host && config.mail.user);
export const OUTBOX_DIR = config.mail.outboxDir;

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure, // 465 : TLS dès la connexion ; 587 : STARTTLS (exigé ci-dessous)
      requireTLS: !config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
      tls: { minVersion: "TLSv1.2" },
      // Connexions réutilisées et délais bornés : un serveur SMTP lent ne bloque jamais l'application.
      pool: true,
      maxConnections: 2,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

export const isMailConfigured = isConfigured;

/** Vérifie la connexion et l'identification SMTP, sans envoyer d'e-mail. */
export async function verifyMailer() {
  if (!transporter) return { ok: false, reason: "non configuré" };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.code || error.message };
  }
}

/**
 * Remplace les images jointes (« cid:… ») par des images intégrées (data URI), pour afficher un e-mail dans le
 * navigateur (boîte d'envoi de développement, aperçu) : le navigateur ne connaît pas les pièces jointes.
 */
export async function inlineCidImages(html, attachments = []) {
  let result = html;
  for (const attachment of attachments) {
    if (!attachment.cid || !attachment.path) continue;
    const data = await fs.readFile(attachment.path);
    result = result.split(`cid:${attachment.cid}`).join(`data:image/png;base64,${data.toString("base64")}`);
  }
  return result;
}

async function writeToOutbox({ to, subject, text, html, attachments }) {
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(path.join(OUTBOX_DIR, `${base}.json`), JSON.stringify({ to, subject, text, date: new Date().toISOString() }, null, 2));
  await fs.writeFile(path.join(OUTBOX_DIR, `${base}.html`), html ? await inlineCidImages(html, attachments) : `<pre>${text}</pre>`);
  console.info(`[e-mail de développement] « ${subject} » pour ${to} : voir ${config.baseUrl}/dev/emails`);
  return base;
}

/**
 * @param {{to: string, subject: string, text: string, html?: string, attachments?: object[]}} message
 * Le contenu HTML doit être construit à partir de valeurs échappées (modèles EJS, balises d'affichage échappé).
 */
export async function sendMail({ to, subject, text, html, attachments = [] }) {
  if (transporter) {
    const info = await transporter.sendMail({ from: config.mail.from, to, subject, text, html, attachments });
    return { sent: true, messageId: info.messageId };
  }
  if (config.isProduction) throw new Error("SMTP non configuré : impossible d'envoyer l'e-mail.");
  const id = await writeToOutbox({ to, subject, text, html, attachments });
  return { sent: false, outbox: id };
}
