/**
 * Configuration applicative centralisée.
 * Toutes les variables d'environnement sont lues ici, et uniquement ici.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env.NODE_ENV || "development";
const isProduction = env === "production";

/** Lit une variable obligatoire ; en production, son absence bloque le démarrage. */
function required(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction || devFallback === undefined) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return devFallback;
}

/** Secret cryptographique obligatoire (32 caractères minimum), lu uniquement depuis l'environnement. */
function secret(name) {
  const value = process.env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} manquant ou trop court (32 caractères minimum) : voir .env.example.`);
  }
  return value;
}

const config = Object.freeze({
  env,
  isProduction,
  rootDir,
  port: Number(process.env.PORT) || 3000,
  appName: "Mandix",
  baseUrl: process.env.APP_BASE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  trustProxy: process.env.TRUST_PROXY === "true",
  // Profils fictifs pour concevoir le design. Toujours désactivé en production.
  demoContent: !isProduction && process.env.DEMO_CONTENT === "true",
  // Profils fictifs dans la recherche (revue du design uniquement) ; par défaut, seuls les vrais mandataires apparaissent.
  demoMarketplace: process.env.DEMO_MARKETPLACE === "true",

  locale: "fr-BJ",
  currency: "XOF",
  timezone: "Africa/Porto-Novo",
  defaultCountry: "BJ",

  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: required("DB_USER", "root"),
    password: process.env.DB_PASSWORD || "",
    database: required("DB_NAME", "mandix"),
    connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  },

  // Authentification par jetons : jeton d'accès JWT de courte durée + jeton de rafraîchissement opaque
  // (haché en base, renouvelé à chaque usage). Les deux voyagent en cookies HttpOnly, jamais en JavaScript.
  auth: {
    accessSecret: secret("JWT_ACCESS_SECRET"),
    accessTtlSeconds: (Number(process.env.ACCESS_TOKEN_TTL_MINUTES) || 15) * 60,
    rememberTtlSeconds: (Number(process.env.REFRESH_REMEMBER_DAYS) || 30) * 24 * 3600,
    sessionTtlSeconds: (Number(process.env.REFRESH_SESSION_HOURS) || 12) * 3600,
    issuer: "mandix",
    audience: "mandix-web",
    // Préfixe __Host- en production (cookie lié au domaine exact, HTTPS obligatoire, chemin « / »).
    cookiePrefix: isProduction ? "__Host-" : "",
    // Délai pendant lequel un jeton de rafraîchissement déjà renouvelé reste toléré (requêtes simultanées).
    refreshGraceSeconds: 30,
  },
  cookieSecret: secret("COOKIE_SECRET"),
  csrfSecret: secret("CSRF_SECRET"),
  // Clé de chiffrement des données sensibles au repos (utils/encryption.js)
  dataEncryptionKey: secret("DATA_ENCRYPTION_KEY"),
  // Messagerie éphémère : messages effacés 3 jours après la clôture de leur transaction
  messages: { retentionDays: 3 },

  // Durée de validité des liens envoyés par e-mail
  tokens: {
    emailVerificationTtlSeconds: 24 * 3600,
    passwordResetTtlSeconds: 30 * 60,
  },

  mail: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || '"Mandix" <no-reply@localhost>',
    // Développement sans SMTP : dossier où les e-mails sont enregistrés (consultables sur /dev/emails)
    outboxDir: process.env.MAIL_OUTBOX_DIR || path.join(rootDir, "storage", "mail-outbox"),
  },

  uploads: {
    // Stockage privé, hors de /public : jamais servi en statique.
    privateDir: process.env.UPLOAD_PRIVATE_DIR || path.join(rootDir, "storage", "private"),
    maxFileSizeBytes: (Number(process.env.UPLOAD_MAX_MB) || 5) * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
  },
});

export default config;
