import * as marketplace from "../services/marketplaceService.js";
import { countryIn, countryName } from "../content/countries.js";
import { accountTypeName } from "../content/account-types.js";
import { notFound } from "../utils/httpError.js";

export async function listMandataires(req, res) {
  const filters = marketplace.readFilters(req.query);
  const results = await marketplace.search(filters);
  const countries = marketplace.listCountries();

  res.render("public/marketplace", {
    title: "Trouver un mandataire",
    extraStyles: ["marketplace", "spaces"],
    publicDrawer: true,
    filters,
    results,
    countries,
    accountTypes: marketplace.listAccountTypes(),
    banks: marketplace.listBanks(),
    languages: marketplace.listLanguages(),
    activeFilterCount: marketplace.ACTIVE_FILTER_KEYS.filter((k) => filters[k]).length,
    countryLabel: filters.pays ? countryName(filters.pays) : null,
    countryPlace: filters.pays ? countryIn(filters.pays) : null,
    typeLabel: filters.type ? accountTypeName(filters.type) : null,
    totalCountries: new Set(results.map((r) => r.countryCode)).size,
  });
}

/** Fiche publique : la même que dans l'espace client (views/partials/dash/mandataire-sheet.ejs, mode « public »). */
export async function showMandataire(req, res, next) {
  const profile = await marketplace.getProfile(req.params.slug);
  if (!profile) return next(notFound("Ce profil n'existe pas ou n'est plus disponible."));
  res.render("public/mandataire", {
    title: `${profile.fullName} — Mandataire`,
    extraStyles: ["marketplace", "spaces"],
    publicDrawer: true,
    profile,
  });
}

/** Fiche dans le panneau latéral des pages publiques (fragment ; accès direct : page complète). */
export async function showMandatairePanel(req, res, next) {
  if (req.get("X-Mandix-Panel") !== "1") return res.redirect(`/mandataires/${encodeURIComponent(req.params.slug)}`);
  const profile = await marketplace.getProfile(req.params.slug);
  if (!profile) return next(notFound("Ce profil n'existe pas ou n'est plus disponible."));
  res.set("Vary", "X-Mandix-Panel");
  res.render("public/panel-profile", { layout: false, profile });
}
