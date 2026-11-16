/**
 * Compteurs des espaces (messages non lus, notifications non lues, vérifications à traiter pour l'équipe).
 *  - countsFor : valeurs affichées au chargement d'une page (menu latéral, points de la barre du haut).
 *  - pushBadges / pushAdminBadges : valeurs exactes envoyées en direct (événement « badges ») à tous les onglets
 *    connectés du compte, à chaque changement : nouveau message, conversation lue, décision de l'équipe…
 *    Les onglets restent donc synchronisés sans recharger la page.
 */
import pool from "../config/database.js";
import * as hub from "../realtime/hub.js";

/** Messages non lus (envoyés par l'autre partie ou par l'équipe après la dernière lecture) et notifications non lues. */
export async function countsFor(user, mandataireId = null) {
  const [[notifications]] = await pool.execute("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", [user.id]);
  let messages = 0;
  if (user.role === "client") {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM conversation_events e JOIN conversations c ON c.id = e.conversation_id
        WHERE c.client_id = ? AND e.sender_role <> 'client' AND e.created_at > COALESCE(c.client_read_at, '1970-01-01')`,
      [user.id],
    );
    messages = Number(row.n);
  } else if (user.role === "mandataire" && mandataireId) {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM conversation_events e JOIN conversations c ON c.id = e.conversation_id
        WHERE c.mandataire_id = ? AND e.sender_role <> 'mandataire' AND e.created_at > COALESCE(c.mandataire_read_at, '1970-01-01')`,
      [mandataireId],
    );
    messages = Number(row.n);
  } else if (user.role === "admin") {
    const [[row]] = await pool.execute("SELECT COUNT(*) AS n FROM verification_requests WHERE status = 'open'");
    return { verifications: Number(row.n), notifications: Number(notifications.n) };
  }
  return { messages, notifications: Number(notifications.n) };
}

/** Envoie les compteurs exacts aux onglets connectés de ces utilisateurs (rien n'est calculé pour un absent). */
export async function pushBadges(...userIds) {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  await Promise.all(ids.map(async (id) => {
    try {
      if (!(await hub.isOnline(id))) return;
      const [[user]] = await pool.execute(
        "SELECT u.id, u.role, mp.id AS mandataire_id FROM users u LEFT JOIN mandataire_profiles mp ON mp.user_id = u.id WHERE u.id = ? LIMIT 1",
        [id],
      );
      if (!user) return;
      hub.toUser(id, "badges", await countsFor(user, user.mandataire_id));
    } catch (error) {
      console.error("[compteurs] envoi impossible :", error.message); // un compteur en retard ne bloque jamais l'action
    }
  }));
}

/** Compteur « Vérifications » de l'équipe : envoyé à tous les administrateurs connectés. */
export async function pushAdminBadges() {
  try {
    const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
    await pushBadges(...admins.map((a) => a.id));
  } catch (error) {
    console.error("[compteurs] administrateurs :", error.message);
  }
}
