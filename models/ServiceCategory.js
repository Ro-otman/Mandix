import pool from "../config/database.js";

export const ServiceCategory = {
  async listActive() {
    const [rows] = await pool.execute(
      "SELECT id, slug, name, description, icon FROM service_categories WHERE is_active = 1 ORDER BY sort_order, name"
    );
    return rows;
  },
};
