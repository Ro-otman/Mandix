/**
 * Espace administrateur, données réelles : vue d'ensemble, mandataires, clients, vérifications.
 * Les coordonnées de réception ne sont jamais montrées (ni aux administrateurs). Les actions (suspension,
 * réactivation, décisions) sont tracées dans le journal d'audit.
 */
import pool, { withTransaction } from "../config/database.js";
import { AuthSession } from "../models/AuthSession.js";
import { AuditLog } from "../models/Security.js";
import { countryName } from "../content/countries.js";
import { defaultAvatarSpec } from "../utils/avatar.js";

const MONTHS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const twelveMonths = () => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getUTCMonth()] };
  });
};
const money = (amount, currency) => (amount == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR", maximumFractionDigits: ["XOF", "XAF", "GNF"].includes(currency) ? 0 : 2 }).format(amount));
const TX_STATUS = (s) => (s === "completed" ? "completed" : s === "cancelled" || s === "rejected" ? "rejected" : "pending");
const ACCOUNT_STATUS = (s) => (s === "suspended" ? "suspended" : s === "active" ? "active" : "pending");
const like = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/* ------------------------------------------------------------------ Vue d'ensemble */

async function window30(offset) {
  const [[tx]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_eur), 0) AS volume, COUNT(DISTINCT mandataire_id) AS pros
       FROM transactions WHERE status = 'completed'
        AND completed_at >= UTC_TIMESTAMP() - INTERVAL ? DAY AND completed_at < UTC_TIMESTAMP() - INTERVAL ? DAY`,
    [offset + 30, offset],
  );
  const [[clients]] = await pool.query(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'client' AND deleted_at IS NULL
        AND created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY`,
    [offset + 30, offset],
  );
  return { volumeEur: Math.round(Number(tx.volume)), transactions: Number(tx.n), newClients: Number(clients.n), activeMandataires: Number(tx.pros) };
}

