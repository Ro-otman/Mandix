/**
 * Fichiers joints aux conversations (preuves de paiement, captures de transfert, preuves de non-crédit).
 *  - Type vérifié d'après le contenu réel du fichier (signature binaire), jamais d'après son nom ou l'en-tête
 *    envoyé par le navigateur : PNG, JPEG, WebP ou PDF uniquement, 5 Mo au maximum.
 *  - Chiffrés sur le disque (AES-256-GCM) dans storage/private, jamais servis en statique : ils ne sont lus
 *    qu'à travers une route qui vérifie que la personne participe à la conversation.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import config from "../config/app.js";
import { encryptBuffer, decryptBuffer } from "../utils/encryption.js";

const DIR = path.join(config.uploads.privateDir, "attachments");
export const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["application/pdf", "pdf"]]);

const fileContext = (storageKey) => `file:${storageKey}`;
const filePath = (storageKey) => {
  if (!/^[a-f0-9]{48}$/.test(storageKey)) throw new Error("Clé de fichier invalide.");
  return path.join(DIR, `${storageKey}.bin`);
};

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
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(filePath(storageKey), encryptBuffer(buffer, fileContext(storageKey)), { mode: 0o600 });
  return {
    ok: true,
    storageKey,
    mime: detected.mime,
    size: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    name: cleanName(originalName, ALLOWED.get(detected.mime)),
  };
}

export async function readFile(storageKey) {
  return decryptBuffer(await fs.readFile(filePath(storageKey)), fileContext(storageKey));
}

export async function deleteFile(storageKey) {
  await fs.rm(filePath(storageKey), { force: true });
}
