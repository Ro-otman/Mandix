/**
 * Mandix — interactions communes (JavaScript vanilla, sans dépendance).
 * - Navigation mobile et barre latérale des tableaux de bord
 * - Toasts (window.MC.toast)
 * - Modales <dialog> accessibles
 * - Confirmation avant les actions sensibles : <form data-confirm="Message" data-confirm-tone="danger">
 * - Affichage / masquage des mots de passe : <button data-password-toggle="idDuChamp">
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});

  /* --------------------------------------------------------------- Navigation publique mobile */
  function initMobileNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var panel = document.getElementById("mobile-nav");
    if (!toggle || !panel) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
      panel.hidden = !open;
      toggle.querySelector("[data-icon-open]").hidden = open;
      toggle.querySelector("[data-icon-close]").hidden = !open;
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    panel.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 961px)").addEventListener("change", function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  /* --------------------------------------------------------------- En-tête : ombre au défilement */
  function initHeaderShadow() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var update = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  /* --------------------------------------------------------------- Barre latérale (dashboards) */
  function initSidebar() {
    var shell = document.querySelector(".dashboard");
    var toggle = document.querySelector("[data-sidebar-toggle]");
    if (!shell || !toggle) return;

    function setOpen(open) {
      shell.classList.toggle("sidebar-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    }
    toggle.addEventListener("click", function () {
      setOpen(!shell.classList.contains("sidebar-open"));
    });
    document.querySelectorAll("[data-sidebar-close]").forEach(function (el) {
      el.addEventListener("click", function () {
        setOpen(false);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && shell.classList.contains("sidebar-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  /* --------------------------------------------------------------- Toasts */
  // Ils tombent du haut et se posent au centre (animations CSS, components.css). La fin de la barre de temps
  // restant ferme le toast ; survol ou focus la mettent en pause. Titre par défaut selon le type.
  var TOAST = {
    success: { title: "C'est fait !", glyph: '<path d="M20 6 9 17l-5-5"/>' },
    danger: { title: "Oups !", glyph: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' },
    warning: { title: "Attention", glyph: '<path d="M12 7v6"/><path d="M12 17.5h.01"/>' },
    info: { title: "Bon à savoir", glyph: '<path d="M12 11v6"/><path d="M12 7.5h.01"/>' },
  };
  var MAX_TOASTS = 3;

  function svg(paths, size) {
    return (
      '<svg class="icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>"
    );
  }

  function dismissToast(toast) {
    if (!toast || toast.dataset.dismissed) return;
    toast.dataset.dismissed = "1";
    toast.classList.add("is-leaving");
    var done = function () { if (toast.parentNode) toast.remove(); };
    toast.addEventListener("animationend", function (event) { if (event.target === toast) done(); });
    window.setTimeout(done, 450); // filet de sécurité si l'animation ne se déclenche pas
  }

  function armToast(toast) {
    var close = toast.querySelector(".toast__close");
    if (close) close.addEventListener("click", function () { dismissToast(toast); });
    var progress = toast.querySelector(".toast__progress");
    if (progress) progress.addEventListener("animationend", function () { dismissToast(toast); });
    else window.setTimeout(function () { dismissToast(toast); }, 6000);
    // Échap ferme le toast qui a le focus (bouton de fermeture)
    toast.addEventListener("keydown", function (event) { if (event.key === "Escape") dismissToast(toast); });
  }

  /**
   * Affiche un toast. type : success | danger | warning | info ; title facultatif (sinon titre par défaut).
   * Les textes sont insérés sans HTML (textContent).
   */
  MC.toast = function (message, type, title) {
    var region = document.getElementById("toast-region");
    if (!region) return;
    type = TOAST[type] ? type : "info";
    var toast = document.createElement("div");
    toast.className = "toast toast--" + type;
    toast.setAttribute("role", type === "danger" ? "alert" : "status");
    toast.innerHTML =
      '<span class="toast__icon">' + svg(TOAST[type].glyph, 20) + "</span>" +
      '<div class="toast__body"><p class="toast__title"></p><p class="toast__message"></p></div>' +
      '<button type="button" class="toast__close" aria-label="Fermer la notification">' +
      svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 16) + "</button>" +
      '<span class="toast__progress" aria-hidden="true"></span>';
    toast.querySelector(".toast__title").textContent = String(title || TOAST[type].title);
    toast.querySelector(".toast__message").textContent = String(message);
    region.appendChild(toast);
    // Pas plus de trois toasts à la fois : le plus ancien s'en va
    var visible = region.querySelectorAll(".toast:not(.is-leaving)");
    if (visible.length > MAX_TOASTS) dismissToast(visible[0]);
    armToast(toast);
  };

  function initServerToasts() {
    document.querySelectorAll("#toast-region .toast").forEach(armToast);
  }

  /* --------------------------------------------------------------- Modales */
  function initModals() {
    document.addEventListener("click", function (event) {
      var opener = event.target.closest("[data-modal-open]");
      if (opener) {
        var dialog = document.getElementById(opener.getAttribute("data-modal-open"));
        if (dialog && typeof dialog.showModal === "function") {
          event.preventDefault();
          dialog.showModal();
        }
        return;
      }
      var closer = event.target.closest("[data-modal-close]");
      if (closer) {
        var parent = closer.closest("dialog");
        if (parent) parent.close("cancel");
      }
    });

    // Clic sur le fond : fermeture.
    document.querySelectorAll("dialog.modal").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) dialog.close("cancel");
      });
    });
  }

  /* --------------------------------------------------------------- Confirmation des actions sensibles */
  function initConfirmations() {
    var dialog = document.getElementById("confirm-dialog");
    if (!dialog || typeof dialog.showModal !== "function") return; // sans <dialog> : envoi direct

    var pendingForm = null;
    var messageEl = dialog.querySelector("[data-confirm-message]");
    var titleEl = dialog.querySelector("[data-confirm-title]");
    var confirmBtn = dialog.querySelector("[data-confirm-accept]");
    var iconEl = dialog.querySelector(".modal__icon");

    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form.matches("form[data-confirm]") || form.dataset.confirmed === "1") return;
      event.preventDefault();
      pendingForm = form;
      var danger = form.dataset.confirmTone === "danger";
      titleEl.textContent = form.dataset.confirmTitle || "Confirmer cette action";
      messageEl.textContent = form.dataset.confirm;
      confirmBtn.textContent = form.dataset.confirmLabel || "Confirmer";
      confirmBtn.className = "btn " + (danger ? "btn--danger" : "btn--primary");
      iconEl.classList.toggle("modal__icon--danger", danger);
      dialog.showModal();
    });

    confirmBtn.addEventListener("click", function () {
      if (!pendingForm) return;
      var form = pendingForm;
      pendingForm = null;
      form.dataset.confirmed = "1";
      dialog.close("confirm");
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
    });

    dialog.addEventListener("close", function () {
      if (dialog.returnValue !== "confirm") pendingForm = null;
    });
  }

  /* --------------------------------------------------------------- Mot de passe visible / masqué */
  function initPasswordToggles() {
    document.querySelectorAll("[data-password-toggle]").forEach(function (button) {
      var input = document.getElementById(button.getAttribute("data-password-toggle"));
      if (!input) return;
      button.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-pressed", String(show));
        button.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
      });
    });
  }

  /* --------------------------------------------------------------- Loader de navigation */
  function initPageLoader() {
    var root = document.documentElement;
    var show = function () { root.classList.add("is-loading"); };

    document.addEventListener("click", function (event) {
      var link = event.target.closest("a[href]");
      if (!link || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download") || link.origin !== window.location.origin) return;
      var samePage = link.pathname === window.location.pathname && link.search === window.location.search;
      if (samePage && link.hash) return; // simple ancre
      show();
    });

    // Envoi d'un formulaire : petit loader dans le bouton pour une action (POST : connexion, inscription…),
    // grand loader pour une navigation (GET : recherche…). Un second envoi pendant le premier est ignoré.
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (event.defaultPrevented || form.hasAttribute("data-demo-form")) return;
      if (form.dataset.submitting === "1") { event.preventDefault(); return; }
      if ((form.getAttribute("method") || "get").toLowerCase() !== "post") { show(); return; }
      form.dataset.submitting = "1";
      setBusy(event.submitter || form.querySelector('[type="submit"]'), true);
    });

    // Retour arrière (cache du navigateur) : la page revient sans recharger, boutons réactivés.
    window.addEventListener("pageshow", function () {
      root.classList.remove("is-loading");
      document.querySelectorAll("form[data-submitting]").forEach(function (form) {
        delete form.dataset.submitting;
        if (form.dataset.confirmed === "1") form.dataset.confirmed = "";
      });
      document.querySelectorAll(".is-busy").forEach(function (button) { setBusy(button, false); });
    });
  }

  /**
   * Petit loader dans un bouton : cercle qui tourne (CSS, classe is-busy), libellé facultatif pendant l'action
   * (attribut data-busy-label, ex. « Connexion… »). Exposé pour les scripts : MC.setBusy(bouton, true | false).
   */
  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      if (button.classList.contains("is-busy")) return;
      var label = button.getAttribute("data-busy-label");
      if (label) {
        button.dataset.idleHtml = button.innerHTML; // balisage du bouton lui-même, rendu par le serveur
        button.textContent = label;
      }
      button.classList.add("is-busy");
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-disabled", "true");
    } else {
      if (button.dataset.idleHtml !== undefined) {
        button.innerHTML = button.dataset.idleHtml;
        delete button.dataset.idleHtml;
      }
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
      button.removeAttribute("aria-disabled");
    }
  }
  MC.setBusy = setBusy;

  /**
   * Appel au serveur (même origine, cookies HttpOnly envoyés), jeton CSRF ajouté automatiquement.
   * MC.api("/chemin", { method: "POST", json: {...} } | { method: "POST", form: FormData }) → Promise<données>
   * En cas d'erreur, la promesse est rejetée avec le message du serveur (error.message) et le code (error.status).
   */
  /** Espace de la page (client, mandataire, admin) : le serveur utilise la session de cet espace. */
  var spaceMeta = document.querySelector('meta[name="mandix-space"]');
  MC.space = spaceMeta ? spaceMeta.getAttribute("content") : null;

  MC.api = function (url, options) {
    options = options || {};
    var meta = document.querySelector('meta[name="csrf-token"]');
    var headers = { Accept: "application/json", "X-CSRF-Token": meta ? meta.getAttribute("content") : "" };
    if (MC.space) headers["X-Mandix-Space"] = MC.space;
    var body;
    if (options.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(options.json); }
    else if (options.form) body = options.form;
    return window.fetch(url, { method: options.method || "GET", headers: headers, body: body, credentials: "same-origin" })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (response.ok) return data;
          var error = new Error((data && data.error) || "Une erreur est survenue. Réessayez.");
          error.status = response.status;
          error.details = data && data.errors;
          throw error;
        });
      });
  };

  /* --------------------------------------------------------------- Formulaires de démonstration */
  // <form data-demo-form="Message facultatif"> : rien n'est envoyé, un toast explique pourquoi.
  function initDemoForms() {
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form.hasAttribute("data-demo-form")) return;
      // Une action sensible passe d'abord par la modale de confirmation (initConfirmations).
      if (form.hasAttribute("data-confirm") && form.dataset.confirmed !== "1") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      form.dataset.confirmed = "";
      if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
      var button = form.querySelector('[type="submit"]');
      setBusy(button, true);
      window.setTimeout(function () {
        // Parcours de démonstration : ouvre la page suivante (chemin interne uniquement).
        var redirect = form.getAttribute("data-demo-redirect");
        if (redirect && redirect.charAt(0) === "/" && redirect.charAt(1) !== "/") {
          document.documentElement.classList.add("is-loading");
          window.location.assign(redirect);
          return;
        }
        setBusy(button, false);
        MC.toast(form.getAttribute("data-demo-form") || "Cette action sera disponible une fois le backend branché.", "info");
      }, 650);
    }, true);
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  MC.prefersReducedMotion = prefersReducedMotion;

  /**
   * Disponibilité des mandataires absents ([data-presence][data-last-seen]) : « En ligne il y a 12 min ».
   * L’état « En ligne » est fourni par le serveur (présence réelle) ; ici on fait seulement avancer
   * le temps écoulé depuis la dernière activité, toutes les 30 s. Même règle que utils/presence.js.
   */
  function initPresence() {
    var items = document.querySelectorAll("[data-presence][data-last-seen]");
    if (!items.length) return;

    function label(diff) {
      if (diff < 2 * 60000) return "En ligne";
      var minutes = Math.floor(diff / 60000);
      if (minutes < 60) return "En ligne il y a " + minutes + " min";
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return "En ligne il y a " + hours + " h";
      return "En ligne il y a " + Math.floor(hours / 24) + " j";
    }

    function refresh() {
      var now = Date.now();
      items.forEach(function (el) {
        var seen = Date.parse(el.getAttribute("data-last-seen"));
        if (isNaN(seen)) return;
        var diff = Math.max(0, now - seen);
        var online = diff < 2 * 60000;
        var text = el.querySelector("[data-presence-label]");
        if (text) text.textContent = label(diff);
        el.classList.toggle("is-online", online);
        // Point sur l’avatar associé (même carte ou même en-tête de profil).
        var scope = el.closest("[data-presence-scope]") || el.closest(".pro");
        var dot = scope && scope.querySelector("[data-presence-dot]");
        if (dot) dot.classList.toggle("is-online", online);
      });
    }

    refresh();
    window.setInterval(refresh, 30000);
  }

  /** Barres de progression : largeur lue dans data-progress (0–100), appliquée via CSSOM (CSP sans style en ligne). */
  function initProgressBars() {
    document.querySelectorAll("[data-progress]").forEach(function (bar) {
      var value = Math.max(0, Math.min(100, Number(bar.getAttribute("data-progress")) || 0));
      bar.style.width = value + "%";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initMobileNav();
    initHeaderShadow();
    initSidebar();
    initServerToasts();
    initModals();
    initConfirmations();
    initPasswordToggles();
    initPageLoader();
    initDemoForms();
    initPresence();
    initProgressBars();
  });
})();
