/**
 * Connexion temps réel des espaces connectés (socket.io, même site, cookies HttpOnly) :
 *  - MC.realtime.request(nom, données) → Promise : action avec accusé de réception (messages, lecture…) ;
 *  - notifications reçues en direct : toast, compteurs du menu et de la barre du haut ;
 *  - aperçus de la liste des conversations mis à jour en direct.
 * Jeton d'accès expiré : renouvelé via /api/session (le jeton de rafraîchissement agit), puis reconnexion.
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  if (typeof window.io !== "function") return;

  // Espace de la page : avec une session client et une session mandataire dans le même navigateur, chaque
  // onglet se connecte avec la session de son espace.
  var spaceMeta = document.querySelector('meta[name="mandix-space"]');
  var space = MC.space || (spaceMeta ? spaceMeta.getAttribute("content") : null);
  var socket = window.io({ withCredentials: true, reconnectionDelayMax: 8000, auth: space ? { space: space } : {} });
  var renewing = false;
  var listeners = [];

  socket.on("connect_error", function (error) {
    if (!error || !error.data || error.data.code !== "auth" || renewing) return;
    renewing = true;
    var sessionHeaders = { Accept: "application/json" };
    if (space) sessionHeaders["X-Mandix-Space"] = space;
    window.fetch("/api/session", { credentials: "same-origin", headers: sessionHeaders })
      .then(function (response) {
        renewing = false;
        if (response.ok) socket.connect();
        else if (MC.toast) MC.toast("Votre session a expiré : reconnectez-vous pour continuer.", "warning", "Session expirée");
      })
      .catch(function () { renewing = false; });
  });

  // Après une coupure : les écrans abonnés se resynchronisent (salons rejoints de nouveau, messages manqués).
  socket.on("connect", function () { listeners.forEach(function (fn) { fn(); }); });

  MC.realtime = {
    socket: socket,
    /** Action avec accusé de réception ; rejet avec le message d'erreur du serveur. */
    request: function (name, payload) {
      return new Promise(function (resolve, reject) {
        socket.timeout(12000).emit(name, payload || {}, function (timeoutError, reply) {
          if (timeoutError) return reject(new Error("Connexion lente ou interrompue : réessayez dans un instant."));
          if (!reply || !reply.ok) return reject(new Error((reply && reply.error) || "Une erreur est survenue. Réessayez."));
          resolve(reply);
        });
      });
    },
    onReconnect: function (fn) { listeners.push(fn); },
  };

  /* ------------------------------------------------------------------ Compteurs */

  function setBadge(key, count) {
    count = Math.max(0, parseInt(count, 10) || 0);
    document.querySelectorAll('[data-live-badge="' + key + '"]').forEach(function (badge) {
      badge.textContent = count > 99 ? "99+" : String(count);
      var unit = key === "verifications" ? " à traiter" : key === "suggestions" ? " nouvelle" + (count > 1 ? "s" : "") : " non lu" + (count > 1 ? "s" : "");
      badge.setAttribute("aria-label", count + unit);
      badge.hidden = !count;
    });
    document.querySelectorAll('[data-live-dot="' + key + '"]').forEach(function (dot) { dot.hidden = !count; });
  }
  MC.setLiveBadge = setBadge;

  /**
   * Compteurs exacts calculés par le serveur (messages, notifications, vérifications). Ils arrivent en direct à
   * chaque changement, dans tous les onglets du compte ; ils sont redemandés à la connexion, à la reconnexion,
   * quand l'onglet redevient visible et au retour sur la page (bouton Précédent).
   */
  function applyBadges(counts) {
    if (!counts) return;
    ["messages", "notifications", "verifications", "suggestions"].forEach(function (key) {
      if (typeof counts[key] === "number") setBadge(key, counts[key]);
    });
  }
  function syncBadges() {
    if (!socket.connected) return;
    MC.realtime.request("badges:get").then(applyBadges).catch(function () {});
  }
  socket.on("badges", applyBadges);
  listeners.push(syncBadges);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") syncBadges();
  });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) { syncBadges(); refreshNotificationFeeds(); }
  });

  /** Flux de notifications affichés (page, panneau) rechargés ; le panneau fermé sera rechargé à l'ouverture. */
  function refreshNotificationFeeds() {
    if (MC.drawer && MC.drawer.forget) MC.drawer.forget("notifications");
    if (MC.refreshNotifications) MC.refreshNotifications();
  }

  /* ------------------------------------------------------------------ Notifications */

  socket.on("notification:new", function (payload) {
    if (!payload || !payload.notification) return;
    var n = payload.notification;
    // Conversation déjà ouverte à l'écran : pas de toast, la notification est lue aussitôt.
    var openConversation = n.link && window.location.pathname === n.link && document.visibilityState === "visible";
    if (openConversation) {
      socket.emit("notifications:read", { ids: [n.id] });
      setBadge("notifications", Math.max(0, (payload.unread || 1) - 1));
      return;
    }
    setBadge("notifications", payload.unread || 0);
    refreshNotificationFeeds(); // la nouvelle notification apparaît dans la liste affichée
    if (MC.toast) MC.toast(n.body || n.title, "info", n.title);
  });
  socket.on("notification:read", function (payload) {
    var unread = (payload && payload.unread) || 0;
    setBadge("notifications", unread);
    // Lue depuis un autre onglet ou appareil : la liste affichée ici est remise à jour.
    var shown = MC.notificationsShownUnread ? MC.notificationsShownUnread() : null;
    if (shown !== null && shown !== unread) refreshNotificationFeeds();
    else if (MC.drawer && MC.drawer.forget) MC.drawer.forget("notifications");
  });

  /* ------------------------------------------------------------------ Liste des conversations */

  /** Recharge les listes de conversations affichées (page Messages, panneau) depuis le serveur. */
  function refreshLists() {
    var holder = document.querySelector("[data-chat-role]");
    var lists = document.querySelectorAll("[data-chat-items]");
    if (!holder || !lists.length) return;
    var role = holder.getAttribute("data-chat-role");
    window.fetch("/" + role + "/panneau/messages", { credentials: "same-origin", headers: { "X-Mandix-Panel": "1" } })
      .then(function (response) { return response.ok ? response.text() : null; })
      .then(function (html) {
        if (!html) return;
        var fresh = new DOMParser().parseFromString(html, "text/html").querySelector("[data-chat-items]");
        if (!fresh) return;
        var activeSlug = document.querySelector("[data-chat-root]") && document.querySelector("[data-chat-root]").getAttribute("data-chat-slug");
        lists.forEach(function (list) {
          list.innerHTML = fresh.innerHTML;
          if (!activeSlug) return;
          var current = list.querySelector('[data-chat-item][data-chat-slug="' + activeSlug + '"] .chat__item');
          if (current) { current.classList.add("is-active"); current.setAttribute("aria-current", "page"); }
        });
      })
      .catch(function () {});
  }

  socket.on("conversation:update", function (update) {
    if (!update) return;
    var activeRoot = document.querySelector("[data-chat-root]");
    var isOpen = activeRoot && activeRoot.getAttribute("data-conversation-id") === update.conversationId;
    var mine = update.preview && update.preview.indexOf("Vous : ") === 0;
    var known = document.querySelectorAll('[data-chat-item][data-chat-key="' + update.key + '"]');
    // Nouvelle conversation : la liste affichée est rechargée (même rendu que le serveur).
    if (!known.length) refreshLists();
    known.forEach(function (item) {
      var preview = item.querySelector("[data-chat-item-preview]");
      var when = item.querySelector("[data-chat-when]");
      if (preview) preview.textContent = update.preview;
      if (when) when.textContent = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(update.at));
      if (!isOpen && !mine) {
        var badge = item.querySelector("[data-chat-item-unread]");
        if (badge) { badge.textContent = String((parseInt(badge.textContent, 10) || 0) + 1); badge.hidden = false; }
        var link = item.querySelector(".chat__item");
        if (link) link.classList.add("is-unread");
      }
      if (item.parentNode && item.parentNode.firstElementChild !== item) item.parentNode.prepend(item);
    });
    // Le compteur « Messages » du menu arrive juste après, exact, avec l'événement « badges ».
  });

  /** Conversation lue dans un autre onglet du même compte : ses non-lus disparaissent ici aussi. */
  socket.on("conversation:read", function (payload) {
    if (!payload || !payload.conversationId) return;
    document.querySelectorAll('[data-chat-item][data-chat-key="' + payload.conversationId + '"]').forEach(function (item) {
      var badge = item.querySelector("[data-chat-item-unread]");
      if (badge) { badge.textContent = "0"; badge.hidden = true; }
      var link = item.querySelector(".chat__item");
      if (link) link.classList.remove("is-unread");
    });
  });
})();
