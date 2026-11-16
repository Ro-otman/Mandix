/**
 * Profil mandataire de l'utilisateur connecté (req.mandataire), chargé une seule fois par requête.
 * Utilisé par les pages de l'espace mandataire, la messagerie et les fichiers joints.
 */
import { MandataireProfile } from "../models/MandataireProfile.js";
import { forbidden } from "../utils/httpError.js";

export async function loadMandataire(req, res, next) {
  if (req.currentUser?.role !== "mandataire" || req.mandataire) return next();
  req.mandataire = await MandataireProfile.findByUserId(req.currentUser.id);
  if (!req.mandataire) return next(forbidden("Profil mandataire introuvable."));
  next();
}
