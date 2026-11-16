/** Profil public d'un mandataire (table mandataire_profiles), créé avec le compte. */
import pool from "../config/database.js";

/** Adresse de la fiche publique dérivée du pseudo : minuscules, chiffres et tirets. */
export function slugFromPseudo(pseudo) {
  const base = String(pseudo)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "mandataire";
}

export const MandataireProfile = {
  /** Crée le profil ; en cas de collision d'adresse (pseudos « Awa.D » et « awa-d »), ajoute un suffixe. */
  async createForUser(userId, pseudo, connection = pool) {
    const base = slugFromPseudo(pseudo);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        await connection.execute("INSERT INTO mandataire_profiles (user_id, slug) VALUES (?, ?)", [userId, slug]);
        return slug;
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY" || !String(error.message).includes("slug")) throw error;
      }
    }
    throw new Error("Impossible de générer une adresse de fiche unique.");
  },
};

/** Profil du mandataire connecté (identifiant interne, adresse publique, nombre de transactions). */
MandataireProfile.findByUserId = async function findByUserId(userId) {
  const [rows] = await pool.execute(
    "SELECT id, slug, country_code, bio, languages, transactions_count, rating_avg, rating_count, verified_at, certified_at FROM mandataire_profiles WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return rows[0] ?? null;
};
