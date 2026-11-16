/**
 * Panneau latéral de l'espace client, façon application monopage : messages (liste puis conversation),
 * conversation directe (bouton « Message » d'une carte), fiche d'un mandataire (« Voir le profil », plus
 * large) et notifications glissent depuis la droite sans recharger la page ; le reste de la page est flouté.
 * Un lien marqué data-drawer-native garde sa navigation normale (ex. « Ouvrir en pleine page »).
 *
 * - Espaces client et mandataire : préfixe lu sur le <dialog> (data-drawer-base = "/client" ou "/mandataire").
 *   « Mon profil » (data-open-myprofile) dans les deux espaces ; mandataire : aperçu de sa fiche (data-open-preview) en plus.
 * - Contenu : fragments HTML rendus par le serveur (<préfixe>/panneau/…, en-tête X-Mandix-Panel).
 * - Pile de vues : liste → conversation, notifications → conversation. La flèche « retour » et le bouton
 *   Retour du navigateur reviennent à la vue précédente ; une entrée d'historique par vue (même adresse).
 * - Un contenu déjà ouvert est gardé en mémoire : messages envoyés, conversations et notifications lues.
 * - <dialog> modal : focus piégé, page inerte ; Échap, clic sur le flou ou bouton Fermer ferment.
 * - Ctrl/Cmd/Maj + clic ou clic du milieu : navigation normale. Sans <dialog> ni JavaScript : pages complètes.
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});

  document.addEventListener("DOMContentLoaded", function () {
    var dialog = document.querySelector("[data-drawer]");
    if (!dialog || typeof dialog.showModal !== "function") return;

    var content = dialog.querySelector("[data-drawer-content]");
    var skeletonTpl = dialog.querySelector("[data-drawer-skeleton]");
    var errorTpl = dialog.querySelector("[data-drawer-error]");
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var finePointer = window.matchMedia("(pointer: fine)").matches;
    var CLOSE_MS = 260;
    var SWAP_MS = 160;
    var SLOW_MS = 180; // au-delà, un squelette remplace la vue pendant le chargement

    var cache = {};          // url du fragment → élément chargé et initialisé
    var stack = [];          // vues empilées ; la dernière est affichée
    var trigger = null;      // élément qui reprend le focus à la fermeture
    var closing = false;
    var closedByScript = false;
    var token = 0;           // ignore une réponse arrivée après une autre action
    var swapTimer = null;
    var lastChatSlug = null; // pour redonner le focus à la conversation quittée
    var readSlugs = {};      // conversations lues dans le panneau
    var sent = {};           // derniers messages envoyés dans le panneau, par conversation

    // Préfixe : "/client", "/mandataire", ou "" sur les pages publiques (visiteur : seule la fiche d'un mandataire).
    var RAW_BASE = dialog.getAttribute("data-drawer-base");
    var PUBLIC = RAW_BASE === "";
    var BASE = RAW_BASE === "/mandataire" ? "/mandataire" : PUBLIC ? "" : "/client";
    var PROFILE_BASE = PUBLIC ? "" : "/client";
    var PAGES = { messages: BASE + "/messages", notifications: BASE + "/notifications", myprofile: BASE + "/profil", preview: BASE + "/apercu" };
    var VIEWS = {
      messages: function () { return { kind: "messages", url: BASE + "/panneau/messages", page: PAGES.messages }; },
      chat: function (slug) {
        var s = encodeURIComponent(slug);
        return { kind: "chat", slug: slug, url: BASE + "/panneau/messages/" + s, page: BASE + "/messages/" + s };
      },
      notifications: function () { return { kind: "notifications", url: BASE + "/panneau/notifications", page: PAGES.notifications }; },
      myprofile: function () { return { kind: "myprofile", url: BASE + "/panneau/profil", page: PAGES.myprofile }; },
      preview: function () { return { kind: "preview", url: BASE + "/panneau/apercu", page: PAGES.preview }; },
      profile: function (slug) {
        var s = encodeURIComponent(slug);
        return { kind: "profile", slug: slug, url: PROFILE_BASE + "/panneau/mandataires/" + s, page: PROFILE_BASE + "/mandataires/" + s };
      },
    };

    /** Libellé de la flèche « retour » selon la vue précédente. */
    var BACK_LABELS = { notifications: "Retour aux notifications", profile: "Retour au profil", chat: "Retour à la conversation", messages: "Retour aux conversations", myprofile: "Retour à mon profil", preview: "Retour à l'aperçu" };
    var CHAT_LINK = 'a[href^="' + BASE + '/messages/"]';

    var slugOf = function (link) { return decodeURIComponent(link.getAttribute("href").split("/").pop() || ""); };

    var top = function () { return stack[stack.length - 1] || null; };
    var cssId = function (value) { return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"); };

    // Grand écran : la liste des conversations et la conversation s'affichent côte à côte dans une fenêtre plus
    // large (« messagerie ») ; plus besoin de passer par la liste. Mobile et tablette : liste puis conversation.
    var splitQuery = window.matchMedia("(min-width: 960px)");
    var isInbox = function (view) { return !!view && (view.kind === "messages" || view.kind === "chat"); };
    var splitOn = function (view) { return splitQuery.matches && isInbox(view); };
    var shell = null;        // conteneur des deux colonnes, réutilisé
    var threadToken = 0;     // ignore une conversation arrivée après une autre sélection

    document.querySelectorAll("[data-open-chat], [data-open-profile], [data-open-notifications], [data-open-messages], [data-open-myprofile], [data-open-preview]").forEach(function (el) {
      el.setAttribute("aria-haspopup", "dialog");
    });

    /* ------------------------------------------------------------------ Déclencheurs */

    function plainClick(event) {
      return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    }

    // Phase de capture : le panneau intercepte le clic avant le loader de page (public/js/app.js),
    // qui voit alors la navigation annulée et ne s'affiche pas.
    document.addEventListener("click", function (event) {
      if (event.defaultPrevented || !plainClick(event)) return;
      if (event.target.closest("[data-drawer-native]")) return;

      var chatLink = event.target.closest("[data-open-chat]");
      if (chatLink) {
        event.preventDefault();
        open(VIEWS.chat(chatLink.getAttribute("data-open-chat")), chatLink);
        return;
      }

      var profileLink = event.target.closest("[data-open-profile]");
      if (profileLink) {
        event.preventDefault();
        open(VIEWS.profile(profileLink.getAttribute("data-open-profile")), profileLink);
        return;
      }

      var previewLink = event.target.closest("[data-open-preview]");
      if (previewLink) {
        event.preventDefault();
        open(VIEWS.preview(), previewLink);
        return;
      }

      // Dans le panneau : conversation de la liste, notification de message, « Répondre », « Envoyer un message »,
      // ou lien vers la fiche d'un mandataire.
      if (dialog.contains(event.target)) {
        var link = event.target.closest("a[href]");
        var href = link ? link.getAttribute("href") : "";
        // Côte à côte : une conversation de la liste s'affiche à droite, sans changer de vue.
        if (link && link.matches(CHAT_LINK) && splitOn(top()) && link.closest(".drawer-split__list")) {
          event.preventDefault();
          selectThread(slugOf(link), true);
          return;
        }
        var next = null;
        if (link && link.matches(CHAT_LINK)) next = VIEWS.chat(slugOf(link));
        else if (link && BASE === "/client" && href.indexOf("/client/mandataires/") === 0) next = VIEWS.profile(slugOf(link));
        else if (href === PAGES.preview || href.indexOf(PAGES.preview + "#") === 0) next = BASE === "/mandataire" ? VIEWS.preview() : null;
        else if (href === PAGES.myprofile) next = VIEWS.myprofile();
        if (next && (next.kind !== "chat" && next.kind !== "profile" || next.slug)) {
          event.preventDefault();
          navigate(next);
        }
        return;
      }

      var opener = event.target.closest("[data-open-messages], [data-open-notifications], [data-open-myprofile]");
      if (opener) {
        var kind = opener.hasAttribute("data-open-messages") ? "messages" : opener.hasAttribute("data-open-myprofile") ? "myprofile" : "notifications";
        if (window.location.pathname.indexOf(PAGES[kind]) === 0) return; // déjà sur la page complète
        event.preventDefault();
        closeSidebar();
        open(VIEWS[kind](), opener);
      }
    }, true);

    function closeSidebar() {
      var shell = document.querySelector(".dashboard.sidebar-open");
      if (!shell) return;
      shell.classList.remove("sidebar-open");
      var toggle = document.querySelector("[data-sidebar-toggle]");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }

    /* ------------------------------------------------------------------ Navigation dans le panneau */

    function pushEntry() {
      try { window.history.pushState({ mxDrawer: stack.length }, ""); } catch (e) { /* historique indisponible */ }
    }

    function ownHistory() {
      return window.history.state && window.history.state.mxDrawer ? window.history.state.mxDrawer : 0;
    }

    function open(view, triggerEl) {
      if (triggerEl && !dialog.contains(triggerEl)) trigger = triggerEl;
      if (closing) finishClose(true);
      if (dialog.open) { navigate(view); return; }
      stack = [view];
      dialog.setAttribute("data-kind", view.kind);
      dialog.showModal();
      document.documentElement.classList.add("has-drawer");
      pushEntry();
      display(view, "open");
    }

    function navigate(view) {
      var current = top();
      if (current && current.url === view.url) return;
      stack.push(view);
      pushEntry();
      display(view, "forward");
    }

    /** Flèche « retour » du panneau. */
    function back() {
      if (stack.length > 1) {
        if (ownHistory()) { window.history.back(); return; } // popstate affiche la vue précédente
        stack.pop();
        display(top(), "back");
        return;
      }
      // Conversation ouverte directement (bouton « Message ») : on revient à la liste des conversations.
      var list = VIEWS.messages();
      stack = [list];
      try { window.history.replaceState({ mxDrawer: 1 }, ""); } catch (e) { /* rien */ }
      display(list, "back");
    }

    window.addEventListener("popstate", function (event) {
      if (!dialog.open) return;
      var depth = event.state && event.state.mxDrawer ? event.state.mxDrawer : 0;
      if (depth === 0) { animateClose(); return; }
      if (depth < stack.length) {
        stack.length = depth;
        display(top(), "back");
      }
    });

    /* ------------------------------------------------------------------ Affichage */

    function display(view, mode) {
      if (splitOn(view)) { displayInbox(view, mode); return; }
      dialog.setAttribute("data-kind", view.kind);
      window.clearTimeout(swapTimer);
      if (cache[view.url]) { swap(cache[view.url], view, mode); return; }

      var mine = ++token;
      var slowTimer = null;
      if (mode === "open") swap(fromTemplate(skeletonTpl), view, "open", true);
      else slowTimer = window.setTimeout(function () { if (mine === token) swap(fromTemplate(skeletonTpl), view, mode, true); }, SLOW_MS);

      load(view.url)
        .then(function (html) {
          window.clearTimeout(slowTimer);
          if (mine !== token || top() !== view || !dialog.open) return;
          // Fragment de même origine, rendu et échappé côté serveur (EJS).
          var holder = document.createElement("div");
          holder.innerHTML = html;
          var el = holder.querySelector("[data-drawer-view]");
          if (!el) throw new Error("fragment invalide");
          cache[view.url] = cache[view.url] || el; // déjà reçu par la messagerie côte à côte
          swap(cache[view.url], view, isSkeletonShown() ? "fade" : mode);
        })
        .catch(function () {
          window.clearTimeout(slowTimer);
          if (mine !== token || top() !== view || !dialog.open) return;
          var error = fromTemplate(errorTpl);
          error.querySelector("[data-drawer-fallback]").setAttribute("href", view.page);
          swap(error, view, isSkeletonShown() ? "fade" : mode);
        });
    }

    /* ------------------------------------------------------------------ Messagerie côte à côte (grand écran) */

    function getShell() {
      if (shell) return shell;
      shell = document.createElement("div");
      shell.className = "drawer-view drawer-split";
      shell.setAttribute("data-drawer-view", "inbox");
      var listPane = document.createElement("div");
      listPane.className = "drawer-split__list";
      var main = document.createElement("div");
      main.className = "drawer-split__main";
      shell.appendChild(listPane);
      shell.appendChild(main);
      return shell;
    }

    /** Fragment déjà chargé, ou chargé puis gardé en mémoire. */
    function getView(url) {
      if (cache[url]) return Promise.resolve(cache[url]);
      return load(url).then(function (html) {
        if (cache[url]) return cache[url];
        var holder = document.createElement("div");
        holder.innerHTML = html; // fragment de même origine, rendu et échappé côté serveur (EJS)
        var el = holder.querySelector("[data-drawer-view]");
        if (!el) throw new Error("fragment invalide");
        cache[url] = el;
        return el;
      });
    }

    /** Copie d'un modèle sans son identifiant de titre (un seul « drawer-title » dans le panneau). */
    function paneTemplate(template) {
      var el = fromTemplate(template);
      el.querySelectorAll("#drawer-title").forEach(function (node) { node.removeAttribute("id"); });
      return el;
    }

    /** Liste à gauche ; à droite, la conversation demandée, sinon la dernière consultée, sinon la plus récente. */
    function displayInbox(view, mode) {
      dialog.setAttribute("data-kind", "inbox");
      var mine = ++token;
      var box = getShell();
      var listPane = box.firstElementChild;
      if (content.firstElementChild !== box) swap(box, view, mode, true);
      if (view.kind === "chat") selectThread(view.slug, mode !== "back");

      getView(VIEWS.messages().url)
        .then(function (list) {
          if (mine !== token || !dialog.open || !splitOn(top())) return;
          ANIM_CLASSES.forEach(function (c) { list.classList.remove(c); });
          if (list.parentNode !== listPane) listPane.replaceChildren(list);
          prepareList(list);
          if (view.kind === "messages") {
            var known = lastChatSlug && list.querySelector('[data-chat-slug="' + cssId(lastChatSlug) + '"]');
            var first = list.querySelector("[data-chat-item]");
            var slug = known ? lastChatSlug : first ? first.getAttribute("data-chat-slug") : null;
            if (slug) selectThread(slug, mode !== "back");
            else showNoThread();
          }
        })
        .catch(function () {
          if (mine !== token || !dialog.open) return;
          var error = paneTemplate(errorTpl);
          error.querySelector("[data-drawer-fallback]").setAttribute("href", PAGES.messages);
          listPane.replaceChildren(error);
        });
    }

    /** Affiche une conversation dans la colonne de droite ; elle devient la vue courante (même entrée d'historique). */
    function selectThread(slug, focus) {
      if (!slug) return;
      var view = VIEWS.chat(slug);
      var box = getShell();
      var main = box.lastElementChild;
      var mine = ++threadToken;
      if (stack.length) stack[stack.length - 1] = view; else stack = [view];
      lastChatSlug = slug;
      var list = cache[VIEWS.messages().url];
      if (list) markActive(list);

      var slowTimer = null;
      if (!cache[view.url]) {
        if (!main.firstElementChild) main.replaceChildren(paneTemplate(skeletonTpl));
        else slowTimer = window.setTimeout(function () { if (mine === threadToken) main.replaceChildren(paneTemplate(skeletonTpl)); }, SLOW_MS);
      }

      getView(view.url)
        .then(function (el) {
          window.clearTimeout(slowTimer);
          if (mine !== threadToken || !dialog.open || !splitOn(top())) return;
          if (main.firstElementChild !== el) {
            ANIM_CLASSES.forEach(function (c) { el.classList.remove(c); });
            main.replaceChildren(el);
            if (!reduceMotion) { void el.offsetWidth; el.classList.add("is-fading-in"); }
          }
          box.classList.add("has-thread");
          prepareChat(el, view);
          if (focus) {
            var target = finePointer ? el.querySelector("[data-flow-composer] button, [data-flow-composer] select, [data-flow-composer] input") : null;
            (target || el.querySelector("[data-drawer-close]")).focus({ preventScroll: true });
          }
        })
        .catch(function () {
          window.clearTimeout(slowTimer);
          if (mine !== threadToken || !dialog.open) return;
          var error = paneTemplate(errorTpl);
          error.querySelector("[data-drawer-fallback]").setAttribute("href", view.page);
          main.replaceChildren(error);
          box.classList.remove("has-thread");
        });
    }

    /** Aucune conversation : invitation à contacter un mandataire. */
    function showNoThread() {
      var box = getShell();
      var empty = document.createElement("div");
      empty.className = "drawer-split__empty";
      var title = document.createElement("p");
      title.className = "drawer-split__empty-title";
      title.textContent = "Aucune conversation";
      var text = document.createElement("p");
      text.textContent = BASE === "/client" ? "Trouvez un mandataire et envoyez-lui votre premier message." : "Les messages de vos clients apparaîtront ici.";
      empty.appendChild(title);
      empty.appendChild(text);
      box.lastElementChild.replaceChildren(empty);
      box.classList.remove("has-thread");
    }

    /** Conversation affichée à droite : mise en évidence dans la liste (seulement côte à côte). */
    function markActive(list) {
      list.querySelectorAll("[data-chat-item]").forEach(function (item) {
        var on = splitQuery.matches && item.getAttribute("data-chat-slug") === lastChatSlug;
        var link = item.querySelector(".chat__item");
        if (!link) return;
        link.classList.toggle("is-active", on);
        if (on) link.setAttribute("aria-current", "true"); else link.removeAttribute("aria-current");
      });
    }

    /** Liste prête : recherche, aperçus, conversations lues et messages envoyés. */
    function prepareList(el) {
      if (MC.initChatSearch) MC.initChatSearch(el);
      if (MC.syncChatList) MC.syncChatList(el);
      syncList(el);
      markActive(el);
    }

    /** Conversation prête : messagerie guidée, lecture, défilement, flèche « retour », titre du panneau. */
    function prepareChat(el, view) {
      if (MC.initChat) MC.initChat(el.querySelector("[data-chat-root]"), el);
      markConversationRead(el);
      var box = el.querySelector("[data-chat-messages]");
      if (box) {
        // Dernier message visible ; de nouveau après l'animation, la vue pouvant être insérée juste après.
        var toEnd = function () { box.scrollTop = box.scrollHeight; };
        toEnd();
        window.setTimeout(toEnd, SWAP_MS + 40);
      }
      var split = splitOn(view);
      var previous = stack[stack.length - 2];
      var backButton = el.querySelector("[data-drawer-back]");
      if (backButton) {
        // Côte à côte, la liste est visible : la flèche ne sert qu'à revenir à la vue d'avant (fiche, notifications).
        backButton.hidden = split && !previous;
        backButton.setAttribute("aria-label", BACK_LABELS[previous ? previous.kind : "messages"]);
      }
      // Un seul titre « drawer-title » : côte à côte, c'est celui de la liste (« Messages »).
      var title = el.querySelector(".chat__who-name");
      if (title) { if (split) title.removeAttribute("id"); else title.id = "drawer-title"; }
      lastChatSlug = view.slug;
    }

    // Passage d'un grand écran à un petit (ou l'inverse) pendant que la messagerie est ouverte.
    function onSplitChange() {
      var current = top();
      if (dialog.open && !closing && isInbox(current)) display(current, "fade");
    }
    if (splitQuery.addEventListener) splitQuery.addEventListener("change", onSplitChange);
    else if (splitQuery.addListener) splitQuery.addListener(onSplitChange);

    /* ------------------------------------------------------------------ Chargement et préchargement */

    var pending = {}; // url → Promise du HTML (requête en cours ou déjà reçue, pas encore affichée)

    function load(url) {
      if (!pending[url]) {
        pending[url] = fetch(url, { headers: { "X-Mandix-Panel": "1" }, credentials: "same-origin" }).then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.text();
        });
        pending[url].catch(function () { delete pending[url]; }); // nouvel essai au prochain clic
      }
      return pending[url];
    }

    /** Précharge le contenu d'un déclencheur survolé ou focalisé : l'ouverture devient instantanée. */
    function prefetchFor(el) {
      var url = null;
      if (el.hasAttribute("data-open-chat")) url = VIEWS.chat(el.getAttribute("data-open-chat")).url;
      else if (el.hasAttribute("data-open-messages")) url = VIEWS.messages().url;
      else if (el.hasAttribute("data-open-profile")) url = VIEWS.profile(el.getAttribute("data-open-profile")).url;
      else if (el.hasAttribute("data-open-notifications")) url = VIEWS.notifications().url;
      else if (el.hasAttribute("data-open-myprofile")) url = VIEWS.myprofile().url;
      else if (el.hasAttribute("data-open-preview")) url = VIEWS.preview().url;
      else if (el.matches("[data-drawer] " + CHAT_LINK)) url = VIEWS.chat(slugOf(el)).url;
      else if (BASE === "/client" && el.matches('[data-drawer] a[href^="/client/mandataires/"]:not([data-drawer-native])')) url = VIEWS.profile(slugOf(el)).url;
      else if (BASE === "/mandataire" && el.matches('[data-drawer] a[href="/mandataire/apercu"]')) url = VIEWS.preview().url;
      if (url && !cache[url]) load(url);
    }

    var PREFETCH = "[data-open-chat], [data-open-profile], [data-open-messages], [data-open-notifications], [data-open-myprofile], [data-open-preview], " +
      "[data-drawer] " + CHAT_LINK + ', [data-drawer] a[href^="/client/mandataires/"], [data-drawer] a[href="/mandataire/apercu"]';
    function onIntent(event) {
      var el = event.target.closest && event.target.closest(PREFETCH);
      if (el) prefetchFor(el);
    }
    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("focusin", onIntent);

    // Page au repos : la liste des messages et les notifications sont préparées en arrière-plan.
    var whenIdle = window.requestIdleCallback || function (fn) { return window.setTimeout(fn, 1500); };
    if (!PUBLIC) {
      window.setTimeout(function () {
        whenIdle(function () { load(VIEWS.messages().url); load(VIEWS.notifications().url); }, { timeout: 4000 });
      }, 1200);
    }

    function isSkeletonShown() {
      var shown = content.firstElementChild;
      return !!(shown && shown.classList.contains("drawer-skeleton"));
    }

    function fromTemplate(template) {
      return template.content.firstElementChild.cloneNode(true);
    }

    var ENTER = { forward: "is-entering", back: "is-entering-back", fade: "is-fading-in" };
    var LEAVE = { forward: "is-leaving", back: "is-leaving-back" };
    var ANIM_CLASSES = ["is-entering", "is-entering-back", "is-fading-in", "is-leaving", "is-leaving-back"];

    /** Remplace la vue : vers l'avant, elle arrive de la droite ; en arrière, de la gauche. */
    function swap(el, view, mode, isSkeleton) {
      var old = content.firstElementChild;
      var put = function () {
        if (old) ANIM_CLASSES.forEach(function (c) { old.classList.remove(c); });
        ANIM_CLASSES.forEach(function (c) { el.classList.remove(c); });
        content.replaceChildren(el);
        if (!reduceMotion && ENTER[mode]) {
          void el.offsetWidth;
          el.classList.add(ENTER[mode]);
        }
        if (!isSkeleton) ready(el, view, mode);
      };
      window.clearTimeout(swapTimer);
      var animateOut = !reduceMotion && LEAVE[mode] && old && old !== el && !old.classList.contains("drawer-skeleton");
      if (animateOut) {
        old.classList.add(LEAVE[mode]);
        swapTimer = window.setTimeout(put, SWAP_MS);
      } else {
        put();
      }
    }

    /** Branche la vue insérée (une seule fois), met à jour les états, place le focus. */
    function ready(el, view, mode) {
      var target = null;

      if (view.kind === "chat") {
        prepareChat(el, view);
        // Première réponse préfaite (messagerie guidée).
        if (finePointer) target = el.querySelector("[data-flow-composer] button, [data-flow-composer] select, [data-flow-composer] input");
      }

      if (view.kind === "messages") {
        prepareList(el);
        if (mode === "back" && lastChatSlug) target = el.querySelector('[data-chat-slug="' + cssId(lastChatSlug) + '"] a');
        if (!target) target = finePointer ? el.querySelector("[data-chat-search]") : el.querySelector("[data-chat-item] a");
      }

      if (view.kind === "notifications") {
        if (MC.initNotifications) MC.initNotifications(el.querySelector("[data-nfeed]"));
        target = el.querySelector("[data-nfeed-tab]");
      }

      if (view.kind === "myprofile") {
        // Barre de progression de la certification (largeur appliquée via CSSOM, la CSP interdit les styles en ligne).
        el.querySelectorAll("[data-progress]").forEach(function (bar) {
          bar.style.width = Math.max(0, Math.min(100, Number(bar.getAttribute("data-progress")) || 0)) + "%";
        });
      }

      if (view.kind === "profile" || view.kind === "preview" || view.kind === "myprofile") {
        // Flèche « retour » seulement s'il y a une vue précédente (fiche ouverte depuis une conversation, etc.).
        var sheetBack = el.querySelector("[data-drawer-back]");
        var before = stack[stack.length - 2];
        if (sheetBack) {
          sheetBack.hidden = !before;
          if (before) sheetBack.setAttribute("aria-label", BACK_LABELS[before.kind]);
        }
        var scroller = el.querySelector(".msheet__scroll, .proprof__scroll");
        if (scroller && mode !== "back") scroller.scrollTop = 0;
        target = el.querySelector("[data-drawer-close]");
      }

      target = target || el.querySelector("[data-drawer-close]");
      if (target) target.focus({ preventScroll: true });
    }

    /* ------------------------------------------------------------------ États des conversations */

    /** Ouvrir une conversation non lue la marque comme lue : liste du panneau, menu latéral, barre supérieure. */
    function markConversationRead(el) {
      var root = el.querySelector("[data-chat-root]");
      if (!root) return;
      var slug = root.getAttribute("data-chat-slug");
      var unread = Number(root.getAttribute("data-chat-unread")) || 0;
      if (!unread || readSlugs[slug]) return;
      readSlugs[slug] = unread;
      root.setAttribute("data-chat-unread", "0");

      var list = cache[VIEWS.messages().url];
      if (list) syncList(list);

      var badge = document.querySelector('.sidebar__link[href="' + PAGES.messages + '"] .sidebar__badge');
      var remaining = 0;
      if (badge) {
        remaining = Math.max(0, (Number(badge.textContent) || 0) - unread);
        if (remaining) {
          badge.textContent = String(remaining);
          badge.setAttribute("aria-label", remaining + " non lu" + (remaining > 1 ? "s" : ""));
        } else {
          badge.remove();
        }
      }
      if (!remaining) {
        var dot = document.querySelector('.topbar__icon[href="' + PAGES.messages + '"] .topbar__dot');
        if (dot) dot.remove();
      }
    }

    /** Applique à la liste les conversations lues et les messages envoyés dans le panneau. */
    function syncList(list) {
      var items = list.querySelector("[data-chat-items]");
      if (!items) return;

      Object.keys(readSlugs).forEach(function (slug) {
        var item = items.querySelector('[data-chat-slug="' + cssId(slug) + '"]');
        var badge = item && item.querySelector("[data-chat-item-unread]");
        if (badge) badge.remove();
        if (item) item.querySelector(".chat__item").classList.remove("is-unread");
      });
      var total = 0;
      items.querySelectorAll("[data-chat-item-unread]").forEach(function (b) { total += Number(b.textContent) || 0; });
      var pill = list.querySelector("[data-chat-unread-total]");
      if (pill) {
        pill.hidden = total === 0;
        pill.querySelector("[data-chat-unread-count]").textContent = String(total);
        pill.querySelector("[data-chat-unread-plural]").textContent = total > 1 ? "s" : "";
      }

      // Du plus ancien au plus récent : chaque conversation remonte en tête, la plus récente finit en haut.
      Object.keys(sent)
        .sort(function (a, b) { return sent[a].at - sent[b].at; })
        .forEach(function (slug) {
          var info = sent[slug];
          var item = items.querySelector('[data-chat-slug="' + cssId(slug) + '"]') || createItem(info);
          item.querySelector("[data-chat-item-preview]").textContent = "Vous : " + info.text;
          item.querySelector("[data-chat-when]").textContent = info.time;
          items.prepend(item);
        });
    }

    /** Nouvelle conversation (premier message à un mandataire) ajoutée à la liste. */
    function createItem(info) {
      var li = document.createElement("li");
      li.setAttribute("data-chat-item", "");
      li.setAttribute("data-chat-slug", info.slug);
      li.setAttribute("data-name", info.name.toLowerCase());
      var link = document.createElement("a");
      link.className = "chat__item";
      link.href = PAGES.messages + "/" + encodeURIComponent(info.slug);
      var avatar = document.createElement("span");
      avatar.className = "chat__avatar";
      if (info.avatar) avatar.appendChild(info.avatar.cloneNode(true));
      var body = document.createElement("span");
      body.className = "chat__item-body";
      var head = document.createElement("span");
      head.className = "chat__item-top";
      var name = document.createElement("strong");
      name.textContent = info.name;
      var when = document.createElement("time");
      when.setAttribute("data-chat-when", "");
      head.appendChild(name);
      head.appendChild(when);
      var bottom = document.createElement("span");
      bottom.className = "chat__item-bottom";
      var preview = document.createElement("span");
      preview.className = "chat__preview";
      preview.setAttribute("data-chat-item-preview", "");
      bottom.appendChild(preview);
      body.appendChild(head);
      body.appendChild(bottom);
      link.appendChild(avatar);
      link.appendChild(body);
      li.appendChild(link);
      return li;
    }

    dialog.addEventListener("mx:chat-sent", function (event) {
      var detail = event.detail || {};
      if (!detail.slug) return;
      var root = event.target;
      var nameEl = root.querySelector(".chat__who-name span");
      var avatarEl = root.querySelector(".chat__thread-head .chat__avatar svg");
      sent[detail.slug] = { slug: detail.slug, text: detail.text, time: detail.time, at: Date.now(), name: nameEl ? nameEl.textContent : detail.slug, avatar: avatarEl };
      var list = cache[VIEWS.messages().url];
      if (list) { syncList(list); markActive(list); }
    });

    /* ------------------------------------------------------------------ Fermeture */

    function requestClose() {
      if (!dialog.open || closing) return;
      var depth = ownHistory();
      // On retire les entrées d'historique du panneau : « popstate » (profondeur 0) déclenche la fermeture.
      if (depth) { window.history.go(-depth); return; }
      animateClose();
    }

    function animateClose() {
      if (!dialog.open || closing) return;
      closing = true;
      dialog.classList.add("is-closing");
      if (reduceMotion) finishClose(); else window.setTimeout(finishClose, CLOSE_MS);
    }

    function finishClose(reopening) {
      if (!closing && !dialog.open) return;
      closing = false;
      token += 1;
      window.clearTimeout(swapTimer);
      dialog.classList.remove("is-closing");
      if (dialog.open) {
        closedByScript = true;
        dialog.close();
      }
      cleanup(reopening);
    }

    function cleanup(reopening) {
      document.documentElement.classList.remove("has-drawer");
      stack = [];
      content.replaceChildren();
      if (reopening || !trigger || !document.contains(trigger)) return;
      // Sur mobile, le menu latéral est replié : le focus revient sur le bouton du menu.
      var inHiddenSidebar = trigger.closest(".sidebar") && !document.querySelector(".dashboard.sidebar-open") && window.matchMedia("(max-width: 960px)").matches;
      var target = inHiddenSidebar ? document.querySelector("[data-sidebar-toggle]") : trigger;
      if (target) target.focus({ preventScroll: true });
    }

    // Échap : on anime la fermeture au lieu de la fermeture immédiate du navigateur.
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      requestClose();
    });

    // Fermeture imposée par le navigateur (ex. Échap répété) : remise en ordre.
    dialog.addEventListener("close", function () {
      if (closedByScript) { closedByScript = false; return; }
      if (closing) return;
      var depth = ownHistory();
      if (depth) { try { window.history.go(-depth); } catch (e) { /* rien */ } }
      cleanup(false);
    });

    dialog.addEventListener("click", function (event) {
      if (event.target.closest("[data-drawer-back]")) { back(); return; }
      if (event.target === dialog || event.target.closest("[data-drawer-close]")) requestClose();
    });

    MC.drawer = {
      openMessages: function () { open(VIEWS.messages(), null); },
      openChat: function (slug) { open(VIEWS.chat(slug), null); },
      openNotifications: function () { open(VIEWS.notifications(), null); },
      openProfile: function (slug) { open(VIEWS.profile(slug), null); },
      openMyProfile: function () { open(VIEWS.myprofile(), null); },
      openPreview: function () { open(VIEWS.preview(), null); },
      close: requestClose,
      /**
       * Contenu devenu périmé (nouvelle notification, conversation lue ailleurs…) : s'il n'est pas affiché,
       * il est oublié et sera rechargé à la prochaine ouverture ; affiché, il est mis à jour sur place.
       */
      forget: function (kind) {
        var view = VIEWS[kind] && VIEWS[kind]();
        if (!view) return;
        var el = cache[view.url];
        if (el && el.isConnected) return;
        delete cache[view.url];
        delete pending[view.url];
      },
    };
  });
})();
