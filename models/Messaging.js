/**
 * Accès aux données de la messagerie : conversations, transactions, messages (chiffrés, éphémères),
 * pièces jointes, demandes de vérification, évaluations. Requêtes préparées uniquement.
 * Le contenu des messages est chiffré avec le contexte « event:<conversation> » (utils/encryption.js).
 */
import pool from "../config/database.js";
import { encryptJson, decryptJson, encryptText, decryptText } from "../utils/encryption.js";
import { uuid } from "../utils/crypto.js";

export const eventContext = (conversationId) => `event:${conversationId}`;
export const payoutContext = (transactionId) => `payout:${transactionId}`;

/* ------------------------------------------------------------------ Conversations */

/**
 * Transactions qui comptent pour le niveau (plafond) : pendant une restriction, le niveau reste bloqué au palier
 * atteint au début de la restriction, quel que soit le nombre de transactions réussies ensuite.
 */
export const LEVEL_TRANSACTIONS_SQL = `CASE WHEN mp.restricted_until > UTC_TIMESTAMP()
       THEN LEAST(mp.transactions_count, COALESCE(mp.restricted_level_count, mp.transactions_count))
       ELSE mp.transactions_count END`;

const CONVERSATION = `SELECT c.id, c.public_id, c.client_id, c.mandataire_id, c.last_event_at, c.client_read_at, c.mandataire_read_at,
                             c.created_at, u.pseudo AS client_pseudo, u.public_id AS client_public_id, u.last_seen_at AS client_last_seen,
                             mp.slug AS mandataire_slug, mp.user_id AS mandataire_user_id, mp.transactions_count, mp.verified_at,
                             ${LEVEL_TRANSACTIONS_SQL} AS level_transactions,
                             mu.pseudo AS mandataire_pseudo, mu.last_seen_at AS mandataire_last_seen
                        FROM conversations c
                        JOIN users u ON u.id = c.client_id
                        JOIN mandataire_profiles mp ON mp.id = c.mandataire_id
                        JOIN users mu ON mu.id = mp.user_id`;

export const Conversation = {
  async findByPublicId(publicId, connection = pool) {
    if (typeof publicId !== "string" || !/^[0-9a-f-]{36}$/.test(publicId)) return null;
    const [rows] = await connection.execute(`${CONVERSATION} WHERE c.public_id = ? LIMIT 1`, [publicId]);
    return rows[0] ?? null;
  },
  async findByPair(clientId, mandataireId, connection = pool) {
    const [rows] = await connection.execute(`${CONVERSATION} WHERE c.client_id = ? AND c.mandataire_id = ? LIMIT 1`, [clientId, mandataireId]);
    return rows[0] ?? null;
  },
  /** Crée la conversation si elle n'existe pas (couple client / mandataire unique). */
  async findOrCreate(clientId, mandataireId, connection = pool) {
    await connection.execute(
      "INSERT IGNORE INTO conversations (public_id, client_id, mandataire_id) VALUES (?, ?, ?)",
      [uuid(), clientId, mandataireId],
    );
    return Conversation.findByPair(clientId, mandataireId, connection);
  },
  /** Conversations d'un client (role client) ou d'un mandataire (profil), les plus récentes d'abord. */
  async listFor({ clientId = null, mandataireId = null }) {
    const where = clientId ? "c.client_id = ?" : "c.mandataire_id = ?";
    const [rows] = await pool.execute(
      `${CONVERSATION} WHERE ${where} ORDER BY COALESCE(c.last_event_at, c.created_at) DESC LIMIT 100`,
      [clientId ?? mandataireId],
    );
    return rows;
  },
  async touch(conversationId, connection = pool) {
    await connection.execute("UPDATE conversations SET last_event_at = UTC_TIMESTAMP(3) WHERE id = ?", [conversationId]);
  },
  async markRead(conversationId, role) {
    const column = role === "client" ? "client_read_at" : "mandataire_read_at";
    await pool.execute(`UPDATE conversations SET ${column} = UTC_TIMESTAMP(3) WHERE id = ?`, [conversationId]);
  },
  /** Nombre de messages non lus par conversation, pour un rôle. */
  async unreadCounts(conversationIds, role) {
    if (!conversationIds.length) return new Map();
    const read = role === "client" ? "c.client_read_at" : "c.mandataire_read_at";
    const [rows] = await pool.query(
      `SELECT e.conversation_id, COUNT(*) AS n FROM conversation_events e JOIN conversations c ON c.id = e.conversation_id
        WHERE e.conversation_id IN (?) AND e.sender_role <> ? AND e.created_at > COALESCE(${read}, '1970-01-01')
        GROUP BY e.conversation_id`,
      [conversationIds, role],
    );
    return new Map(rows.map((r) => [Number(r.conversation_id), Number(r.n)]));
  },
};

/* ------------------------------------------------------------------ Transactions */

const TRANSACTION = `SELECT t.*, a.account_type_id, at.slug AS account_slug, at.name AS account_name, a.currency AS account_currency,
                            pt.slug AS payout_slug, pt.name AS payout_name
                       FROM transactions t
                       JOIN mandataire_accounts a ON a.id = t.mandataire_account_id
                       JOIN account_types at ON at.id = a.account_type_id
                       LEFT JOIN account_types pt ON pt.id = t.payout_account_type_id`;

