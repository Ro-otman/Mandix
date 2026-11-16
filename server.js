import app from "./app.js";
import config from "./config/app.js";
import { checkDatabaseConnection } from "./config/database.js";
import { purgeExpiredSecurityData } from "./services/authService.js";
import { isMailConfigured, verifyMailer } from "./config/mailer.js";
import { createRealtime } from "./realtime/io.js";
import { purgeExpiredMessages } from "./services/messagingService.js";
import { purgeOld as purgeOldNotifications } from "./services/notificationService.js";

const server = app.listen(config.port, async () => {
  console.info(`${config.appName} démarré sur ${config.baseUrl} (${config.env})`);
  const db = await checkDatabaseConnection();
  if (db.ok) console.info("MySQL : connexion établie.");
  else console.warn(`MySQL : connexion impossible (${db.code}). Les pages dépendant de la base échoueront.`);
  if (isMailConfigured) {
    const mail = await verifyMailer();
    if (mail.ok) console.info("SMTP : connexion et identification réussies.");
    else console.warn(`SMTP : échec de la connexion (${mail.reason}). Les e-mails de confirmation ne partiront pas.`);
  } else {
    console.info("SMTP non configuré : e-mails enregistrés localement (voir /dev/emails).");
  }
});

// Temps réel (messagerie, notifications) sur le même serveur HTTP.
createRealtime(server);

// Ménage horaire : jetons expirés, sessions terminées, anciennes tentatives de connexion.
const purge = () =>
  Promise.all([purgeExpiredSecurityData(), purgeExpiredMessages(), purgeOldNotifications()])
    .catch((error) => console.warn(`Ménage impossible (${error.code || error.message}).`));
setTimeout(purge, 30_000).unref();
setInterval(purge, 60 * 60 * 1000).unref();

function shutdown(signal) {
  console.info(`${signal} reçu, arrêt du serveur…`);
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
