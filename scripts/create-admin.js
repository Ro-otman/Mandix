/**
 * Crée un compte administrateur (les administrateurs ne peuvent pas s'inscrire depuis le site).
 * Usage : npm run admin:create -- --email admin@exemple.com --prenom Awa --nom Dossou [--role super_admin|moderateur]
 * Un mot de passe robuste est généré et affiché UNE seule fois : notez-le, puis changez-le via « Mot de passe oublié ».
 */
import { parseArgs } from "node:util";
import pool, { withTransaction } from "../config/database.js";
import { hashPassword } from "../utils/password.js";
import { randomToken, uuid } from "../utils/crypto.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    prenom: { type: "string" },
    nom: { type: "string" },
    role: { type: "string", default: "super_admin" },
  },
});

const email = (values.email || "").trim().toLowerCase();
const firstName = (values.prenom || "").trim();
const lastName = (values.nom || "").trim();
const adminRole = values.role;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName || !["super_admin", "moderateur"].includes(adminRole)) {
  console.error("Usage : npm run admin:create -- --email admin@exemple.com --prenom Awa --nom Dossou [--role super_admin|moderateur]");
  process.exit(1);
}

const password = `${randomToken(15)}-${Math.floor(10 + Math.random() * 89)}`;

try {
  const passwordHash = await hashPassword(password);
  await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO users (public_id, role, email, password_hash, first_name, last_name, status, email_verified_at, terms_accepted_at, privacy_accepted_at)
       VALUES (?, 'admin', ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [uuid(), email, passwordHash, firstName.slice(0, 80), lastName.slice(0, 80)],
    );
    await connection.execute("INSERT INTO admin_profiles (user_id, admin_role) VALUES (?, ?)", [result.insertId, adminRole]);
    await connection.execute(
      "INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id) VALUES (NULL, 'cli', 'admin.create', 'user', ?)",
      [result.insertId],
    );
  });
  console.info(`Administrateur créé : ${email} (${adminRole}).`);
  console.info(`Mot de passe provisoire (affiché une seule fois) : ${password}`);
} catch (error) {
  console.error(error.code === "ER_DUP_ENTRY" ? "Cette adresse e-mail est déjà utilisée." : `Échec : ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
