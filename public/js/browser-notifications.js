/**
 * Notifications du navigateur (API Notification) pour les espaces client et mandataire : nouveau message,
 * nouvelle notification. Le navigateur les affiche avec le son de notification du système, comme Slack sur le web.
 *  - Autorisation : demandée une seule fois, par la fenêtre du navigateur, au premier clic dans l'espace
 *    (les navigateurs exigent une action de l'utilisateur). Refusée : rien d'autre ne s'affiche que le toast habituel.
 *  - Étiquette (tag) par conversation : le message et la notification qui l'accompagne, ou plusieurs onglets
 *    ouverts, ne produisent qu'une notification et un seul son.
 *  - Clic sur la notification : retour sur l'onglet, à la page concernée.
 * MC.browserNotify({ title, body, link, tag }) — appelé par public/js/realtime.js.
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  var supported = "Notification" in window && window.isSecureContext;
  var ASKED = "mandix:notifications:asked";
  var ICON = "/images/icon-192.png";

  function read(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* stockage indisponible */ } }

  /** Chemin interne uniquement (jamais d'adresse externe). */
  function internal(link) { return typeof link === "string" && link.charAt(0) === "/" && link.charAt(1) !== "/" ? link : null; }

  MC.browserNotify = function (options) {
    if (!supported || Notification.permission !== "granted" || !options || !options.title) return;
    try {
      var notification = new Notification(options.title, {
        body: options.body ? String(options.body).slice(0, 180) : "",
        icon: ICON,
        badge: ICON,
        tag: options.tag || undefined,
        renotify: false, // même étiquette : la notification est remplacée sans nouveau son
      });
      var link = internal(options.link);
      notification.onclick = function () {
        window.focus();
        if (link && window.location.pathname !== link) window.location.assign(link);
        notification.close();
      };
    } catch (e) {
      /* navigateur qui n'autorise les notifications que via un service worker (mobile) : toast seulement */
    }
  };

  // Première action de l'utilisateur dans l'espace : le navigateur propose d'autoriser les notifications (une fois).
  if (!supported || Notification.permission !== "default" || read(ASKED)) return;
  var ask = function () {
    window.removeEventListener("pointerdown", ask, true);
    window.removeEventListener("keydown", ask, true);
    write(ASKED, "1");
    try {
      var asked = Notification.requestPermission();
      if (asked && typeof asked.catch === "function") asked.catch(function () {});
    } catch (e) { /* ancienne signature (rappel) : sans effet */ }
  };
  window.addEventListener("pointerdown", ask, true);
  window.addEventListener("keydown", ask, true);
})();
