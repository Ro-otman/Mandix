/**
 * E-mails transactionnels de l'authentification. Chaque message existe en HTML (modèle views/emails/message.ejs)
 * et en texte brut. Le logo et l'icône sont joints au message (images « cid ») : ils s'affichent même si la
 * messagerie bloque les images distantes, et ne dépendent pas de l'adresse du site.
 * Les liens sont construits à partir de APP_BASE_URL, jamais de l'en-tête Host de la requête (qui pourrait
 * être falsifié pour détourner un lien de réinitialisation).
 */
import path from "node:path";
import ejs from "ejs";
import config from "../config/app.js";
import { sendMail } from "../config/mailer.js";

const TEMPLATE = path.join(config.rootDir, "views", "emails", "message.ejs");
const ACCENTS = { verify: "#1747B5", exists: "#1747B5", reset: "#A15C07", changed: "#0C6B58" };

const link = (pathname) => new URL(pathname, config.baseUrl).href;
const hours = (seconds) => Math.round(seconds / 3600);
const minutes = (seconds) => Math.round(seconds / 60);

/** Nom affiché : pseudo (clients, mandataires) ou prénom et nom (administrateurs). */
const nameOf = (user) => user.pseudo || [user.first_name, user.last_name].filter(Boolean).join(" ") || "utilisateur";

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Texte échappé, passages **entre doubles astérisques** en gras. */
const rich = (value) => escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0B1B3A;">$1</strong>');
const plain = (value) => String(value).replace(/\*\*(.+?)\*\*/g, "$1");

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: config.timezone, timeZoneName: "short",
});
const now = () => dateFormat.format(new Date());

/** « Chrome · Windows » à partir de l'en-tête User-Agent (indication pour l'utilisateur, jamais une preuve). */
export function describeDevice(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} · ${os}` : browser;
}

/** Construit le message (HTML + texte) sans l'envoyer : utilisé pour l'envoi et pour l'aperçu de développement. */
export async function buildMessage(kind, content) {
  const locals = {
    appName: config.appName,
    baseUrl: config.baseUrl,
    year: new Date().getFullYear(),
    accent: ACCENTS[kind] || "#1747B5",
    button: null, secondaryLink: null, expiry: null, details: null, steps: null, notice: null, fallback: false,
    rich,
    ...content,
  };
  const html = await ejs.renderFile(TEMPLATE, locals);
  const text = [
    plain(content.title), "",
    ...content.paragraphs.map(plain), "",
    ...(content.button ? [`${content.button.label} : ${content.button.url}`, ""] : []),
    ...(content.expiry ? [content.expiry, ""] : []),
    ...(content.details || []).map(([label, value]) => `${label} : ${value}`),
    ...(content.details?.length ? [""] : []),
    ...(content.steps ? [content.steps.title, ...content.steps.items.map(([t, d], i) => `${i + 1}. ${t} — ${d}`), ""] : []),
    ...(content.notice ? [`${content.notice.title} ${plain(content.notice.text)}${content.notice.link ? ` ${content.notice.link.label} : ${content.notice.link.url}` : ""}`, ""] : []),
    `À très vite,\nL'équipe ${config.appName}`, "",
    `Centre d'aide : ${link("/aide")}`,
  ].join("\n");
  // Aucune pièce jointe : le logo est dessiné en HTML (une image jointe s'affiche comme pièce jointe dans Gmail,
  // est bloquée dans les indésirables et alourdit le score anti-spam).
  return { html, text, attachments: [] };
}

async function deliver(to, kind, content) {
  const { html, text, attachments } = await buildMessage(kind, content);
  return sendMail({ to, subject: content.subject, text, html, attachments });
}

/* ------------------------------------------------------------------ Contenus */

const STEPS = {
  client: {
    title: "Et ensuite ?",
    items: [
      ["Choisissez un mandataire", "celui qui détient le compte qu'il vous faut : PayPal, Wise, Western Union, virement, crypto…"],
      ["Indiquez votre montant", "dans la messagerie guidée, avec des messages préfaits, sans échange improvisé."],
      ["Suivez chaque étape", "preuves à l'appui, jusqu'à la réception de l'argent sur votre compte."],
    ],
  },
  mandataire: {
    title: "Et ensuite ?",
    items: [
      ["Ajoutez vos comptes", "PayPal, Wise, virement… publiés dès leur ajout, dans le pays de votre choix."],
      ["Répondez aux demandes", "la messagerie guidée vous propose la bonne réponse à chaque étape."],
      ["Montez de niveau", "votre plafond grandit avec vos transactions, jusqu'à la certification."],
    ],
  },
};

