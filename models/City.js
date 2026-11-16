import pool from "../config/database.js";
import config from "../config/app.js";

export const City = {
  /** Villes actives du pays (Bénin par défaut), triées par nom. */
  async listActive(countryCode = config.defaultCountry) {
    const [rows] = await pool.execute(
      "SELECT id, name, slug, department FROM cities WHERE is_active = 1 AND country_code = ? ORDER BY name",
      [countryCode]
    );
    return rows;
  },
};
