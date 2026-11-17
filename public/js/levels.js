/**
 * Fenêtre « Comprendre les niveaux » (espace mandataire) :
 *  - ouverte automatiquement tant que le mandataire ne l'a pas fermée (attribut data-auto-open) ; à la fermeture,
 *    le serveur l'enregistre (elle ne s'ouvre plus d'elle-même, sur aucun appareil) ;
 *  - rouverte à la demande par les boutons data-modal-open="levels-dialog" (app.js) ;
 *  - « Copier le lien de ma fiche » : lien public de la fiche, à envoyer à ses clients actuels.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var dialog = document.getElementById("levels-dialog");
    if (!dialog || typeof dialog.showModal !== "function") return;

    if (dialog.hasAttribute("data-auto-open")) {
      dialog.addEventListener("close", function () {
        if (!dialog.hasAttribute("data-auto-open")) return;
        dialog.removeAttribute("data-auto-open");
        if (window.MC && MC.api) MC.api("/mandataire/niveaux/vu", { method: "POST", json: {} }).catch(function () {});
      });
      // Pas par-dessus une autre fenêtre déjà ouverte (ex. confirmation).
      if (!document.querySelector("dialog[open]")) dialog.showModal();
    }

    dialog.addEventListener("click", function (event) {
      var button = event.target.closest("[data-copy-link]");
      if (!button) return;
      var link = button.getAttribute("data-copy-link");
      var done = function (ok) {
        if (window.MC && MC.toast) MC.toast(ok ? "Lien de votre fiche copié : envoyez-le à vos clients." : "Copie impossible : sélectionnez le lien.", ok ? "success" : "warning");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
  });
})();
