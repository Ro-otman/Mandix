/**
 * Notifications : filtres instantanés, « marquer comme lu » (une ou toutes), compteurs synchronisés
 * (pastille de l'en-tête, onglet « Non lues », badge du menu latéral, point de la barre supérieure).
 * MC.initNotifications(root) s'applique à un flux [data-nfeed] : la page Notifications l'appelle au
 * chargement, le panneau latéral (public/js/drawer.js) après insertion.
 * État « lu » enregistré par le serveur (POST /api/notifications/lu, jeton CSRF) ; compteurs du menu mis à jour.
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  if (MC.initNotifications) return; // script déjà chargé

  var EMPTY = {
    unread: ["Vous êtes à jour", "Aucune notification non lue."],
    other: ["Rien pour le moment", "Aucune notification dans cette catégorie."],
  };

  MC.initNotifications = function (feed) {
    if (!feed || feed.getAttribute("data-nfeed-ready")) return;
    feed.setAttribute("data-nfeed-ready", "1");

    var items = Array.prototype.slice.call(feed.querySelectorAll("[data-nitem]"));
    var groups = Array.prototype.slice.call(feed.querySelectorAll("[data-nfeed-group]"));
    var tabs = Array.prototype.slice.call(feed.querySelectorAll("[data-nfeed-tab]"));
    var empty = feed.querySelector("[data-nfeed-empty]");
    var readAll = feed.querySelector("[data-nfeed-readall]");
    var filter = "all";
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function isUnread(item) { return item.hasAttribute("data-unread"); }

    function matches(item) {
      if (filter === "all") return true;
      if (filter === "unread") return isUnread(item);
      return item.getAttribute("data-kind") === filter;
    }

    /** Entrée en cascade des éléments visibles (délai via CSSOM, la CSP interdit les styles en ligne). */
    function animateIn(list) {
      if (reduceMotion) return;
      list.forEach(function (item, index) {
        item.classList.remove("is-entering");
        void item.offsetWidth; // relance l'animation
        item.style.setProperty("--i", String(Math.min(index, 10)));
        item.classList.add("is-entering");
      });
    }

    function render(animate) {
      var visible = [];
      items.forEach(function (item) {
        var show = matches(item);
        item.hidden = !show;
        item.classList.remove("is-leaving");
        if (show) visible.push(item);
      });
      groups.forEach(function (group) {
        group.hidden = !group.querySelector("[data-nitem]:not([hidden])");
      });
      empty.hidden = visible.length > 0;
      if (!visible.length) {
        var text = filter === "unread" || filter === "all" ? EMPTY.unread : EMPTY.other;
        empty.querySelector("[data-nfeed-empty-title]").textContent = text[0];
        empty.querySelector("[data-nfeed-empty-text]").textContent = text[1];
      }
      if (animate) animateIn(visible);
    }

    function syncCounters() {
      var count = items.filter(isUnread).length;

      var pill = feed.querySelector("[data-nfeed-new]");
      if (pill) {
        pill.hidden = count === 0;
        pill.querySelector("[data-nfeed-unread]").textContent = String(count);
        pill.querySelector("[data-nfeed-plural]").textContent = count > 1 ? "s" : "";
      }
      var tabCount = feed.querySelector("[data-nfeed-unread-tab]");
      if (tabCount) {
        tabCount.hidden = count === 0;
        tabCount.textContent = String(count);
      }
      if (readAll) readAll.disabled = count === 0;

      // Badge du menu latéral et point de la barre du haut : masqués (jamais supprimés), pour que les
      // notifications suivantes, reçues en direct, puissent de nouveau y afficher leur nombre.
      if (MC.setLiveBadge) MC.setLiveBadge("notifications", count);
    }

    /** Enregistre la lecture côté serveur (une notification, ou toutes) et met à jour les compteurs du menu. */
    function persist(ids) {
      if (!MC.api) return;
      MC.api("/api/notifications/lu", { method: "POST", json: ids ? { ids: ids } : {} })
        .then(function (result) { if (MC.setLiveBadge) MC.setLiveBadge("notifications", result.unread || 0); })
        .catch(function () {});
    }

    function markRead(item) {
      if (!item || !isUnread(item)) return false;
      item.removeAttribute("data-unread");
      item.classList.remove("is-unread");
      var button = item.querySelector("[data-nitem-read]");
      if (button) button.remove();
      var sr = item.querySelector("[data-nitem-sr]");
      if (sr) sr.remove();
      return true;
    }

    /** Dans l'onglet « Non lues », un élément lu sort de la liste en douceur. */
    function leaveIfFiltered(item) {
      if (filter !== "unread") return;
      if (reduceMotion) { render(false); return; }
      item.classList.add("is-leaving");
      window.setTimeout(function () { render(false); }, 240);
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        filter = tab.getAttribute("data-nfeed-tab");
        tabs.forEach(function (t) { t.setAttribute("aria-pressed", String(t === tab)); });
        render(true);
      });
    });

    feed.addEventListener("click", function (event) {
      var readButton = event.target.closest("[data-nitem-read]");
      if (readButton) {
        var item = readButton.closest("[data-nitem]");
        if (markRead(item)) {
          persist([item.getAttribute("data-nitem-id")]);
          syncCounters();
          leaveIfFiltered(item);
        }
        return;
      }
      // Ouvrir une notification la marque comme lue (la navigation, ou le panneau, suit).
      var open = event.target.closest("[data-nitem-open]");
      if (open) {
        var opened = open.closest("[data-nitem]");
        if (markRead(opened)) persist([opened.getAttribute("data-nitem-id")]);
        syncCounters();
      }
    });

    if (readAll) {
      readAll.addEventListener("click", function () {
        var changed = items.filter(markRead).length;
        if (!changed) return;
        persist(null);
        syncCounters();
        render(false);
        if (MC.toast) MC.toast("Toutes vos notifications sont marquées comme lues.", "success");
      });
    }

    render(true);
  };

  /**
   * Notification reçue en direct, ou lue depuis un autre onglet : les flux affichés (page Notifications,
   * panneau latéral) sont rechargés depuis le serveur, avec le même rendu, sans recharger la page.
   * L'en-tête du flux (titre de page ou de panneau, bouton Fermer) et le filtre choisi sont conservés.
   */
  var refreshing = null;
  MC.refreshNotifications = function () {
    if (!document.querySelector("[data-nfeed]") || !MC.space) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = window.fetch("/" + MC.space + "/panneau/notifications", {
      credentials: "same-origin",
      headers: { "X-Mandix-Panel": "1", "X-Mandix-Space": MC.space },
    })
      .then(function (response) { return response.ok ? response.text() : null; })
      .then(function (html) {
        var fresh = html && new DOMParser().parseFromString(html, "text/html").querySelector("[data-nfeed]");
        if (!fresh) return;
        document.querySelectorAll("[data-nfeed]").forEach(function (feed) {
          var pressed = feed.querySelector('[data-nfeed-tab][aria-pressed="true"]');
          var filter = pressed ? pressed.getAttribute("data-nfeed-tab") : "all";
          var copy = fresh.cloneNode(true);
          var oldHead = feed.querySelector(".nfeed__head");
          var newHead = copy.querySelector(".nfeed__head");
          if (oldHead && newHead) {
            var head = oldHead.cloneNode(true);
            var pill = newHead.querySelector("[data-nfeed-new]");
            var oldPill = head.querySelector("[data-nfeed-new]");
            if (pill && oldPill) oldPill.replaceWith(pill.cloneNode(true));
            var readAll = newHead.querySelector("[data-nfeed-readall]");
            var oldReadAll = head.querySelector("[data-nfeed-readall]");
            if (readAll && oldReadAll) oldReadAll.disabled = readAll.disabled;
            newHead.replaceWith(head);
          }
          copy.className = feed.className;
          copy.removeAttribute("data-nfeed-ready");
          feed.replaceWith(copy);
          MC.initNotifications(copy);
          if (filter !== "all") {
            var tab = copy.querySelector('[data-nfeed-tab="' + filter + '"]');
            if (tab) tab.click();
          }
        });
      })
      .catch(function () {})
      .then(function () { refreshing = null; });
    return refreshing;
  };

  /** Nombre de notifications non lues affichées dans les flux de la page (null s'il n'y a pas de flux). */
  MC.notificationsShownUnread = function () {
    var feed = document.querySelector("[data-nfeed]");
    return feed ? feed.querySelectorAll("[data-nitem][data-unread]").length : null;
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-nfeed]").forEach(MC.initNotifications);
  });
})();
