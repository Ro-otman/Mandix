/** Menus de navigation (libellé, chemin, icône Lucide). */

export const publicMenu = [
  { label: "Accueil", href: "/", icon: "house" },
  { label: "Trouver un mandataire", href: "/mandataires", icon: "search" },
  { label: "Comment ça marche", href: "/comment-ca-marche", icon: "list-checks" },
  { label: "À propos", href: "/a-propos", icon: "info" },
];

// badgeKey : compteur affiché à côté du lien (res.locals.menuBadges, fourni par la route).
// drawer : le lien ouvre aussi un panneau latéral sans recharger la page (public/js/drawer.js, espace client).
export const dashboardMenus = {
  client: [
    { label: "Accueil", href: "/client/dashboard", icon: "house" },
    { label: "Messages", href: "/client/messages", icon: "message-circle", badgeKey: "messages", drawer: "messages" },
    { label: "Notifications", href: "/client/notifications", icon: "bell", badgeKey: "notifications", drawer: "notifications" },
    { label: "Mon profil", href: "/client/profil", icon: "user", drawer: "myprofile" },
    { label: "Paramètres", href: "/client/parametres", icon: "settings" },
    { label: "Suggestions", href: "/client/suggestions", icon: "lightbulb" },
  ],
  mandataire: [
    { label: "Mes comptes", href: "/mandataire/comptes", icon: "wallet" },
    { label: "Statistiques", href: "/mandataire/statistiques", icon: "chart-column" },
    { label: "Messages", href: "/mandataire/messages", icon: "message-circle", badgeKey: "messages", drawer: "messages" },
    { label: "Notifications", href: "/mandataire/notifications", icon: "bell", badgeKey: "notifications", drawer: "notifications" },
    { label: "Mon profil", href: "/mandataire/profil", icon: "user-check", drawer: "myprofile" },
    { label: "Suggestions", href: "/mandataire/suggestions", icon: "lightbulb" },
  ],
  admin: [
    { label: "Accueil", href: "/admin/dashboard", icon: "house" },
    { label: "Mandataires", href: "/admin/mandataires", icon: "user-check" },
    { label: "Clients", href: "/admin/clients", icon: "users" },
    { label: "Vérifications", href: "/admin/verifications", icon: "scale", badgeKey: "verifications" },
    { label: "Suggestions", href: "/admin/suggestions", icon: "lightbulb", badgeKey: "suggestions" },
  ],
};

export const roleLabels = { client: "Espace client", mandataire: "Espace professionnel", admin: "Administration" };