export const contents = {
  verify(user, token) {
    const role = user.role === "mandataire" ? "mandataire" : "client";
    return {
      subject: `Confirmez votre adresse e-mail · ${config.appName}`,
      preheader: "Un clic pour activer votre compte et commencer.",
      eyebrow: "Confirmation de votre adresse",
      title: `Bienvenue sur ${config.appName}, ${nameOf(user)} !`,
      paragraphs: [
        role === "mandataire"
          ? "Votre compte **mandataire** est presque prêt. Confirmez votre adresse e-mail pour l'activer, puis publiez vos comptes et recevez les demandes de clients du monde entier."
          : "Votre compte **client** est presque prêt. Confirmez votre adresse e-mail pour l'activer et faire vos transactions avec des mandataires du monde entier.",
      ],
      button: { label: "Confirmer mon adresse e-mail", url: link(`/verification-email/${token}`) },
      fallback: true,
      expiry: `Lien valable ${hours(config.tokens.emailVerificationTtlSeconds)} heures, utilisable une seule fois`,
      steps: STEPS[role],
      notice: {
        tone: "info",
        title: "Vous n'avez pas créé de compte ?",
        text: "Ignorez simplement cet e-mail : aucun compte ne sera activé sans confirmation.",
      },
    };
  },

  /**
   * Inscription avec une adresse déjà utilisée (une adresse = un seul compte). Si l'inscription visait un autre
   * type de compte (ex. mandataire alors que l'adresse sert au compte client), l'e-mail explique comment le créer
   * avec une autre adresse ; pour Gmail, il propose l'alias « +pro » qui arrive dans la même boîte.
   */
  exists(user, attemptedRole = null) {
    if (attemptedRole && attemptedRole !== user.role) {
      const ROLE = { client: "client", mandataire: "mandataire", admin: "administrateur" };
      const [local, domain = ""] = String(user.email).split("@");
      const gmail = /^(gmail|googlemail)\.com$/i.test(domain);
      const alias = `${local.split("+")[0]}+${attemptedRole === "mandataire" ? "pro" : "client"}@${domain}`;
      return {
        subject: `Vous avez déjà un compte ${config.appName}`,
        preheader: `Cette adresse sert déjà à votre compte ${ROLE[user.role]} : un compte ${ROLE[attemptedRole]} se crée avec une autre adresse.`,
        eyebrow: "Tentative d'inscription",
        title: "Cette adresse est déjà utilisée",
        paragraphs: [
          `Une inscription comme **${ROLE[attemptedRole]}** vient d'être tentée avec cette adresse, déjà associée à votre compte ${ROLE[user.role]} **${nameOf(user)}**.`,
          `Une adresse e-mail ne sert qu'à un seul compte : pour créer votre compte ${ROLE[attemptedRole]}, inscrivez-vous avec une autre adresse.`,
        ],
        button: attemptedRole === "mandataire"
          ? { label: "Créer mon compte mandataire", url: link("/mandataire/inscription") }
          : { label: "Créer mon compte client", url: link("/inscription") },
        secondaryLink: { before: "Vous vouliez simplement vous connecter ?", label: "Me connecter", url: link(user.role === "mandataire" ? "/connexion?espace=mandataire" : "/connexion") },
        details: [["Date de la tentative", now()]],
        notice: gmail
          ? { tone: "info", title: "Astuce Gmail", text: `Utilisez **${alias}** : c'est une nouvelle adresse pour ${config.appName}, mais les e-mails arrivent dans votre boîte habituelle.` }
          : { tone: "info", title: "Ce n'était pas vous ?", text: "Aucune action n'est nécessaire : votre compte n'a pas été modifié et personne n'y a eu accès." },
      };
    }
    return {
      subject: `Vous avez déjà un compte ${config.appName}`,
      preheader: "Une inscription a été tentée avec votre adresse e-mail.",
      eyebrow: "Tentative d'inscription",
      title: "Vous avez déjà un compte",
      paragraphs: [
        `Une inscription vient d'être tentée avec cette adresse e-mail, qui est déjà associée au compte **${nameOf(user)}**.`,
        "Si c'était vous, connectez-vous simplement avec votre mot de passe habituel.",
      ],
      button: { label: "Me connecter", url: link("/connexion") },
      secondaryLink: { before: "Mot de passe oublié ?", label: "Choisir un nouveau mot de passe", url: link("/mot-de-passe-oublie") },
      details: [["Date de la tentative", now()]],
      notice: {
        tone: "info",
        title: "Ce n'était pas vous ?",
        text: "Aucune action n'est nécessaire : votre compte n'a pas été modifié et personne n'y a eu accès.",
      },
    };
  },

  reset(user, token) {
    return {
      subject: `Réinitialisez votre mot de passe · ${config.appName}`,
      preheader: `Votre lien est valable ${minutes(config.tokens.passwordResetTtlSeconds)} minutes.`,
      eyebrow: "Mot de passe oublié",
      title: "Choisissez un nouveau mot de passe",
      paragraphs: [
        `Nous avons reçu une demande de réinitialisation du mot de passe du compte **${nameOf(user)}**.`,
        "Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Par sécurité, toutes les sessions ouvertes sur vos appareils seront fermées.",
      ],
      button: { label: "Choisir un nouveau mot de passe", url: link(`/reinitialisation/${token}`) },
      fallback: true,
      expiry: `Lien valable ${minutes(config.tokens.passwordResetTtlSeconds)} minutes, utilisable une seule fois`,
      details: [["Demande reçue le", now()]],
      notice: {
        tone: "warning",
        title: "Vous n'avez rien demandé ?",
        text: "Ignorez cet e-mail : votre mot de passe actuel reste valable et personne ne peut le changer sans ce lien.",
      },
    };
  },

  changed(user, { userAgent } = {}) {
    const device = describeDevice(userAgent);
    return {
      subject: `Votre mot de passe a été modifié · ${config.appName}`,
      preheader: "Toutes vos sessions ont été fermées par sécurité.",
      eyebrow: "Sécurité du compte",
      title: "Votre mot de passe a été modifié",
      paragraphs: [
        `Le mot de passe du compte **${nameOf(user)}** vient d'être modifié.`,
        "Pour votre sécurité, toutes les sessions ouvertes ont été fermées : reconnectez-vous avec votre nouveau mot de passe.",
      ],
      button: { label: "Me connecter", url: link("/connexion") },
      details: [["Date", now()], ...(device ? [["Appareil", device]] : [])],
      notice: {
        tone: "danger",
        title: "Ce n'était pas vous ?",
        text: "Réinitialisez immédiatement votre mot de passe, puis contactez notre équipe depuis le centre d'aide.",
        link: { label: "Réinitialiser mon mot de passe", url: link("/mot-de-passe-oublie") },
      },
    };
  },
};

