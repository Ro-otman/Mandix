/**
 * Contrôle des rôles. À placer après requireAuth.
 * Le contrôle de propriété des ressources (ex. « cette conversation appartient-elle
 * à ce client ? ») se fait dans les services, au niveau de la requête SQL.
 */
import { forbidden } from "../utils/httpError.js";

export const ROLES = Object.freeze({ CLIENT: "client", MANDATAIRE: "mandataire", ADMIN: "admin" });

/** Page d'accueil de chaque espace (redirection après connexion). */
export const ROLE_HOME = Object.freeze({ client: "/client/dashboard", mandataire: "/mandataire/comptes", admin: "/admin/dashboard" });

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.currentUser?.role;
    if (role && allowedRoles.includes(role)) return next();
    return next(forbidden());
  };
}

/** Permissions fines des administrateurs (table admin_profiles). */
export function requireAdminPermission(...allowedAdminRoles) {
  return (req, res, next) => {
    const user = req.currentUser;
    if (user?.role !== ROLES.ADMIN) return next(forbidden());
    if (user.adminRole === "super_admin" || allowedAdminRoles.includes(user.adminRole)) return next();
    return next(forbidden());
  };
}
