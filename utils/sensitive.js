/**
 * Refus des informations qui ne doivent JAMAIS transiter par Mandix : numéro de carte, phrase de récupération
 * d'un portefeuille, clé privée, mot de passe ou code secret. Contrôle appliqué côté serveur (les mêmes règles
 * existent dans les scripts du navigateur, pour le confort uniquement).
 * @returns {string|null} message d'erreur, ou null si le texte est acceptable
 */
export function sensitiveReason(value) {
  const text = String(value || "").trim();
  const compact = text.replace(/[\s-]/g, "");
  if (/^\d{13,19}$/.test(compact)) return "Ceci ressemble à un numéro de carte : indiquez plutôt l'IBAN ou l'identifiant de réception.";
  if (/^(?:[a-z]+\s+){11,23}[a-z]+$/i.test(text)) return "Ceci ressemble à une phrase de récupération : ne la communiquez jamais.";
  if (/-----BEGIN|PRIVATE KEY|\bxprv[0-9A-Za-z]{20,}/i.test(text)) return "Ne communiquez jamais de clé privée.";
  if (/\b(mot de passe|password|passwd|mdp|code pin|code secret|cvv|cvc)\b/i.test(text)) return "Ne communiquez jamais de mot de passe ni de code secret.";
  return null;
}
