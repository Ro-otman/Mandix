/**
 * Fichiers joints aux conversations (preuves de paiement, captures de transfert, preuves de non-crédit).
 *  - Type vérifié d'après le contenu réel du fichier (signature binaire), jamais d'après son nom ou l'en-tête
 *    envoyé par le navigateur : PNG, JPEG, WebP ou PDF uniquement, 5 Mo au maximum.
 *  - Chiffrés (AES-256-GCM) et conservés dans la base (table attachment_blobs) : le dossier de l'application est
 *    recréé à chaque déploiement, un fichier écrit sur le disque y disparaîtrait. Jamais servis en statique : ils
 *    ne sont lus qu'à travers une route qui vérifie que la personne participe à la conversation.
 *  - Base pas encore migrée (table absente) : repli sur le disque (storage/private), comme avant ; les fichiers
 *    enregistrés ainsi restent lisibles.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import config from "../config/app.js";
import pool from "../config/database.js";
import { encryptBuffer, decryptBuffer } from "../utils/encryption.js";

const DIR = path.join(config.uploads.privateDir, "attachments");
export const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["application/pdf", "pdf"]]);

const fileContext = (storageKey) => `file:${storageKey}`;
const filePath = (storageKey) => {
  if (!/^[a-f0-9]{48}$/.test(storageKey)) throw new Error("Clé de fichier invalide.");
  return path.join(DIR, `${storageKey}.bin`);
};

/**
 * Table attachment_blobs disponible ? Vérifié une fois (puis de nouveau au plus toutes les minutes tant qu'elle
 * manque, le temps que la migration soit appliquée).
 */
let blobTable = { ok: false, checkedAt: 0 };
async function useDatabase() {
  if (blobTable.ok || Date.now() - blobTable.checkedAt < 60_000) return blobTable.ok;
  try {
    await pool.query("SELECT 1 FROM attachment_blobs LIMIT 0");
    blobTable = { ok: true, checkedAt: Date.now() };
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    blobTable = { ok: false, checkedAt: Date.now() };
    console.warn("[fichiers] table attachment_blobs absente (migration 015) : fichiers enregistrés sur le disque.");
  }
  return blobTable.ok;
}

/** Nom d'origine nettoyé (affichage uniquement) : sans chemin ni caractères de contrôle. */
function cleanName(name, ext) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim().slice(0, 120);
  return base || `fichier.${ext}`;
}

/**
 * Vérifie puis enregistre un fichier envoyé.
 * @returns {Promise<{ok: true, storageKey, mime, size, sha256, name} | {ok: false, error: string}>}
 */
export async function storeUpload(buffer, originalName) {
  if (!buffer?.length) return { ok: false, error: "Fichier vide." };
  if (buffer.length > MAX_BYTES) return { ok: false, error: "Fichier trop lourd : 5 Mo au maximum." };
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED.has(detected.mime)) return { ok: false, error: "Format non accepté : image PNG, JPEG, WebP ou document PDF." };
  const storageKey = crypto.randomBytes(24).toString("hex");
  const sealed = encryptBuffer(buffer, fileContext(storageKey));
  if (await useDatabase()) {
    await pool.execute("INSERT INTO attachment_blobs (storage_key, content) VALUES (?, ?)", [storageKey, sealed]);
  } else {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(filePath(storageKey), sealed, { mode: 0o600 });
  }
  return {
    ok: true,
    storageKey,
    mime: detected.mime,
    size: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    name: cleanName(originalName, ALLOWED.get(detected.mime)),
  };
}

/** Contenu déchiffré : dans la base, sinon sur le disque (fichiers enregistrés avant la migration 015). */
export async function readFile(storageKey) {
  const file = filePath(storageKey); // contrôle aussi le format de la clé
  if (await useDatabase()) {
    const [rows] = await pool.execute("SELECT content FROM attachment_blobs WHERE storage_key = ? LIMIT 1", [storageKey]);
    if (rows[0]) return decryptBuffer(rows[0].content, fileContext(storageKey));
  }
  return decryptBuffer(await fs.readFile(file), fileContext(storageKey));
}

/** Fichier lisible (base ou disque) ? Un fichier perdu (ancien déploiement) est signalé comme introuvable. */
export async function exists(storageKey) {
  const file = filePath(storageKey);
  if (await useDatabase()) {
    const [rows] = await pool.execute("SELECT 1 FROM attachment_blobs WHERE storage_key = ? LIMIT 1", [storageKey]);
    if (rows[0]) return true;
  }
  return fs.access(file).then(() => true, () => false);
}

export async function deleteFile(storageKey) {
  if (await useDatabase()) await pool.execute("DELETE FROM attachment_blobs WHERE storage_key = ?", [storageKey]);
  await fs.rm(filePath(storageKey), { force: true });
}