/* ------------------------------------------------------------------ Envois */

export const sendVerificationEmail = (user, token) => deliver(user.email, "verify", contents.verify(user, token));
/** Inscription avec une adresse déjà utilisée : on prévient le titulaire au lieu de révéler l'existence du compte. */
export const sendAccountExistsEmail = (user, attemptedRole = null) => deliver(user.email, "exists", contents.exists(user, attemptedRole));
export const sendPasswordResetEmail = (user, token) => deliver(user.email, "reset", contents.reset(user, token));
export const sendPasswordChangedEmail = (user, context) => deliver(user.email, "changed", contents.changed(user, context));

/** Aperçu de développement (images intégrées en data URI) : exemples fictifs, aucun envoi. */
export async function previewMessage(kind) {
  const sample = { pseudo: "AwaD", email: kind === "exists-pro" ? "awa.d@gmail.com" : "awa@exemple.com", role: kind === "verify-pro" ? "mandataire" : "client" };
  const token = "exemple-de-jeton-a-usage-unique-0123456789abcdef";
  const real = { "verify-pro": "verify", "exists-pro": "exists" }[kind] || kind;
  const builders = {
    verify: () => contents.verify(sample, token),
    exists: () => contents.exists(sample, kind === "exists-pro" ? "mandataire" : null),
    reset: () => contents.reset(sample, token),
    changed: () => contents.changed(sample, { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0" }),
  };
  if (!builders[real]) return null;
  const content = builders[real]();
  const { html, attachments } = await buildMessage(real, content);
  return { subject: content.subject, html, attachments };
}
