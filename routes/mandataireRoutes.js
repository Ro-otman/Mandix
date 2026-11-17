/**
 * Espace mandataire, données réelles (l'accès est déjà réservé aux mandataires connectés : spaceRoutes.js).
 * Comptes de paiement (liste, ajout publié aussitôt avec coordonnées chiffrées, retrait), statistiques réelles,
 * profil public (présentation, pays, langues) et aperçu de la fiche vue par les clients.
 */
import { Router } from "express";
import * as accounts from "../services/accountService.js";
import { renderSpace } from "../services/spaceService.js";
import { ACCOUNT_TYPES, DEFAULT_RECEIVE } from "../content/account-types.js";
import { COUNTRIES, countryName } from "../content/countries.js";
import * as marketplace from "../services/marketplaceService.js";
import * as users from "../services/userService.js";
import { mandataireStats } from "../services/statsService.js";
import { LIMIT_TIERS, limitLabelFor } from "../utils/limits.js";
import { CURRENCIES } from "../content/currencies.js";
import * as fmt from "../utils/format.js";
import { CERTIFICATION_THRESHOLD } from "../utils/badges.js";
import { avatarSvg, defaultAvatarSpec } from "../utils/avatar.js";
import { notFound } from "../utils/httpError.js";
import pool from "../config/database.js";

const router = Router();
const context = (req) => ({ user: req.currentUser, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });


router.get(["/mandataire", "/mandataire/dashboard"], (req, res) => res.redirect("/mandataire/comptes"));

/** Profil du mandataire au format des vues (carte de profil, champs du formulaire). */
function proView(req) {
  const m = req.mandataire;
  let languages = [];
  try { languages = Array.isArray(m.languages) ? m.languages : JSON.parse(m.languages || "[]"); } catch { languages = []; }
  return {
    slug: m.slug, firstName: req.currentUser.pseudo, lastName: "", avatar: defaultAvatarSpec(m.slug),
    transactions: Number(m.transactions_count) || 0, bio: m.bio || "", country: m.country_code || "", languages,
    verified: Boolean(m.verified_at),
  };
}

// Fenêtre « Comprendre les niveaux » fermée : elle ne s'ouvrira plus d'elle-même.
router.post("/mandataire/niveaux/vu", async (req, res) => {
  await pool.execute("UPDATE mandataire_profiles SET levels_intro_seen_at = COALESCE(levels_intro_seen_at, UTC_TIMESTAMP()) WHERE id = ?", [req.mandataire.id]);
  res.json({ ok: true });
});

router.get("/mandataire/statistiques", async (req, res) => {
  const pro = proView(req);
  await renderSpace(req, res, "stats", "Statistiques", {
    stats: await mandataireStats(req.mandataire.id),
    pro,
    tiers: LIMIT_TIERS,
    limitText: limitLabelFor(pro.transactions),
    tierLabel: (t) => limitLabelFor(t.from),
    certificationThreshold: CERTIFICATION_THRESHOLD,
  });
});

router.get("/mandataire/profil", async (req, res) => {
  await renderSpace(req, res, "profile", "Mon profil", { pro: proView(req), countries: COUNTRIES, certificationThreshold: CERTIFICATION_THRESHOLD });
});
router.get("/mandataire/panneau/profil", (req, res) => {
  if (req.get("X-Mandix-Panel") !== "1") return res.redirect("/mandataire/profil");
  res.set({ "Cache-Control": "no-store", Vary: "X-Mandix-Panel" });
  res.render("mandataire/panel-profile", { layout: false, avatarSvg, pro: proView(req), countries: COUNTRIES, certificationThreshold: CERTIFICATION_THRESHOLD });
});
router.post("/mandataire/profil", async (req, res) => {
  await users.updateMandataireProfile(req.mandataire, req.currentUser, req.body || {}, context(req));
  req.flash("success", "Votre fiche publique est à jour.", "Profil enregistré");
  res.redirect(303, "/mandataire/profil");
});

// Aperçu de la fiche telle que la voient les clients (visible dès le premier compte publié).
router.get("/mandataire/apercu", async (req, res) => {
  const profile = await marketplace.getProfile(req.mandataire.slug);
  if (!profile) {
    req.flash("info", "Votre fiche devient visible dès votre premier compte publié.", "Fiche pas encore publique");
    return res.redirect(303, "/mandataire/comptes");
  }
  await renderSpace(req, res, "preview", "Ma fiche publique", { profile });
});
router.get("/mandataire/panneau/apercu", async (req, res, next) => {
  if (req.get("X-Mandix-Panel") !== "1") return res.redirect("/mandataire/apercu");
  const profile = await marketplace.getProfile(req.mandataire.slug);
  if (!profile) return next(notFound("Votre fiche devient visible dès votre premier compte publié."));
  res.set({ "Cache-Control": "no-store", Vary: "X-Mandix-Panel" });
  res.render("mandataire/panel-preview", { layout: false, avatarSvg, profile });
});

router.get("/mandataire/comptes", async (req, res) => {
  await renderSpace(req, res, "accounts", "Mes comptes", {
    accounts: await accounts.listAccounts(req.mandataire),
    accountTypes: ACCOUNT_TYPES,
    defaultReceive: DEFAULT_RECEIVE,
    countries: COUNTRIES,
    countryName,
    currencies: CURRENCIES,
    // Restriction en cours (vérification, ou sanction de 100 jours) : ajout de compte impossible, niveau bloqué.
    restrictedUntil: req.mandataire.restricted ? fmt.formatDateTime(req.mandataire.restricted_until) : null,
  });
});

router.post("/mandataire/comptes", async (req, res) => {
  const result = await accounts.addAccount(req.mandataire, req.body || {}, context(req));
  if (!result.ok) return res.status(422).json({ error: Object.values(result.errors)[0], errors: result.errors });
  res.status(201).json({ account: result.account });
});

router.post("/mandataire/comptes/:id/supprimer", async (req, res, next) => {
  const removed = await accounts.removeAccount(req.mandataire, req.params.id, context(req));
  if (!removed) return next(notFound("Ce compte n'existe pas ou a déjà été supprimé."));
  res.json({ ok: true });
});

export default router;
