/**
 * Lecture publique des mandataires — exclusivement via les vues v_public_* : seuls les mandataires actifs
 * ayant au moins un compte publié apparaissent ; les coordonnées de réception n'y figurent jamais.
 * Renvoie des objets au format attendu par services/marketplaceService.js (toCard / toProfile).
 */
import pool from "../config/database.js";
import { appreciationLabel } from "../content/reviews.js";
import { ratesOf } from "./MandataireAccount.js";

const parseLanguages = (value) => {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(value) : []; } catch { return []; }
};

function toMandataire(row, accounts = [], reviews = []) {
  return {
    id: Number(row.id),
    slug: row.slug,
    firstName: row.pseudo,
    lastName: "",
    country: row.country_code || null,
    bio: row.bio || "",
    languages: parseLanguages(row.languages),
    rating: row.rating_avg != null ? Number(row.rating_avg) : null,
    reviewsCount: Number(row.rating_count) || 0,
    transactions: Number(row.transactions_count) || 0, // transactions réussies
    rejected: Number(row.rejected_count) || 0, // transactions rejetées (statistiques du profil)
    levelTransactions: Number(row.level_transactions ?? row.transactions_count) || 0, // niveau bloqué si restreint
    verified: Number(row.is_verified) === 1, // badge bleu : seulement si un contrôle a réellement été fait
    joinedAt: row.member_since,
    lastSeenAt: row.last_seen_at,
    accounts,
    reviews,
  };
}

async function accountsByMandataire(ids) {
  if (!ids.length) return new Map();
  const [rows] = await pool.query(
    `SELECT id, mandataire_id, type_slug, country_code, currency, rate_symbol, rate_amount, rate_unit, fee_percent
       FROM v_public_mandataire_accounts
      WHERE mandataire_id IN (?) ORDER BY published_at, id`,
    [ids],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(Number(r.mandataire_id))) map.set(Number(r.mandataire_id), []);
    // Tarifs publics (prix sur 100, pourcentage) : affichés sur le profil ; jamais de coordonnées ici.
    map.get(Number(r.mandataire_id)).push({ id: Number(r.id), type: r.type_slug, country: r.country_code, currency: r.currency, ...ratesOf(r) });
  }
  return map;
}

const SELECT = `SELECT id, slug, pseudo, country_code, bio, languages, rating_avg, rating_count, transactions_count,
                       rejected_count, level_transactions, is_verified, last_seen_at, member_since FROM v_public_mandataires`;

export const PublicMandataire = {
  /** Mandataires publics (filtrés ensuite par le service de recherche). */
  async list(limit = 300) {
    const [rows] = await pool.query(`${SELECT} ORDER BY transactions_count DESC, rating_avg DESC, member_since LIMIT ?`, [limit]);
    const accounts = await accountsByMandataire(rows.map((r) => Number(r.id)));
    return rows.map((r) => toMandataire(r, accounts.get(Number(r.id)) || []));
  },

  async findBySlug(slug) {
    if (typeof slug !== "string" || !/^[a-z0-9-]{1,140}$/.test(slug)) return null;
    const [rows] = await pool.execute(`${SELECT} WHERE slug = ? LIMIT 1`, [slug]);
    if (!rows[0]) return null;
    const accounts = await accountsByMandataire([Number(rows[0].id)]);
    const [reviews] = await pool.execute(
      "SELECT rating, appreciation, created_at, author_pseudo FROM v_public_reviews WHERE mandataire_id = ? ORDER BY created_at DESC LIMIT 20",
      [rows[0].id],
    );
    return toMandataire(rows[0], accounts.get(Number(rows[0].id)) || [], reviews.map((r) => ({
      author: r.author_pseudo, rating: r.rating, comment: appreciationLabel(r.appreciation), date: r.created_at,
    })));
  },

  /** Derniers avis publiés (accueil). */
  async recentReviews(limit = 3) {
    const [rows] = await pool.query(
      `SELECT r.rating, r.appreciation, r.created_at, r.author_pseudo, m.pseudo AS mandataire_name, m.slug AS mandataire_slug
         FROM v_public_reviews r JOIN v_public_mandataires m ON m.id = r.mandataire_id
        ORDER BY r.created_at DESC LIMIT ?`,
      [Math.min(Math.max(Number(limit) || 3, 1), 12)],
    );
    return rows.map((r) => ({
      rating: r.rating, comment: appreciationLabel(r.appreciation), author_display_name: r.author_pseudo,
      mandataire_name: r.mandataire_name, mandataire_slug: r.mandataire_slug, created_at: r.created_at,
    }));
  },
};
