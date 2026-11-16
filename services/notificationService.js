/**
 * Notifications : enregistrées en base (fil « Notifications ») et poussées en temps réel (socket.io) sur tous les
 * onglets ouverts du destinataire. Lien interne uniquement (jamais d'URL externe).
 */
import pool from "../config/database.js";
import * as hub from "../realtime/hub.js";

const safeLink = (link) => (typeof link === "string" && /^\/[a-z0-9/_-]{0,200}$/i.test(link) ? link : null);

const toNotification = (row) => ({
  id: Number(row.id),
  type: row.type,
  title: row.title,
  body: row.body,
  link: row.link_path,
  cta: row.cta_label,
  read: Boolean(row.read_at),
  at: new Date(row.created_at).toISOString(),
});

/** Crée une notification et la pousse en direct ; renvoie la notification créée. */
export async function notify(userId, { type, title, body = null, link = null, cta = null, actorUserId = null }) {
  const [result] = await pool.execute(
    `INSERT INTO notifications (user_id, type, actor_user_id, title, body, link_path, cta_label) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, String(type).slice(0, 50), actorUserId, String(title).slice(0, 200), body ? String(body).slice(0, 1000) : null, safeLink(link), cta ? String(cta).slice(0, 60) : null],
  );
  const [rows] = await pool.execute("SELECT * FROM notifications WHERE id = ?", [result.insertId]);
  const notification = toNotification(rows[0]);
  hub.toUser(userId, "notification:new", { notification, unread: await unreadCount(userId) });
  return notification;
}

export async function list(userId, limit = 50) {
  const [rows] = await pool.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?", [userId, Math.min(Number(limit) || 50, 100)]);
  return rows.map(toNotification);
}

export async function unreadCount(userId) {
  const [[row]] = await pool.execute("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", [userId]);
  return Number(row.n);
}

/** Marque comme lues (toutes, ou une liste d'identifiants appartenant à l'utilisateur). */
export async function markRead(userId, ids = null) {
  if (Array.isArray(ids)) {
    const clean = ids.map((v) => Number.parseInt(v, 10)).filter((v) => Number.isSafeInteger(v) && v > 0).slice(0, 200);
    if (!clean.length) return 0;
    const [result] = await pool.query("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL AND id IN (?)", [userId, clean]);
    hub.toUser(userId, "notification:read", { unread: await unreadCount(userId) });
    return result.affectedRows;
  }
  const [result] = await pool.execute("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL", [userId]);
  hub.toUser(userId, "notification:read", { unread: 0 });
  return result.affectedRows;
}

/** Ménage : notifications lues depuis plus de 30 jours. */
export async function purgeOld() {
  const [result] = await pool.execute("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < UTC_TIMESTAMP() - INTERVAL 30 DAY");
  return result.affectedRows;
}
