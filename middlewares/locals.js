/** Variables et helpers communs à toutes les vues. */
import config from "../config/app.js";
import * as fmt from "../utils/format.js";
import * as labels from "../utils/labels.js";
import { icon } from "../utils/icons.js";
import { photo } from "../utils/photos.js";
import { verifiedBadge, certifiedBadge } from "../utils/badges.js";
import { asset } from "../utils/assets.js";
import { flag } from "../utils/flags.js";
import { serviceLogo } from "../content/account-types.js";
import { publicMenu, dashboardMenus, roleLabels } from "../config/navigation.js";

export function viewLocals(req, res, next) {
  res.locals.appName = config.appName;
  res.locals.contact = config.contact; // e-mail et horaires du support
  res.locals.currentPath = req.path;
  res.locals.isProduction = config.isProduction;
  res.locals.isDemo = config.demoContent;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.fmt = fmt;
  res.locals.labels = labels;
  res.locals.icon = icon;
  res.locals.photo = photo;
  res.locals.asset = asset; // chemins des feuilles de style et scripts (construits en production)
  res.locals.verifiedBadge = verifiedBadge;
  res.locals.certifiedBadge = certifiedBadge;
  res.locals.flag = flag;
  res.locals.serviceLogo = serviceLogo;
  res.locals.publicMenu = publicMenu;
  res.locals.dashboardMenus = dashboardMenus;
  res.locals.roleLabels = roleLabels;
  res.locals.csrfToken = res.locals.csrfToken ?? "";
  res.locals.currentUser = res.locals.currentUser ?? null; // complété par loadCurrentUser
  res.locals.metaDescription =
    "Faites vos transactions d'un compte à l'autre (PayPal, Wise, virement, crypto…) avec un mandataire de confiance, suivies étape par étape dans une messagerie guidée.";

  /** Lien actif : correspondance exacte pour "/", par préfixe sinon. */
  res.locals.isActive = (href) => {
    const base = href.split("#")[0];
    if (href.includes("#")) return false;
    return base === "/" ? req.path === "/" : req.path === base || req.path.startsWith(`${base}/`);
  };

  // Messages flash (middlewares/flash.js, cookie signé) affichés en toasts.
  res.locals.flash = res.locals.flash ?? [];
  next();
}
