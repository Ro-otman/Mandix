/**
 * Statistiques réelles, calculées à partir des transactions (jamais des messages, qui sont éphémères).
 * Montants en euros (contre-valeur enregistrée à la saisie du montant). « 30 jours » = 30 derniers jours,
 * comparés aux 30 jours précédents.
 */
import pool from "../config/database.js";

const MONTHS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

/** Les 12 derniers mois (le mois en cours en dernier) : clés « AAAA-MM » et libellés. */
function lastTwelveMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getUTCMonth()] };
  });
}

const STATUS = (s) => (s === "completed" ? "completed" : s === "cancelled" ? "rejected" : "pending");
const money = (amount, currency) =>
  amount == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: ["XOF", "XAF", "GNF"].includes(currency) ? 0 : 2 }).format(amount);

async function windowStats(where, params, offsetDays) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(amount_eur), 0) AS volume, COUNT(DISTINCT client_id) AS clients,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, first_response_at))) AS response
       FROM transactions
      WHERE ${where} AND status = 'completed'
        AND completed_at >= UTC_TIMESTAMP() - INTERVAL ? DAY AND completed_at < UTC_TIMESTAMP() - INTERVAL ? DAY`,
    [...params, offsetDays + 30, offsetDays],
  );
  return {
    transactions: Number(row.transactions),
    volumeEur: Math.round(Number(row.volume)),
    clients: Number(row.clients),
    responseMinutes: row.response == null ? null : Number(row.response),
  };
}

/** Statistiques d'un mandataire (page Statistiques). */
export async function mandataireStats(mandataireId) {
  const months = lastTwelveMonths();
  const [monthly] = await pool.query(
    `SELECT DATE_FORMAT(completed_at, '%Y-%m') AS m, COUNT(*) AS n, COALESCE(SUM(amount_eur), 0) AS volume
       FROM transactions WHERE mandataire_id = ? AND status = 'completed' AND completed_at >= UTC_TIMESTAMP() - INTERVAL 13 MONTH
      GROUP BY m`,
    [mandataireId],
  );
  const byMonth = new Map(monthly.map((r) => [r.m, r]));
  const [byAccount] = await pool.query(
    `SELECT at.slug AS type, at.name, COUNT(*) AS transactions, COALESCE(SUM(t.amount_eur), 0) AS volume
       FROM transactions t JOIN mandataire_accounts a ON a.id = t.mandataire_account_id JOIN account_types at ON at.id = a.account_type_id
      WHERE t.mandataire_id = ? AND t.status = 'completed' AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
      GROUP BY at.slug, at.name ORDER BY volume DESC`,
    [mandataireId],
  );
  const [[proofs]] = await pool.query(
    `SELECT SUM(proof_validated_at IS NOT NULL) AS validated, COALESCE(SUM(proof_rejections), 0) AS rejected,
            SUM(status IN ('proof_review','proof_pending','credit_evidence_requested','credit_evidence_sent','under_verification')) AS pending
       FROM transactions WHERE mandataire_id = ?`,
    [mandataireId],
  );
  const [recent] = await pool.query(
    `SELECT t.created_at, t.status, t.amount, t.currency, at.slug AS type, at.name AS account, u.pseudo AS client
       FROM transactions t JOIN users u ON u.id = t.client_id
       JOIN mandataire_accounts a ON a.id = t.mandataire_account_id JOIN account_types at ON at.id = a.account_type_id
      WHERE t.mandataire_id = ? ORDER BY t.created_at DESC LIMIT 8`,
    [mandataireId],
  );
  return {
    monthly: months.map((m) => ({ label: m.label, value: Number(byMonth.get(m.key)?.n || 0) })),
    monthlyVolumeEur: months.map((m) => Math.round(Number(byMonth.get(m.key)?.volume || 0))),
    last30: await windowStats("mandataire_id = ?", [mandataireId], 0),
    previous30: await windowStats("mandataire_id = ?", [mandataireId], 30),
    byAccount: byAccount.map((r) => ({ type: r.type, name: r.name, transactions: Number(r.transactions), volumeEur: Math.round(Number(r.volume)) })),
    proofs: { validated: Number(proofs.validated || 0), rejected: Number(proofs.rejected || 0), pending: Number(proofs.pending || 0) },
    recent: recent.map((r) => ({ at: r.created_at, client: r.client, type: r.type, account: r.account, amount: money(r.amount == null ? null : Number(r.amount), r.currency || "EUR"), status: STATUS(r.status) })),
  };
}
