/**
 * Comptes de paiement des mandataires (table mandataire_accounts). Les coordonnées de réception sont chiffrées
 * (AES-256-GCM, contexte lié au mandataire) et ne sont déchiffrées que pour leur propriétaire, ou au moment
 * où il les envoie dans une conversation.
 */
import pool from "../config/database.js";
import { encryptText, decryptText } from "../utils/encryption.js";
import { encodeReceive, decodeReceive, receiveText, rateLabel, feeLabel } from "../utils/accountRates.js";

const ctx = (mandataireId) => `account:${mandataireId}`;

let typeCache = null;
/** Catalogue des comptes : slug → { id, name } (table account_types, mis en cache). */
export async function accountTypeIds() {
  if (typeCache) return typeCache;
  const [rows] = await pool.query("SELECT id, slug, name FROM account_types WHERE is_active = 1");
  typeCache = new Map(rows.map((r) => [r.slug, { id: r.id, name: r.name }]));
  return typeCache;
}

/** Tarifs publics d'un compte (« Prix sur 100 », « Pourcentage »), avec leurs libellés d'affichage. */
export function ratesOf(row) {
  const rate = row.rate_symbol ? { symbol: row.rate_symbol, amount: Number(row.rate_amount), unit: row.rate_unit } : null;
  const feePercent = row.fee_percent != null ? Number(row.fee_percent) : null;
  return { rate, rateLabel: rateLabel(rate), feePercent, feeLabel: feeLabel(feePercent) };
}

function receiveOf(row) {
  const details = decodeReceive(decryptText(row.receive_details_enc, ctx(row.mandataire_id)));
  return {
    receive: receiveText(details),
    receiveHolder: details.holder,
    receiveEmail: details.email,
    receiveRib: details.rib,
    receiveBic: details.bic,
    receiveAddress: details.address,
  };
}

const toAccount = (row, withReceive) => ({
  id: Number(row.id),
  type: row.slug,
  typeName: row.type_name,
  country: row.country_code,
  currency: row.currency,
  bank: row.bank_name || "",
  publishedAt: row.published_at,
  ...ratesOf(row),
  ...(withReceive ? receiveOf(row) : {}),
});

const SELECT = `SELECT a.id, a.mandataire_id, a.country_code, a.currency, a.bank_name, a.receive_details_enc, a.published_at,
                       a.rate_symbol, a.rate_amount, a.rate_unit, a.fee_percent,
                       t.slug, t.name AS type_name
                  FROM mandataire_accounts a JOIN account_types t ON t.id = a.account_type_id`;

export const MandataireAccount = {
  /** Comptes publiés d'un mandataire, avec coordonnées (propriétaire uniquement). */
  async listForOwner(mandataireId) {
    const [rows] = await pool.execute(`${SELECT} WHERE a.mandataire_id = ? AND a.status = 'published' ORDER BY a.published_at DESC`, [mandataireId]);
    return rows.map((r) => toAccount(r, true));
  },

  /** Comptes publiés, sans coordonnées (vue publique, demande d'un client). */
  async listPublic(mandataireId) {
    const [rows] = await pool.execute(`${SELECT} WHERE a.mandataire_id = ? AND a.status = 'published' ORDER BY t.sort_order, a.published_at`, [mandataireId]);
    return rows.map((r) => toAccount(r, false));
  },

  /** Un compte publié d'un mandataire ; avec ses coordonnées si withReceive. */
  async findPublished(mandataireId, accountId, { withReceive = false } = {}) {
    const [rows] = await pool.execute(`${SELECT} WHERE a.mandataire_id = ? AND a.id = ? AND a.status = 'published' LIMIT 1`, [mandataireId, accountId]);
    return rows[0] ? toAccount(rows[0], withReceive) : null;
  },

  /** receive : { holder, email, rib, bic, address } (chiffrés) ; rate : { symbol, amount, unit } ou null ; feePercent : nombre ou null. */
  async create({ mandataireId, typeId, country, currency, bank, receive, rate = null, feePercent = null }) {
    const [result] = await pool.execute(
      `INSERT INTO mandataire_accounts
         (mandataire_id, account_type_id, country_code, currency, bank_name, rate_symbol, rate_amount, rate_unit, fee_percent, receive_details_enc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mandataireId, typeId, country, currency, bank || null,
        rate?.symbol ?? null, rate?.amount ?? null, rate?.unit ?? null, feePercent,
        encryptText(encodeReceive(receive), ctx(mandataireId)),
      ],
    );
    return result.insertId;
  },

  /** Retrait logique : les transactions passées gardent leur référence au compte. */
  async remove(mandataireId, accountId) {
    const [result] = await pool.execute(
      "UPDATE mandataire_accounts SET status = 'removed', removed_at = UTC_TIMESTAMP() WHERE id = ? AND mandataire_id = ? AND status = 'published'",
      [accountId, mandataireId],
    );
    return result.affectedRows === 1;
  },
};