async function recentTransactions(limit = 8) {
  const [rows] = await pool.query(
    `SELECT t.created_at, t.status, t.amount, t.currency, at.slug AS type, at.name AS account, u.pseudo AS client, pu.pseudo AS pro, mp.slug
       FROM transactions t
       JOIN users u ON u.id = t.client_id
       JOIN mandataire_profiles mp ON mp.id = t.mandataire_id JOIN users pu ON pu.id = mp.user_id
       JOIN mandataire_accounts a ON a.id = t.mandataire_account_id JOIN account_types at ON at.id = a.account_type_id
      ORDER BY t.created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ at: r.created_at, client: r.client, pro: r.pro, slug: r.slug, type: r.type, account: r.account, amount: money(r.amount == null ? null : Number(r.amount), r.currency), status: TX_STATUS(r.status) }));
}

export async function dashboard() {
  const months = twelveMonths();
  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'client' AND deleted_at IS NULL) AS clients,
            (SELECT COUNT(*) FROM users WHERE role = 'mandataire' AND deleted_at IS NULL) AS mandataires,
            (SELECT COUNT(DISTINCT country_code) FROM mandataire_accounts WHERE status = 'published') AS countries,
            (SELECT COUNT(*) FROM transactions WHERE status NOT IN ('completed','rejected','cancelled')) AS open_transactions`,
  );
  const [monthly] = await pool.query(
    `SELECT DATE_FORMAT(completed_at, '%Y-%m') AS m, COUNT(*) AS n, COALESCE(SUM(amount_eur), 0) AS volume
       FROM transactions WHERE status = 'completed' AND completed_at >= UTC_TIMESTAMP() - INTERVAL 13 MONTH GROUP BY m`,
  );
  const [signups] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS m, COUNT(*) AS n FROM users
      WHERE role IN ('client','mandataire') AND created_at >= UTC_TIMESTAMP() - INTERVAL 13 MONTH GROUP BY m`,
  );
  const byMonth = new Map(monthly.map((r) => [r.m, r]));
  const bySignup = new Map(signups.map((r) => [r.m, Number(r.n)]));
  const [byAccount] = await pool.query(
    `SELECT at.slug AS type, at.name, COUNT(*) AS transactions, COALESCE(SUM(t.amount_eur), 0) AS volume
       FROM transactions t JOIN mandataire_accounts a ON a.id = t.mandataire_account_id JOIN account_types at ON at.id = a.account_type_id
      WHERE t.status = 'completed' AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
      GROUP BY at.slug, at.name ORDER BY volume DESC LIMIT 6`,
  );
  return {
    stats: {
      clients: Number(counts.clients), mandataires: Number(counts.mandataires), countries: Number(counts.countries),
      conversationsActive: Number(counts.open_transactions),
      last30: await window30(0), previous30: await window30(30),
    },
    series: {
      transactions: months.map((m) => ({ label: m.label, value: Number(byMonth.get(m.key)?.n || 0) })),
      volumeEur: months.map((m) => Math.round(Number(byMonth.get(m.key)?.volume || 0))),
      signups: months.map((m) => ({ label: m.label, value: bySignup.get(m.key) || 0 })),
    },
    byAccount: byAccount.map((r) => ({ type: r.type, name: r.name, transactions: Number(r.transactions), volumeEur: Math.round(Number(r.volume)) })),
    recent: await recentTransactions(),
    top: (await listMandataires({ statut: "active" })).sort((a, b) => b.transactions - a.transactions).slice(0, 5),
  };
}

/* ------------------------------------------------------------------ Mandataires */

export async function listMandataires({ statut = "", q = "" } = {}) {
  const where = ["u.deleted_at IS NULL"];
  const params = [];
  if (statut === "active") where.push("u.status = 'active'");
  if (statut === "suspended") where.push("u.status = 'suspended'");
  if (q) { where.push("(u.pseudo LIKE ? OR u.email LIKE ? OR mp.country_code = ?)"); params.push(like(q), like(q), String(q).toUpperCase().slice(0, 2)); }
  const [rows] = await pool.query(
    `SELECT mp.id, mp.slug, mp.country_code, mp.transactions_count, mp.rating_avg, mp.verified_at, u.public_id, u.pseudo, u.email, u.status, u.created_at,
            (SELECT GROUP_CONCAT(DISTINCT at.slug ORDER BY at.sort_order) FROM mandataire_accounts a JOIN account_types at ON at.id = a.account_type_id
              WHERE a.mandataire_id = mp.id AND a.status = 'published') AS types
       FROM mandataire_profiles mp JOIN users u ON u.id = mp.user_id
      WHERE ${where.join(" AND ")} ORDER BY mp.transactions_count DESC, u.created_at DESC LIMIT 300`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id), userPublicId: r.public_id, slug: r.slug, firstName: r.pseudo, lastName: "", email: r.email,
    country: r.country_code || "", countryName: r.country_code ? countryName(r.country_code) : "Pays non renseigné",
    status: ACCOUNT_STATUS(r.status), transactions: Number(r.transactions_count) || 0,
    accountTypes: r.types ? r.types.split(",") : [], rating: r.rating_avg != null ? Number(r.rating_avg) : null,
    avatar: defaultAvatarSpec(r.slug), joined: r.created_at, verified: Boolean(r.verified_at),
  }));
}

export async function mandataireDetail(slug) {
  const m = (await listMandataires({})).find((item) => item.slug === slug);
  if (!m) return null;
  const [accounts] = await pool.query(
    `SELECT at.slug AS type, a.country_code, a.currency, a.bank_name FROM mandataire_accounts a JOIN account_types at ON at.id = a.account_type_id
      WHERE a.mandataire_id = ? AND a.status = 'published' ORDER BY a.published_at`,
    [m.id],
  );
  return { m, accounts: accounts.map((a) => ({ type: a.type, country: a.country_code, countryName: countryName(a.country_code), currency: a.currency, bank: a.bank_name || "" })) };
}

/* ------------------------------------------------------------------ Clients */

export const CLIENT_SORTS = {
  transactions: { label: "Transactions", order: "transactions DESC" },
  volume: { label: "Volume", order: "volume DESC" },
  conversations: { label: "Conversations", order: "conversations DESC" },
  activite: { label: "Dernière activité", order: "u.last_seen_at IS NULL, u.last_seen_at DESC" },
  inscription: { label: "Inscription récente", order: "u.created_at DESC" },
};

export async function listClients({ tri = "transactions", q = "" } = {}) {
  const sort = CLIENT_SORTS[tri] ?? CLIENT_SORTS.transactions;
  const where = ["u.role = 'client'", "u.deleted_at IS NULL"];
  const params = [];
  if (q) { where.push("(u.pseudo LIKE ? OR u.email LIKE ?)"); params.push(like(q), like(q)); }
  const [rows] = await pool.query(
    `SELECT u.public_id, u.pseudo, u.email, u.status, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM transactions t WHERE t.client_id = u.id AND t.status = 'completed') AS transactions,
            (SELECT COALESCE(SUM(t.amount_eur), 0) FROM transactions t WHERE t.client_id = u.id AND t.status = 'completed') AS volume,
            (SELECT COUNT(*) FROM conversations c WHERE c.client_id = u.id) AS conversations
       FROM users u WHERE ${where.join(" AND ")} ORDER BY ${sort.order}, u.id DESC LIMIT 300`,
    params,
  );
  return rows.map((r) => ({
    id: r.public_id, name: r.pseudo, email: r.email, status: ACCOUNT_STATUS(r.status),
    transactions: Number(r.transactions), volumeEur: Math.round(Number(r.volume)), conversations: Number(r.conversations),
    joined: r.created_at, lastActive: r.last_seen_at || r.created_at,
  }));
}

/* ------------------------------------------------------------------ Suspension / réactivation */

/**
 * Suspend (connexion impossible, sessions fermées, fiche retirée des pages publiques) ou réactive un compte
 * client ou mandataire. Un administrateur ne peut pas être suspendu d'ici.
 */
export async function setAccountStatus(admin, userPublicId, action, { ip = null, userAgent = null } = {}) {
  if (!["suspend", "reactivate"].includes(action)) return { ok: false, error: "Action inconnue." };
  if (typeof userPublicId !== "string" || !/^[0-9a-f-]{36}$/.test(userPublicId)) return { ok: false, error: "Compte introuvable." };
  return withTransaction(async (connection) => {
    const [[user]] = await connection.execute(
      "SELECT id, role, status, pseudo FROM users WHERE public_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [userPublicId],
    );
    if (!user || user.role === "admin") return { ok: false, error: "Compte introuvable." };
    if (action === "suspend" && user.status !== "active") return { ok: false, error: "Ce compte n'est pas actif." };
    if (action === "reactivate" && user.status !== "suspended") return { ok: false, error: "Ce compte n'est pas suspendu." };
    const status = action === "suspend" ? "suspended" : "active";
    await connection.execute("UPDATE users SET status = ?, suspension_reason = ? WHERE id = ?", [status, action === "suspend" ? "Suspendu par l'équipe Mandix" : null, user.id]);
    if (action === "suspend") await AuthSession.revokeAllForUser(user.id, "account_suspended", connection);
    await AuditLog.record({ actorUserId: admin.id, actorRole: "admin", action: `${user.role}.${action}`, entityType: "user", entityId: user.id, ip, userAgent }, connection);
    return { ok: true, pseudo: user.pseudo, role: user.role, status };
  });
}

/* ------------------------------------------------------------------ Vérifications */

export async function listVerifications() {
  const [rows] = await pool.query(
    `SELECT v.reference, v.status, v.created_at, v.decided_at, v.transaction_id, v.evidence_due_at, v.decision_note,
            t.status AS tx_status, t.proof_rejections, t.proof_pending_since, t.amount, t.currency,
            at.slug AS type, at.name AS account, cu.pseudo AS client, pu.pseudo AS pro, mp.slug
       FROM verification_requests v
       JOIN transactions t ON t.id = v.transaction_id
       JOIN mandataire_accounts a ON a.id = t.mandataire_account_id JOIN account_types at ON at.id = a.account_type_id
       JOIN users cu ON cu.id = v.client_id
       JOIN mandataire_profiles mp ON mp.id = v.mandataire_id JOIN users pu ON pu.id = mp.user_id
      ORDER BY v.status = 'open' DESC, v.created_at DESC LIMIT 100`,
  );
  const ids = rows.map((r) => r.transaction_id);
  // Preuves du refus (envoyées pour la vérification) et preuves jointes à chaque « Rejeté » (vues par le client).
  const files = { credit_evidence: new Map(), rejection_proof: new Map() };
  if (ids.length) {
    const [evidence] = await pool.query(
      "SELECT id, transaction_id, kind, original_name, mime_type, size_bytes FROM attachments WHERE kind IN ('credit_evidence','rejection_proof') AND event_id IS NOT NULL AND transaction_id IN (?) ORDER BY id",
      [ids],
    );
    for (const f of evidence) {
      const byTx = files[f.kind];
      if (!byTx.has(f.transaction_id)) byTx.set(f.transaction_id, []);
      byTx.get(f.transaction_id).push({ name: f.original_name, type: f.mime_type, size: f.size_bytes, url: `/fichiers/${f.id}`, preview: f.mime_type.startsWith("image/") ? `/fichiers/${f.id}` : null });
    }
  }
  return rows.map((r) => ({
    ref: r.reference, status: r.status, client: r.client, pro: r.pro, slug: r.slug, type: r.type, account: r.account,
    amount: money(r.amount == null ? null : Number(r.amount), r.currency), pendingSince: r.proof_pending_since, requestedAt: r.created_at,
    decidedAt: r.decided_at, evidence: files.credit_evidence.get(r.transaction_id) || [],
    rejectionProofs: files.rejection_proof.get(r.transaction_id) || [],
    evidenceDueAt: r.evidence_due_at, rejections: Number(r.proof_rejections) || 0, note: r.decision_note,
  }));
}