export const Transaction = {
  /** Transaction en cours (non terminée, non annulée) d'une conversation ; verrouillée si connexion de transaction. */
  async findOpen(conversationId, connection = pool, { lock = false } = {}) {
    const [rows] = await connection.execute(
      `${TRANSACTION} WHERE t.conversation_id = ? AND t.status NOT IN ('completed','rejected','cancelled') ORDER BY t.id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [conversationId],
    );
    return rows[0] ?? null;
  },
  async findById(id, connection = pool) {
    const [rows] = await connection.execute(`${TRANSACTION} WHERE t.id = ? LIMIT 1`, [id]);
    return rows[0] ?? null;
  },
  async create({ conversationId, clientId, mandataireId, accountId }, connection) {
    const reference = `TX-${new Date().getUTCFullYear()}-${uuid().slice(0, 8).toUpperCase()}`;
    const [result] = await connection.execute(
      `INSERT INTO transactions (reference, conversation_id, client_id, mandataire_id, mandataire_account_id, status)
       VALUES (?, ?, ?, ?, ?, 'requested')`,
      [reference, conversationId, clientId, mandataireId, accountId],
    );
    return result.insertId;
  },
  /** Mise à jour de colonnes autorisées uniquement (liste blanche). */
  async update(id, fields, connection) {
    const ALLOWED = new Set(["status", "outcome", "currency", "amount", "amount_eur", "eur_rate", "limit_eur", "receive_option", "payout_account_type_id",
      "payout_details_enc", "payout_option", "payout_method", "payout_country", "proof_pending_since", "pending_reminded_at",
      "client_choice_notified_at", "proof_validated_at", "transfer_sent_at", "receipt_confirmed_at",
      "completed_at", "cancelled_at", "first_response_at", "proof_rejections"]);
    const entries = Object.entries(fields).filter(([k]) => ALLOWED.has(k));
    if (!entries.length) return;
    const sets = entries.map(([k, v]) => (v === "NOW" ? `${k} = UTC_TIMESTAMP()` : v === "INCREMENT" ? `${k} = ${k} + 1` : `${k} = ?`)).join(", ");
    const values = entries.filter(([, v]) => v !== "NOW" && v !== "INCREMENT").map(([, v]) => v);
    await connection.execute(`UPDATE transactions SET ${sets} WHERE id = ?`, [...values, id]);
  },
  encryptPayout: (transactionId, text) => encryptText(text, payoutContext(transactionId)),
  decryptPayout: (transactionId, blob) => decryptText(blob, payoutContext(transactionId)),
};

/* ------------------------------------------------------------------ Messages (chiffrés) */

const toEvent = (row) => ({
  id: String(row.id),
  from: row.sender_role,
  type: row.event_type,
  at: new Date(row.created_at).toISOString(),
  data: decryptJson(row.payload_enc, eventContext(row.conversation_id)),
});

export const ConversationEvent = {
  async create({ conversationId, transactionId, role, userId, type, data }, connection) {
    const [result] = await connection.execute(
      `INSERT INTO conversation_events (conversation_id, transaction_id, sender_role, sender_user_id, event_type, payload_enc)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [conversationId, transactionId, role, userId, type, encryptJson(data, eventContext(conversationId))],
    );
    const [rows] = await connection.execute("SELECT * FROM conversation_events WHERE id = ?", [result.insertId]);
    return toEvent(rows[0]);
  },
  /** Messages encore présents d'une conversation (les plus anciens d'abord). */
  async list(conversationId) {
    const [rows] = await pool.execute("SELECT * FROM conversation_events WHERE conversation_id = ? ORDER BY created_at, id", [conversationId]);
    return rows.map(toEvent);
  },
  async last(conversationId) {
    const [rows] = await pool.execute("SELECT * FROM conversation_events WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [conversationId]);
    return rows[0] ? toEvent(rows[0]) : null;
  },
};

/* ------------------------------------------------------------------ Pièces jointes */

export const Attachment = {
  async create({ conversationId, transactionId, userId, kind, storageKey, name, mime, size, sha256 }) {
    const [result] = await pool.execute(
      `INSERT INTO attachments (conversation_id, transaction_id, uploaded_by, kind, storage_key, original_name, mime_type, size_bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, transactionId, userId, kind, storageKey, name, mime, size, sha256],
    );
    return result.insertId;
  },
  async findById(id) {
    const [rows] = await pool.execute("SELECT * FROM attachments WHERE id = ? LIMIT 1", [id]);
    return rows[0] ?? null;
  },
  /** Pièces envoyées par cet utilisateur pour cette transaction, pas encore jointes à un message. */
  async findUnlinked(ids, { transactionId, userId, kind }, connection) {
    if (!ids.length) return [];
    const [rows] = await connection.query(
      "SELECT * FROM attachments WHERE id IN (?) AND transaction_id = ? AND uploaded_by = ? AND kind = ? AND event_id IS NULL",
      [ids, transactionId, userId, kind],
    );
    return rows;
  },
  async link(ids, eventId, connection) {
    if (!ids.length) return;
    await connection.query("UPDATE attachments SET event_id = ? WHERE id IN (?)", [eventId, ids]);
  },
  async decide(attachmentId, decision, connection) {
    await connection.execute("UPDATE attachments SET decision = ?, decided_at = UTC_TIMESTAMP() WHERE id = ?", [decision, attachmentId]);
  },
};
