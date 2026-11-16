/**
 * Messagerie guidée (client ↔ mandataire) : aucune saisie libre, seulement des messages préfaits qui
 * suivent le parcours d'une transaction (voir services/chatFlow.js pour les étapes).
 *
 * MC.initChat(root, scope) : affiche les messages d'une conversation ([data-chat-root]) et, selon l'étape
 * et le rôle (client ou mandataire), les réponses possibles : choix du compte, du montant (contrôlé en euros
 * contre le plafond du mandataire), envoi des coordonnées, de la preuve, validation, compte de réception,
 * capture du transfert (mandataire) puis évaluation obligatoire (client : note et appréciation préfaite).
 * MC.syncChatList(scope) : met à jour les aperçus de la liste des conversations.
 * MC.initChatSearch(scope) : recherche dans la liste des conversations.
 *
 * Démonstration : les messages sont enregistrés dans le stockage local du navigateur (clé partagée par les
 * deux espaces) ; deux onglets ouverts sur la même conversation se répondent en direct. À remplacer par
 * l'API du serveur (enregistrement, contrôles, notifications en temps réel).
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  if (MC.initChat) return; // script déjà chargé

  var STORE = "mandix:demo:conversation:";
  var CARD_NUMBER = /^\d{13,19}$/;
  var SEED_PHRASE = /^(?:[a-z]+\s+){11,23}[a-z]+$/i;
  var PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
  var PROOF_MAX = 5 * 1024 * 1024;

  /* ------------------------------------------------------------------ Icônes (SVG statiques) */
  function svg(paths, size) {
    return '<svg class="icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON = {
    read: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  };

  /* Évaluation obligatoire en fin de transaction : une note (1 à 5) et une appréciation préfaite (aucune saisie libre). */
  var RATING_LABELS = ["", "Très décevant", "Décevant", "Correct", "Très bien", "Excellent"];
  var APPRECIATIONS = {
    high: [["rapide_fiable", "Rapide et fiable"], ["professionnel", "Très professionnel"], ["recommande", "Je recommande"]],
    mid: [["correct", "Transaction correcte"], ["delai", "Un peu de délai, mais sérieux"]],
    low: [["trop_lent", "Délais trop longs"], ["communication", "Communication difficile"], ["decevant", "Expérience décevante"]],
  };
  var DAY_MS = 864e5;
  var MAX_FILES = 5;

  function appreciationsFor(rating) { return rating >= 4 ? APPRECIATIONS.high : rating === 3 ? APPRECIATIONS.mid : APPRECIATIONS.low; }

  /* ------------------------------------------------------------------ Mise en forme */
  function money(amount, currency) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount).replace(/ /g, " ");
  }
  var timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  var dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
  function dayKey(d) { return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
  function dayLabel(d) {
    var now = new Date();
    if (dayKey(d) === dayKey(now)) return "Aujourd'hui";
    if (dayKey(d) === dayKey(new Date(now.getTime() - 864e5))) return "Hier";
    return dateFmt.format(d);
  }
  function shortWhen(d) {
    var now = new Date();
    if (dayKey(d) === dayKey(now)) return timeFmt.format(d);
    if (dayKey(d) === dayKey(new Date(now.getTime() - 864e5))) return "Hier";
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(d);
  }
  function sizeLabel(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(bytes / 1024)) + " Ko";
  }

  /** Texte d'un message préfait (même rédaction que services/chatFlow.js). */
  function eventText(e) {
    var d = e.data || {};
    switch (e.type) {
      case "request": return "Je veux faire une transaction avec votre compte " + d.accountName + ".";
      case "ask_amount": return "Quel est le montant de votre transaction ?";
      case "amount": return "Montant de la transaction : " + d.label;
      case "receive_info": return "Voici mes coordonnées " + d.accountName + " pour la transaction." + (d.optionText ? " " + d.optionText + "." : "");
      case "proof": return "Preuve de paiement envoyée.";
      case "proof_status": return { pending: "En attente : le paiement n'est pas encore crédité sur mon compte.", validated: "Validé : paiement bien reçu.", rejected: "Rejeté : merci d'envoyer une nouvelle preuve." }[d.status] || "";
      case "credit_proof_request": return "Le délai de 7 jours est dépassé : merci de me prouver que l'argent n'est pas encore crédité sur votre compte.";
      case "credit_proof": return "Voici les preuves que l'argent n'est pas encore crédité.";
      case "credit_proof_ok": return "C'est bon, j'ai vérifié : ce n'est pas crédité.";
      case "verification_request": return "Il y a un problème avec ces preuves : je demande une vérification à Mandix.";
      case "verification_result": return d.authentic
        ? "Vérification Mandix : les preuves du mandataire sont authentiques, le paiement n'est pas encore crédité. Le délai de 7 jours repart."
        : "Vérification Mandix : les preuves du mandataire ne sont pas conformes. Notre équipe prend le dossier en charge.";
      case "receipt": return d.received ? "J'ai bien reçu l'argent." : "Je n'ai pas encore reçu l'argent.";
      case "payout_info": return "Envoyez l'argent sur mon compte " + d.accountName + "." + (d.optionText ? " " + d.optionText + "." : "");
      case "sent": return d.again ? "Voici une nouvelle preuve du transfert sur votre compte " + d.accountName + "." : "J'ai envoyé l'argent sur votre compte " + d.accountName + ". Voici la capture du transfert.";
      case "review": return "Évaluation : " + d.rating + "/5 · " + d.label + ". Transaction terminée.";
      default: return "";
    }
  }

  /** Étape en cours, déduite des messages échangés. */
  function deriveState(events) {
    var s = { step: "idle", account: null, amount: null, proofId: null, payout: null };
    events.forEach(function (e) {
      switch (e.type) {
        case "request": s = { step: "requested", requestId: e.id, account: e.data, amount: null, proofId: null, payout: null }; break;
        case "ask_amount": s.step = "amount_asked"; break;
        case "amount": s.step = "amount_given"; s.amount = e.data; break;
        case "receive_info": s.step = "info_sent"; break;
        case "proof": s.step = "proof_sent"; s.proofId = e.id; break;
        case "proof_status":
          s.step = e.data.status === "validated" ? "validated" : e.data.status === "rejected" ? "info_sent" : "proof_pending";
          if (e.data.status === "pending") s.pendingSince = e.at; // délai maximum de 7 jours
          break;
        case "credit_proof_request": s.step = "credit_requested"; break;
        case "credit_proof": s.step = "credit_proved"; break;
        case "credit_proof_ok": s.step = "proof_pending"; s.pendingSince = e.at; break;
        case "verification_request": s.step = "verifying"; break;
        case "verification_result": s.step = e.data.authentic ? "proof_pending" : "dispute"; if (e.data.authentic) s.pendingSince = e.at; break;
        case "payout_info": s.step = "payout_given"; s.payout = e.data; break;
        case "sent": s.step = "sent"; break; // le client confirme la réception, puis évalue
        case "receipt": s.step = e.data.received ? "received" : "not_received"; break;
        case "review": s.step = "idle"; break; // anciennes conversations de démonstration
      }
    });
    return s;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function toast(message, type) { if (MC.toast) MC.toast(message, type); }

  function storageKey(key) { return STORE + key; }

  /* Évaluations : enregistrées par la plateforme (démonstration : stockage local, hors de la conversation).
     Le mandataire ne reçoit aucun message ; sa note moyenne est mise à jour côté serveur. */
  var REVIEWS = "mandix:demo:reviews";
  function readReviews() {
    try { return JSON.parse(window.localStorage.getItem(REVIEWS)) || {}; } catch (e) { return {}; }
  }
  function saveReview(key, review) {
    var all = readReviews();
    (all[key] = all[key] || []).push(review);
    try { window.localStorage.setItem(REVIEWS, JSON.stringify(all)); return true; } catch (e) { return false; }
  }
  function readStored(key) {
    try { var raw = window.localStorage.getItem(storageKey(key)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ Conversation */

  MC.initChat = function (root, scope) {
    if (!root || root.getAttribute("data-chat-ready")) return;
    var flowNode = root.querySelector("[data-chat-flow]");
    if (!flowNode) return;
    root.setAttribute("data-chat-ready", "1");
    scope = scope || document;

    var flow = JSON.parse(flowNode.textContent);
    // Données réelles : envoi par socket.io (realtime.js), le serveur valide chaque étape. Sinon : démonstration locale.
    var socketMode = flow.transport === "socket" && !!MC.realtime;
    root.setAttribute("data-conversation-id", flow.conversationId || "");
    var role = flow.role;
    var other = flow.otherName;
    var first = (other || "").split(" ")[0];
    // « de Moussa », « d'Afiavi » : élision devant une voyelle ou un h.
    var de = function (name) { return (/^[aeiouyhàâäéèêëîïôöûü]/i.test(name || "") ? "d'" : "de ") + name; };
    var box = root.querySelector("[data-chat-messages]");
    var composer = root.querySelector("[data-flow-composer]");
    var events = socketMode ? flow.events.slice() : (readStored(flow.key) || flow.events.slice());
    var pendingProof = null;
    var pendingRating = 0;
    var pendingFiles = [];
    var pendingAppreciation = null;
    var uid = flow.key.replace(/[^a-z0-9]/gi, "") + Math.random().toString(36).slice(2, 6);

    function save() {
      try {
        window.localStorage.setItem(storageKey(flow.key), JSON.stringify(events));
        return true;
      } catch (e) {
        toast("Stockage de démonstration plein : impossible d'enregistrer ce message.", "danger");
        return false;
      }
    }

    function send(type, data) {
      if (socketMode) { sendRealtime(type, data); return; }
      var event = { id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), from: role, type: type, at: new Date().toISOString(), data: data || {} };
      events.push(event);
      if (!save()) { events.pop(); return; }
      pendingProof = null;
      pendingRating = 0;
      pendingAppreciation = null;
      pendingFiles = [];
      render();
      afterSent(event);
    }

    function afterSent(event) {
      var text = eventText(event);
      var preview = scope.querySelector("[data-chat-preview]");
      if (preview) preview.textContent = "Vous : " + text;
      root.dispatchEvent(new CustomEvent("mx:chat-sent", { bubbles: true, detail: { slug: root.getAttribute("data-chat-slug"), text: text, time: timeFmt.format(new Date()) } }));
    }

    /* ---------------------------------------------------------------- Temps réel (données réelles) */

    var sending = false;
    function resetPending() {
      pendingProof = null;
      pendingRating = 0;
      pendingAppreciation = null;
      pendingFiles = [];
    }
    function addEvent(event) {
      if (!event || events.some(function (e) { return e.id === event.id; })) return false;
      events.push(event);
      return true;
    }
    /** Fichier envoyé d'abord (vérifié et chiffré par le serveur), puis joint au message par son identifiant. */
    function uploadFile(file, kind) {
      var form = new FormData();
      form.append("kind", kind);
      form.append("fichier", file.file, file.name);
      return MC.api("/api/conversations/" + encodeURIComponent(flow.conversationId) + "/fichiers", { method: "POST", form: form });
    }
    function preparePayload(type, data) {
      if ((type === "proof" || type === "sent") && data && data.file) {
        return uploadFile(data, type === "proof" ? "payment_proof" : "transfer_proof").then(function (r) { return { attachmentId: r.attachmentId }; });
      }
      if (type === "credit_proof" && data && data.files) {
        return Promise.all(data.files.map(function (f) { return uploadFile(f, "credit_evidence"); }))
          .then(function (list) { return { attachmentIds: list.map(function (r) { return r.attachmentId; }) }; });
      }
      return Promise.resolve(data || {});
    }
    function sendRealtime(type, data) {
      if (sending) return;
      sending = true;
      var active = document.activeElement && composer.contains(document.activeElement) ? document.activeElement : null;
      if (active && MC.setBusy) MC.setBusy(active, true);
      composer.setAttribute("aria-busy", "true");
      composer.querySelectorAll("button, input, select").forEach(function (control) { if (control !== active) control.disabled = true; });
      preparePayload(type, data).then(function (payload) {
        return MC.realtime.request("message:send", { conversationId: flow.conversationId, mandataireSlug: flow.mandataireSlug, type: type, data: payload });
      }).then(function (reply) {
        if (!flow.conversationId && reply.conversationId) {
          flow.conversationId = reply.conversationId;
          root.setAttribute("data-conversation-id", reply.conversationId);
        }
        // Le message a pu arriver juste avant par la diffusion de la conversation : rien à redessiner alors.
        if (addEvent(reply.event)) { resetPending(); render(); }
        afterSent(reply.event);
      }).catch(function (error) {
        toast(error.message, "danger");
        renderComposer();
      }).then(function () {
        sending = false;
        composer.removeAttribute("aria-busy");
      });
    }

    /* ---------------------------------------------------------------- Messages */

    function proofStatus(proofId) {
      var status = null;
      events.forEach(function (e) { if (e.type === "proof_status" && e.data.proofId === proofId) status = e.data.status; });
      return status;
    }

    function secretBlock(value, copyable) {
      var wrap = el("div", "msg__secret");
      var code = el("code", "msg__secret-value", value);
      code.tabIndex = 0;
      wrap.appendChild(code);
      if (copyable) {
        var copy = el("button", "msg__copy");
        copy.type = "button";
        copy.setAttribute("aria-label", "Copier les coordonnées");
        copy.title = "Copier";
        copy.innerHTML = svg(ICON.copy, 15);
        copy.addEventListener("click", function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(function () { toast("Coordonnées copiées.", "success"); }, function () { toast("Copie impossible : sélectionnez le texte.", "warning"); });
          }
        });
        wrap.appendChild(copy);
      }
      return wrap;
    }

    function statusBadge(status) {
      var labels = { pending: ["En attente", "pending", ICON.clock], validated: ["Validé", "validated", ICON.check], rejected: ["Rejeté", "rejected", ICON.x] };
      var info = labels[status] || ["À vérifier", "new", ICON.clock];
      var badge = el("span", "msg__status msg__status--" + info[1]);
      badge.innerHTML = svg(info[2], 13);
      badge.appendChild(document.createTextNode(" " + info[0]));
      return badge;
    }

    /**
     * Lien d'un fichier du serveur (/fichiers/…) : précise l'espace de la page, pour que le serveur utilise la
     * bonne session quand le navigateur est connecté à la fois en client et en mandataire. Les aperçus locaux
     * (blob:, data:) sont laissés tels quels.
     */
    function fileUrl(url) {
      if (!url || !window.MC || !MC.space || url.indexOf("/fichiers/") !== 0) return url;
      return url + (url.indexOf("?") < 0 ? "?" : "&") + "espace=" + encodeURIComponent(MC.space);
    }

    /** Capture ou document joint (preuve de paiement, capture du transfert). */
    function attachment(d, label) {
      var wrap = el("span", "msg__attachment");
      if (d.preview) {
        var img = el("img", "msg__proof-image");
        img.src = fileUrl(d.preview);
        img.alt = label + " : " + (d.name || "image");
        wrap.appendChild(img);
      } else if (d.name) {
        var fileChip = el(d.url ? "a" : "span", "msg__file");
        if (d.url) { fileChip.href = fileUrl(d.url); fileChip.target = "_blank"; fileChip.rel = "noopener"; }
        fileChip.innerHTML = svg(ICON.file, 18);
        fileChip.appendChild(el("span", "msg__file-name", d.name));
        if (d.size) fileChip.appendChild(el("span", "msg__file-size", sizeLabel(d.size)));
        wrap.appendChild(fileChip);
      }
      return wrap;
    }

    function bubbleFor(e) {
      var mine = e.from === role;
      var bubble = el("div", "msg__bubble");
      var d = e.data || {};

      if (e.type === "request") {
        bubble.appendChild(el("span", null, eventText(e)));
      } else if (e.type === "amount") {
        bubble.appendChild(document.createTextNode("Montant de la transaction : "));
        bubble.appendChild(el("strong", null, d.label));
      } else if (e.type === "receive_info" || e.type === "payout_info") {
        bubble.appendChild(el("span", null, eventText(e)));
        // Coordonnées copiables par le destinataire (le client pour payer, le mandataire pour envoyer l'argent).
        bubble.appendChild(secretBlock(d.receive || "", !mine));
      } else if (e.type === "proof") {
        bubble.classList.add("msg__bubble--proof");
        bubble.appendChild(el("span", "msg__label", "Preuve de paiement"));
        bubble.appendChild(attachment({ name: d.name || "document", size: d.size, preview: d.preview }, "Preuve de paiement"));
        bubble.appendChild(statusBadge(proofStatus(e.id)));
      } else if (e.type === "sent") {
        bubble.classList.add("msg__bubble--proof", "msg__bubble--sent");
        var sentHead = el("span", "msg__sent-head");
        sentHead.innerHTML = svg(ICON.check, 16);
        sentHead.appendChild(el("span", null, eventText(e)));
        bubble.appendChild(sentHead);
        bubble.appendChild(attachment(d, "Capture du transfert"));
      } else if (e.type === "review") {
        bubble.classList.add("msg__bubble--review");
        bubble.appendChild(el("span", "msg__label", "Évaluation de la transaction"));
        var stars = el("span", "msg__stars");
        stars.setAttribute("role", "img");
        stars.setAttribute("aria-label", d.rating + " sur 5");
        for (var i = 1; i <= 5; i += 1) stars.insertAdjacentHTML("beforeend", svg(ICON.star, 18).replace('class="icon"', 'class="icon' + (i <= d.rating ? " is-on" : "") + '"'));
        stars.appendChild(el("strong", "msg__rating", RATING_LABELS[d.rating] || ""));
        bubble.appendChild(stars);
        bubble.appendChild(el("span", "msg__appreciation", "« " + d.label + " »"));
        bubble.appendChild(el("span", "msg__done", "Transaction terminée"));
      } else if (e.type === "credit_proof") {
        bubble.classList.add("msg__bubble--proof");
        bubble.appendChild(el("span", "msg__label", "Preuves : argent pas encore crédité"));
        bubble.appendChild(el("span", null, eventText(e)));
        var gallery = el("span", "msg__gallery");
        (d.files || []).forEach(function (f, i) { gallery.appendChild(attachment(f, "Preuve " + (i + 1))); });
        bubble.appendChild(gallery);
      } else if (e.type === "receipt" || e.type === "verification_request" || e.type === "credit_proof_request") {
        var rtone = e.type === "receipt" && d.received ? "validated" : "pending";
        bubble.classList.add("msg__bubble--status", "msg__bubble--" + rtone);
        var ricon = el("span", "msg__status-icon");
        ricon.innerHTML = svg(rtone === "validated" ? ICON.check : ICON.clock, 16);
        bubble.appendChild(ricon);
        bubble.appendChild(el("span", null, eventText(e)));
      } else if (e.type === "verification_result") {
        bubble.classList.add("msg__bubble--system", d.authentic ? "is-authentic" : "is-refused");
        bubble.appendChild(el("strong", "msg__system-title", "Équipe Mandix"));
        bubble.appendChild(el("span", null, eventText(e)));
      } else if (e.type === "proof_status") {
        var tone = d.status;
        bubble.classList.add("msg__bubble--status", "msg__bubble--" + tone);
        var icon = el("span", "msg__status-icon");
        icon.innerHTML = svg(tone === "validated" ? ICON.check : tone === "rejected" ? ICON.x : ICON.clock, 16);
        bubble.appendChild(icon);
        bubble.appendChild(el("span", null, eventText(e)));
      } else {
        bubble.appendChild(el("span", null, eventText(e)));
      }
      return bubble;
    }

    function renderMessages() {
      box.textContent = "";
      if (!events.length) {
        var intro = el("div", "chat__intro");
        intro.appendChild(el("p", "chat__intro-title", role === "client" ? "Démarrez une transaction avec " + first : "Aucune demande pour le moment"));
        intro.appendChild(el("p", "chat__intro-text", role === "client"
          ? "Choisissez ci-dessous le compte avec lequel vous souhaitez faire la transaction."
          : "Les demandes " + de(other) + " apparaîtront ici, avec les réponses à envoyer."));
        box.appendChild(intro);
        return;
      }
      var lastDay = "";
      events.forEach(function (e) {
        if (e.type === "review") return; // l'évaluation n'est pas un message
        var date = new Date(e.at);
        var label = dayLabel(date);
        if (label !== lastDay) {
          var day = el("div", "chat__day");
          day.appendChild(el("span", null, label));
          box.appendChild(day);
          lastDay = label;
        }
        var mine = e.from === role;
        var msg = el("div", "msg msg--" + (e.from === "system" ? "system" : mine ? "me" : "them") + " msg--" + e.type);
        msg.appendChild(bubbleFor(e));
        var meta = el("span", "msg__meta", timeFmt.format(date));
        if (mine) meta.insertAdjacentHTML("beforeend", " " + svg(ICON.read, 14));
        msg.appendChild(meta);
        box.appendChild(msg);
      });
    }

    /* ---------------------------------------------------------------- Réponses possibles */

    /** Délai maximum d'attente d'un paiement (7 jours) : échéance et jours restants. */
    function pendingInfo(since) {
      var start = new Date(since).getTime();
      var deadline = new Date(start + (flow.pendingMaxDays || 7) * DAY_MS);
      var left = Math.ceil((deadline.getTime() - Date.now()) / DAY_MS);
      return { deadline: deadline, left: left, expired: Date.now() >= deadline.getTime(), label: dateFmt.format(deadline) };
    }

    function panel(title) {
      var wrap = el("div", "flow");
      if (title) wrap.appendChild(el("p", "flow__title", title));
      return wrap;
    }

    function chip(text, onClick, options) {
      options = options || {};
      var button = el("button", "flow-chip" + (options.className ? " " + options.className : ""));
      button.type = "button";
      if (options.logo) {
        var logo = el("img", "flow-chip__logo");
        logo.src = options.logo;
        logo.alt = "";
        logo.width = 22;
        logo.height = 22;
        button.appendChild(logo);
      } else if (options.icon) {
        button.insertAdjacentHTML("beforeend", svg(options.icon, 17));
      }
      var body = el("span", "flow-chip__body");
      body.appendChild(el("span", "flow-chip__text", text));
      if (options.detail) body.appendChild(el("span", "flow-chip__detail", options.detail));
      button.appendChild(body);
      button.addEventListener("click", onClick);
      return button;
    }

    function waiting(text) {
      var wrap = el("div", "flow flow--waiting");
      var dots = el("span", "flow__dots");
      dots.setAttribute("aria-hidden", "true");
      dots.appendChild(el("span"));
      dots.appendChild(el("span"));
      dots.appendChild(el("span"));
      wrap.appendChild(dots);
      wrap.appendChild(el("p", "flow__wait-text", text));
      return wrap;
    }

    /** Plafond du mandataire en texte (null : niveau 10, plus de 10 000 € sans limite). */
    function limitText() {
      return flow.limitEur == null ? "plus de 10 000 € par transaction (sans plafond)" : money(flow.limitEur, "EUR") + " par transaction";
    }

    /** « 150 000 », « 1 250,50 » → nombre ; NaN si la saisie n'est pas un montant. */
    function parseAmount(text) {
      var t = String(text).replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
      return /^\d{1,12}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
    }

    /** Montant saisi par le client (devise du compte par défaut), contrôlé en euros contre le plafond. */
    function amountForm(state) {
      var wrap = panel("Indiquez le montant de votre transaction");
      var form = el("form", "flow__form flow__form--amount");
      form.noValidate = true;
      var base = "flow-amount-" + uid;
      var defaultCurrency = (state.account && state.account.currency) || "EUR";

      var amountField = el("div", "field flow__amount-field");
      var amountLabel = el("label", "field__label", "Montant");
      amountLabel.htmlFor = base + "-value";
      var input = el("input", "input flow__amount-input");
      input.id = base + "-value";
      input.type = "text";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.maxLength = 20;
      input.required = true;
      input.placeholder = "Ex. " + (defaultCurrency === "XOF" || defaultCurrency === "XAF" ? "150 000" : "250");
      amountField.appendChild(amountLabel);
      amountField.appendChild(input);

      var currencyField = el("div", "field flow__currency-field");
      var currencyLabel = el("label", "field__label", "Devise");
      currencyLabel.htmlFor = base + "-currency";
      var select = el("select", "select flow__currency");
      select.id = base + "-currency";
      Object.keys(flow.rates).forEach(function (c) {
        var option = el("option", null, c);
        option.value = c;
        if (c === defaultCurrency) option.selected = true;
        select.appendChild(option);
      });
      currencyField.appendChild(currencyLabel);
      currencyField.appendChild(select);

      var conversion = el("p", "field__hint flow__conversion");
      conversion.setAttribute("aria-live", "polite");
      var error = el("p", "field__error");
      error.hidden = true;
      error.setAttribute("role", "alert");
      input.setAttribute("aria-describedby", conversion.id = base + "-hint");

      function update() {
        error.hidden = true;
        input.removeAttribute("aria-invalid");
        var value = parseAmount(input.value);
        var rate = flow.rates[select.value] || 1;
        if (!value) { conversion.textContent = "Plafond " + de(first) + " : " + limitText() + "."; return; }
        var eur = value / rate;
        var converted = select.value === "EUR" ? "" : "Environ " + money(Math.round(eur * 100) / 100, "EUR") + " · ";
        conversion.textContent = converted + (converted ? "plafond" : "Plafond") + " " + de(first) + " : " + limitText() + ".";
      }
      input.addEventListener("input", update);
      select.addEventListener("change", update);
      update();

      var submit = el("button", "btn btn--primary flow__send");
      submit.type = "submit";
      submit.innerHTML = svg(ICON.send, 16);
      submit.appendChild(document.createTextNode(" Envoyer le montant"));

      form.appendChild(amountField);
      form.appendChild(currencyField);
      form.appendChild(conversion);
      form.appendChild(error);
      form.appendChild(submit);

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var value = parseAmount(input.value);
        var fail = function (message) { error.textContent = message; error.hidden = false; input.setAttribute("aria-invalid", "true"); input.focus(); };
        if (!value || value <= 0) return fail("Indiquez un montant en chiffres, par exemple " + input.placeholder.replace("Ex. ", "") + ".");
        var currency = select.value;
        var eur = Math.round((value / (flow.rates[currency] || 1)) * 100) / 100;
        if (flow.limitEur != null && eur > flow.limitEur + 0.005) {
          var message = "Montant au-delà du plafond " + de(first) + " : environ " + money(eur, "EUR") + " pour un plafond de " + money(flow.limitEur, "EUR") + " par transaction.";
          toast(message, "danger");
          return fail(message);
        }
        send("amount", { amount: value, currency: currency, eur: eur, label: money(value, currency) });
      });
      wrap.appendChild(form);
      return wrap;
    }

    /** Image réduite (900 px maximum) pour l'aperçu ; PDF : nom et taille uniquement. */
    function readProof(file, done) {
      if (file.type === "application/pdf") { done({ name: file.name, type: file.type, size: file.size, preview: null, file: file }); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, 900 / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          done({ name: file.name, type: file.type, size: file.size, preview: canvas.toDataURL("image/jpeg", 0.82), file: file });
        };
        img.onerror = function () { toast("Image illisible : choisissez un autre fichier.", "danger"); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }

    function proofUploader(rejected) {
      return fileUploader({
        title: rejected ? "Votre preuve a été rejetée : envoyez une nouvelle preuve" : "Après le paiement, envoyez votre preuve",
        button: "Envoyer la preuve",
        onSend: function (file) { send("proof", file); },
      });
    }

    /** Capture du transfert, obligatoire pour signaler l'envoi de l'argent (mandataire). */
    function transferUploader(state) {
      return fileUploader({
        title: "Envoyez l'argent sur le compte " + state.payout.accountName + (state.payout.optionLabel ? " (" + state.payout.optionLabel + ")" : "") + " " + de(first) + ", puis joignez la capture du transfert",
        button: "J'ai envoyé l'argent",
        onSend: function (file) {
          send("sent", { accountName: state.payout.accountName, name: file.name, type: file.type, size: file.size, preview: file.preview, file: file.file });
        },
      });
    }

    function fileUploader(opts) {
      var wrap = panel(opts.title);
      var input = el("input", "flow__file-input");
      input.type = "file";
      input.id = "flow-proof-" + uid;
      input.accept = PROOF_TYPES.join(",");
      var pick = el("label", "flow-upload");
      pick.htmlFor = input.id;
      pick.innerHTML = svg(ICON.upload, 18);
      var pickText = el("span", "flow-upload__body");
      pickText.appendChild(el("span", "flow-upload__text", pendingProof ? pendingProof.name : "Choisir une capture ou un document"));
      pickText.appendChild(el("small", "flow-upload__hint", pendingProof ? sizeLabel(pendingProof.size) + " · cliquez pour changer" : "Image (PNG, JPG, WebP) ou PDF · 5 Mo maximum"));
      pick.appendChild(pickText);
      if (pendingProof && pendingProof.preview) {
        var preview = el("img", "flow-upload__preview");
        preview.src = pendingProof.preview;
        preview.alt = "Aperçu de la preuve";
        pick.appendChild(preview);
      }
      wrap.appendChild(input);
      wrap.appendChild(pick);

      var sendButton = el("button", "btn btn--primary flow__send");
      sendButton.type = "button";
      sendButton.disabled = !pendingProof;
      sendButton.innerHTML = svg(ICON.send, 16);
      sendButton.appendChild(document.createTextNode(" " + opts.button));
      sendButton.addEventListener("click", function () { if (pendingProof) opts.onSend(pendingProof); });
      wrap.appendChild(sendButton);

      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (PROOF_TYPES.indexOf(file.type) === -1) { toast("Format non accepté : image (PNG, JPG, WebP) ou PDF.", "danger"); input.value = ""; return; }
        if (file.size > PROOF_MAX) { toast("Fichier trop lourd : 5 Mo maximum.", "danger"); input.value = ""; return; }
        readProof(file, function (proof) { pendingProof = proof; renderComposer(); });
      });
      return wrap;
    }

    /** Plusieurs captures ou documents (jusqu'à 5) : preuves que l'argent n'est pas encore crédité. */
    function multiUploader(opts) {
      var wrap = panel(opts.title);
      var input = el("input", "flow__file-input");
      input.type = "file";
      input.multiple = true;
      input.id = "flow-files-" + uid;
      input.accept = PROOF_TYPES.join(",");
      var pick = el("label", "flow-upload");
      pick.htmlFor = input.id;
      pick.innerHTML = svg(ICON.upload, 18);
      var pickText = el("span", "flow-upload__body");
      pickText.appendChild(el("span", "flow-upload__text", pendingFiles.length ? "Ajouter d'autres captures" : "Choisir des captures ou des documents"));
      pickText.appendChild(el("small", "flow-upload__hint", pendingFiles.length + " / " + MAX_FILES + " · image (PNG, JPG, WebP) ou PDF · 5 Mo chacun"));
      pick.appendChild(pickText);
      wrap.appendChild(input);
      if (pendingFiles.length < MAX_FILES) wrap.appendChild(pick);

      if (pendingFiles.length) {
        var list = el("ul", "flow-files");
        pendingFiles.forEach(function (f, index) {
          var item = el("li", "flow-files__item");
          if (f.preview) { var img = el("img", "flow-files__thumb"); img.src = f.preview; img.alt = ""; item.appendChild(img); }
          else { var ic = el("span", "flow-files__thumb flow-files__thumb--doc"); ic.innerHTML = svg(ICON.file, 18); item.appendChild(ic); }
          item.appendChild(el("span", "flow-files__name", f.name));
          var remove = el("button", "flow-files__remove");
          remove.type = "button";
          remove.setAttribute("aria-label", "Retirer " + f.name);
          remove.innerHTML = svg(ICON.x, 14);
          remove.addEventListener("click", function () { pendingFiles.splice(index, 1); renderComposer(); });
          item.appendChild(remove);
          list.appendChild(item);
        });
        wrap.appendChild(list);
      }

      var sendButton = el("button", "btn btn--primary flow__send");
      sendButton.type = "button";
      sendButton.disabled = !pendingFiles.length;
      sendButton.innerHTML = svg(ICON.send, 16);
      sendButton.appendChild(document.createTextNode(" " + opts.button));
      sendButton.addEventListener("click", function () { if (pendingFiles.length) opts.onSend(pendingFiles.slice()); });
      wrap.appendChild(sendButton);
      if (opts.extra) wrap.appendChild(opts.extra);

      input.addEventListener("change", function () {
        var files = Array.prototype.slice.call(input.files || []);
        var room = MAX_FILES - pendingFiles.length;
        if (files.length > room) toast("5 fichiers maximum : seuls les premiers sont ajoutés.", "warning");
        files.slice(0, room).forEach(function (file) {
          if (PROOF_TYPES.indexOf(file.type) === -1) { toast("Format non accepté : " + file.name + " (image ou PDF uniquement).", "danger"); return; }
          if (file.size > PROOF_MAX) { toast("Fichier trop lourd : " + file.name + " (5 Mo maximum).", "danger"); return; }
          readProof(file, function (proof) { if (pendingFiles.length < MAX_FILES) { pendingFiles.push(proof); renderComposer(); } });
        });
        input.value = "";
      });
      return wrap;
    }

    /** Le paiement est finalement arrivé : le mandataire peut valider à tout moment pendant l'attente. */
    function lateValidation(state, text) {
      var row = el("div", "flow__actions flow__actions--late");
      row.appendChild(el("span", "flow__note", text || "Le paiement est arrivé entre-temps ?"));
      row.appendChild(chip("Valider", function () { send("proof_status", { status: "validated", proofId: state.proofId }); }, { icon: ICON.check, className: "flow-chip--validate" }));
      return row;
    }

    function payoutForm() {
      var wrap = panel("Paiement validé : sur quel compte souhaitez-vous recevoir l'argent ?");
      var form = el("form", "flow__form");
      form.noValidate = true;
      var base = "flow-payout-" + uid;

      var typeLabel = el("label", "field__label", "Compte de réception");
      typeLabel.htmlFor = base + "-type";
      var type = el("select", "select");
      type.id = base + "-type";
      flow.payoutTypes.forEach(function (t) {
        var option = el("option", null, t.name);
        option.value = t.slug;
        type.appendChild(option);
      });

      var valueLabel = el("label", "field__label");
      valueLabel.htmlFor = base + "-value";
      var value = el("input", "input flow__receive");
      value.id = base + "-value";
      value.autocomplete = "off";
      value.spellcheck = false;
      value.maxLength = 200;
      value.required = true;

      // Option du compte (PayPal : type d'envoi ; virement : mode), obligatoire quand le compte en a une.
      var optionField = el("fieldset", "field flow-options");
      var optionLegend = el("legend", "field__label");
      optionField.appendChild(optionLegend);
      var optionRow = el("div", "flow-options__row");
      optionField.appendChild(optionRow);
      var optionError = el("p", "field__error");
      optionError.hidden = true;
      optionError.setAttribute("role", "alert");
      optionField.appendChild(optionError);
      function currentType() { return flow.payoutTypes.filter(function (t) { return t.slug === type.value; })[0] || {}; }
      function syncOptions() {
        var opts = currentType().options;
        optionRow.textContent = "";
        optionError.hidden = true;
        optionField.hidden = !opts;
        if (!opts) return;
        optionLegend.textContent = opts.label;
        opts.items.forEach(function (item, i) {
          var label = el("label", "flow-option");
          var radio = el("input");
          radio.type = "radio";
          radio.name = base + "-option";
          radio.value = item[0];
          radio.id = base + "-option-" + i;
          radio.addEventListener("change", function () { optionError.hidden = true; });
          label.appendChild(radio);
          label.appendChild(el("span", null, item[1]));
          optionRow.appendChild(label);
        });
      }
      var error = el("p", "field__error");
      error.hidden = true;
      error.setAttribute("role", "alert");

      function syncType() {
        var info = flow.payoutTypes.filter(function (t) { return t.slug === type.value; })[0] || {};
        valueLabel.textContent = info.receiveLabel || "Coordonnées de réception";
        value.placeholder = info.receivePlaceholder || "";
      }
      type.addEventListener("change", function () { syncType(); syncOptions(); });
      syncType();
      syncOptions();

      var submit = el("button", "btn btn--primary flow__send");
      submit.type = "submit";
      submit.innerHTML = svg(ICON.send, 16);
      submit.appendChild(document.createTextNode(" Envoyer"));

      var fieldType = el("div", "field");
      fieldType.appendChild(typeLabel);
      fieldType.appendChild(type);
      var fieldValue = el("div", "field");
      fieldValue.appendChild(valueLabel);
      fieldValue.appendChild(value);
      fieldValue.appendChild(error);
      form.appendChild(fieldType);
      form.appendChild(fieldValue);
      form.appendChild(optionField);
      form.appendChild(submit);

      value.addEventListener("input", function () { error.hidden = true; });
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var text = value.value.trim();
        var compact = text.replace(/[\s-]/g, "");
        var fail = function (message) { error.textContent = message; error.hidden = false; value.focus(); };
        if (!text) return fail("Indiquez les coordonnées de réception.");
        if (CARD_NUMBER.test(compact)) return fail("Ceci ressemble à un numéro de carte : indiquez plutôt l'IBAN ou l'identifiant de réception.");
        if (SEED_PHRASE.test(text)) return fail("Ceci ressemble à une phrase de récupération : ne la communiquez jamais.");
        var info = currentType();
        var payload = { accountType: type.value, accountName: info.name || type.value, receive: text };
        if (info.options) {
          var picked = form.querySelector('input[name="' + base + '-option"]:checked');
          if (!picked) { optionError.textContent = "Choisissez : " + info.options.label.toLowerCase() + "."; optionError.hidden = false; optionRow.querySelector("input").focus(); return; }
          var chosen = info.options.items.filter(function (item) { return item[0] === picked.value; })[0];
          payload.option = chosen[0];
          payload.optionLabel = chosen[1];
          payload.optionText = info.options.label + " : " + chosen[1];
        }
        send("payout_info", payload);
      });
      wrap.appendChild(form);
      return wrap;
    }

    /**
     * Mandataire, compte ajouté sans coordonnées (aucune case E-mail ni RIB cochée) : il saisit où recevoir
     * l'argent pour cette transaction (e-mail, RIB…), et l'option du compte s'il en a une (PayPal, virement).
     * Le serveur applique les mêmes contrôles (jamais de numéro de carte ni de phrase de récupération).
     */
    function receiveForm(account, options) {
      var form = el("form", "flow__form");
      form.noValidate = true;
      var base = "flow-receive-" + uid;

      var label = el("label", "field__label", "Vos coordonnées " + account.name + " pour recevoir l'argent");
      label.htmlFor = base + "-value";
      var value = el("input", "input flow__receive");
      value.id = base + "-value";
      value.autocomplete = "off";
      value.spellcheck = false;
      value.maxLength = 200;
      value.placeholder = "E-mail, RIB…";
      var error = el("p", "field__error");
      error.hidden = true;
      error.setAttribute("role", "alert");
      var field = el("div", "field");
      field.appendChild(label);
      field.appendChild(value);
      field.appendChild(error);
      form.appendChild(field);

      var optionError = el("p", "field__error");
      optionError.hidden = true;
      optionError.setAttribute("role", "alert");
      if (options) {
        var optionField = el("fieldset", "field flow-options");
        optionField.appendChild(el("legend", "field__label", options.label));
        var row = el("div", "flow-options__row");
        options.items.forEach(function (item, i) {
          var option = el("label", "flow-option");
          var radio = el("input");
          radio.type = "radio";
          radio.name = base + "-option";
          radio.value = item[0];
          radio.id = base + "-option-" + i;
          radio.addEventListener("change", function () { optionError.hidden = true; });
          option.appendChild(radio);
          option.appendChild(el("span", null, item[1]));
          row.appendChild(option);
        });
        optionField.appendChild(row);
        optionField.appendChild(optionError);
        form.appendChild(optionField);
      }

      var submit = el("button", "btn btn--primary flow__send");
      submit.type = "submit";
      submit.innerHTML = svg(ICON.send, 16);
      submit.appendChild(document.createTextNode(" Envoyer mes coordonnées"));
      form.appendChild(submit);

      value.addEventListener("input", function () { error.hidden = true; });
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var text = value.value.trim();
        var compact = text.replace(/[\s-]/g, "");
        var fail = function (message) { error.textContent = message; error.hidden = false; value.focus(); };
        if (text.length < 3) return fail("Indiquez vos coordonnées de réception (e-mail, RIB…).");
        if (CARD_NUMBER.test(compact)) return fail("Ceci ressemble à un numéro de carte : indiquez plutôt le RIB ou l'e-mail du compte.");
        if (SEED_PHRASE.test(text)) return fail("Ceci ressemble à une phrase de récupération : ne la communiquez jamais.");
        var payload = { accountName: account.name, accountType: account.type, receive: text };
        if (options) {
          var picked = form.querySelector('input[name="' + base + '-option"]:checked');
          if (!picked) { optionError.textContent = "Choisissez : " + options.label.toLowerCase() + "."; optionError.hidden = false; form.querySelector('input[type="radio"]').focus(); return; }
          var chosen = options.items.filter(function (item) { return item[0] === picked.value; })[0];
          payload.option = chosen[0];
          payload.optionLabel = chosen[1];
          payload.optionText = options.label + " : " + chosen[1];
        }
        send("receive_info", payload);
      });
      return form;
    }

    /** Note (1 à 5) puis appréciation préfaite ; l'envoi clôt la transaction. Obligatoire. */
    function reviewForm() {
      var wrap = panel("Argent reçu : évaluez " + first + " pour terminer la transaction");
      wrap.classList.add("flow--review");
      var stars = el("div", "flow-stars");
      stars.setAttribute("role", "radiogroup");
      stars.setAttribute("aria-label", "Note sur 5");
      var ratingLabel = el("span", "flow-stars__label", pendingRating ? RATING_LABELS[pendingRating] : "Choisissez une note");
      function pick(value) {
        pendingRating = value;
        var allowed = appreciationsFor(value).map(function (a) { return a[0]; });
        if (allowed.indexOf(pendingAppreciation) === -1) pendingAppreciation = null;
        renderComposer();
        var again = composer.querySelector('.flow-star[data-value="' + value + '"]');
        if (again) again.focus();
      }
      for (var i = 1; i <= 5; i += 1) {
        (function (value) {
          var b = el("button", "flow-star" + (value <= pendingRating ? " is-on" : ""));
          b.type = "button";
          b.setAttribute("role", "radio");
          b.setAttribute("data-value", String(value));
          b.setAttribute("aria-checked", value === pendingRating ? "true" : "false");
          b.setAttribute("aria-label", value + (value > 1 ? " étoiles" : " étoile") + " sur 5 : " + RATING_LABELS[value]);
          b.tabIndex = value === (pendingRating || 1) ? 0 : -1;
          b.innerHTML = svg(ICON.star, 30);
          b.addEventListener("click", function () { pick(value); });
          b.addEventListener("keydown", function (event) {
            var step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            pick(Math.min(5, Math.max(1, (pendingRating || 0) + step)));
          });
          stars.appendChild(b);
        })(i);
      }
      var row = el("div", "flow-stars__row");
      row.appendChild(stars);
      row.appendChild(ratingLabel);
      wrap.appendChild(row);

      if (pendingRating) {
        var chips = el("div", "flow__chips flow__chips--appreciation");
        chips.setAttribute("role", "group");
        chips.setAttribute("aria-label", "Votre appréciation");
        appreciationsFor(pendingRating).forEach(function (a) {
          var c = chip(a[1], function () {
            pendingAppreciation = a[0];
            renderComposer();
            var me = composer.querySelector('[data-appreciation="' + a[0] + '"]');
            if (me) me.focus();
          }, { className: "flow-chip--choice" + (pendingAppreciation === a[0] ? " is-selected" : "") });
          c.setAttribute("data-appreciation", a[0]);
          c.setAttribute("aria-pressed", pendingAppreciation === a[0] ? "true" : "false");
          chips.appendChild(c);
        });
        wrap.appendChild(chips);
      }

      var submit = el("button", "btn btn--primary flow__send");
      submit.type = "button";
      submit.disabled = !(pendingRating && pendingAppreciation);
      submit.innerHTML = svg(ICON.send, 16);
      submit.appendChild(document.createTextNode(" Envoyer mon évaluation"));
      submit.addEventListener("click", function () {
        var chosen = appreciationsFor(pendingRating).filter(function (a) { return a[0] === pendingAppreciation; })[0];
        if (!pendingRating || !chosen) { toast("Choisissez une note puis une appréciation.", "warning"); return; }
        var current = deriveState(events);
        if (socketMode) {
          if (MC.setBusy) MC.setBusy(submit, true);
          MC.realtime.request("review:submit", { conversationId: flow.conversationId, rating: pendingRating, appreciation: chosen[0] }).then(function () {
            flow.reviewed = (flow.reviewed || []).concat([current.requestId]);
            pendingRating = 0;
            pendingAppreciation = null;
            toast("Votre évaluation est enregistrée : elle compte dans la note " + de(first) + ".", "success", "Merci !");
            renderComposer();
          }).catch(function (error) {
            if (MC.setBusy) MC.setBusy(submit, false);
            toast(error.message, "danger");
          });
          return;
        }
        if (!saveReview(flow.key, { requestId: current.requestId, rating: pendingRating, appreciation: chosen[0], at: new Date().toISOString() })) {
          toast("Stockage de démonstration plein : évaluation non enregistrée.", "danger");
          return;
        }
        pendingRating = 0;
        pendingAppreciation = null;
        toast("Merci ! Votre évaluation est enregistrée : elle compte dans la note " + de(first) + ".", "success");
        renderComposer();
      });
      wrap.appendChild(submit);
      wrap.appendChild(el("p", "flow__note", "Obligatoire pour clôturer la transaction. Votre évaluation est enregistrée par Mandix et compte dans la note " + de(first) + " ; elle n'apparaît pas dans la conversation."));
      return wrap;
    }

    function renderComposer() {
      composer.textContent = "";
      var state = deriveState(events);
      if (state.step === "received") {
        var reviewed = (flow.reviewed || []).concat((readReviews()[flow.key] || []).map(function (r) { return r.requestId; }));
        if (role === "mandataire" || reviewed.indexOf(state.requestId) !== -1) state.step = "idle";
      }
      var node;

      if (role === "client") {
        if (state.step === "idle") {
          node = panel(events.length ? "Nouvelle transaction : choisissez le compte" : "Choisissez votre message");
          var list = el("div", "flow__chips");
          flow.accounts.forEach(function (a) {
            list.appendChild(chip("Je veux faire une transaction avec votre compte " + a.name, function () {
              send("request", { accountId: a.id, accountType: a.type, accountName: a.name, currency: a.currency, country: a.country });
            }));
          });
          if (!flow.accounts.length) list.appendChild(el("p", "flow__note", first + " n'a pas encore de compte publié."));
          node.appendChild(list);
        } else if (state.step === "amount_asked") {
          node = amountForm(state);
        } else if (state.step === "info_sent") {
          node = proofUploader(events[events.length - 1].type === "proof_status");
        } else if (state.step === "validated") {
          node = payoutForm();
        } else if (state.step === "sent") {
          node = panel("Avez-vous reçu l'argent sur votre compte " + (state.payout ? state.payout.accountName : "") + " ?");
          var receipt = el("div", "flow__actions");
          receipt.appendChild(chip("J'ai bien reçu l'argent", function () { send("receipt", { received: true }); }, { icon: ICON.check, className: "flow-chip--validate" }));
          receipt.appendChild(chip("Je n'ai pas encore reçu l'argent", function () { send("receipt", { received: false }); }, { icon: ICON.clock, className: "flow-chip--pending" }));
          node.appendChild(receipt);
          node.appendChild(el("p", "flow__note", "Confirmez la réception avant d'évaluer la transaction."));
        } else if (state.step === "not_received") {
          node = panel("Vous n'avez pas encore reçu l'argent");
          node.appendChild(el("p", "flow__note", first + " peut vous envoyer une nouvelle preuve du transfert. Dès réception, confirmez-le :"));
          node.appendChild(chip("J'ai bien reçu l'argent", function () { send("receipt", { received: true }); }, { icon: ICON.check, className: "flow-chip--validate" }));
        } else if (state.step === "received") {
          node = reviewForm();
        } else if (state.step === "proof_pending") {
          var info = pendingInfo(state.pendingSince);
          node = panel("Paiement en attente chez " + first);
          node.appendChild(el("p", "flow__note", info.expired
            ? "Le délai maximum de 7 jours est dépassé (" + info.label + ")."
            : first + " n'a pas encore reçu le paiement. Délai maximum : le " + info.label + " (encore " + info.left + " jour" + (info.left > 1 ? "s" : "") + ")."));
          if (info.expired) node.appendChild(chip("Demander une preuve que l'argent n'est pas encore crédité", function () { send("credit_proof_request"); }, { icon: ICON.file }));
        } else if (state.step === "credit_proved") {
          node = panel("Examinez les preuves " + de(first));
          var answer = el("div", "flow__actions");
          answer.appendChild(chip("C'est bon, j'ai vérifié : ce n'est pas crédité", function () { send("credit_proof_ok"); }, { icon: ICON.check, className: "flow-chip--validate" }));
          answer.appendChild(chip("Il y a un problème avec ces preuves : demander une vérification", function () { send("verification_request"); }, { icon: ICON.x, className: "flow-chip--reject" }));
          node.appendChild(answer);
        } else {
          node = waiting({
            credit_requested: first + " prépare les preuves que l'argent n'est pas encore crédité…",
            verifying: "L'équipe Mandix vérifie les preuves " + de(first) + ". Vous recevrez une notification avec le résultat.",
            dispute: "Litige en cours : l'équipe Mandix traite votre dossier avec " + first + ".",
            requested: first + " va vous demander le montant de la transaction…",
            amount_given: first + " va vous envoyer ses coordonnées de paiement…",
            proof_sent: first + " vérifie votre preuve de paiement…",
            proof_pending: first + " vérifie votre preuve de paiement…",
            payout_given: first + " va vous envoyer l'argent et la capture du transfert…",
          }[state.step] || "En attente " + de(first) + "…");
        }
      } else {
        if (state.step === "requested") {
          node = panel("Réponse à envoyer");
          node.appendChild(chip("Quel est le montant de votre transaction ?", function () { send("ask_amount"); }));
        } else if (state.step === "amount_given") {
          var account = flow.accounts.filter(function (a) { return a.id === state.account.accountId; })[0]
            || flow.accounts.filter(function (a) { return a.type === state.account.accountType; })[0];
          var options = account ? account.options : null;
          node = panel("Envoyez vos coordonnées " + state.account.accountName + (options ? " et choisissez " + options.choose : ""));
          if (account && account.receive && options) {
            options.items.forEach(function (item) {
              node.appendChild(chip("Voici mes coordonnées " + account.name + " · " + item[1], function () {
                send("receive_info", { accountName: account.name, accountType: account.type, receive: account.receive, option: item[0], optionLabel: item[1], optionText: options.label + " : " + item[1] });
              }, { logo: account.logo, detail: account.receive, className: "flow-chip--receive" }));
            });
          } else if (account && account.receive) {
            node.appendChild(chip("Voici mes coordonnées " + account.name + " pour la transaction.", function () {
              send("receive_info", { accountName: account.name, accountType: account.type, receive: account.receive });
            }, { logo: account.logo, detail: account.receive, className: "flow-chip--receive" }));
          } else if (account) {
            // Compte ajouté sans E-mail ni RIB : les coordonnées sont saisies pour cette transaction.
            node.appendChild(receiveForm(account, options));
          } else {
            node.appendChild(el("p", "flow__note", "Ce compte a été retiré de votre profil."));
          }
        } else if (state.step === "proof_sent" || state.step === "proof_pending") {
          node = panel(state.step === "proof_pending" ? "Paiement en attente : votre décision" : "Preuve de paiement reçue : votre décision");
          if (state.step === "proof_pending") {
            var pinfo = pendingInfo(state.pendingSince);
            node.appendChild(el("p", "flow__note", pinfo.expired
              ? "Délai maximum de 7 jours dépassé : " + other + " peut vous demander une preuve que l'argent n'est pas crédité."
              : "Délai maximum : le " + pinfo.label + " (encore " + pinfo.left + " jour" + (pinfo.left > 1 ? "s" : "") + ")."));
          }
          var actions = el("div", "flow__actions");
          if (state.step === "proof_sent") {
            actions.appendChild(chip("En attente", function () { send("proof_status", { status: "pending", proofId: state.proofId }); }, { icon: ICON.clock, className: "flow-chip--pending" }));
          }
          actions.appendChild(chip("Valider", function () { send("proof_status", { status: "validated", proofId: state.proofId }); }, { icon: ICON.check, className: "flow-chip--validate" }));
          actions.appendChild(chip("Rejeter", function () { send("proof_status", { status: "rejected", proofId: state.proofId }); }, { icon: ICON.x, className: "flow-chip--reject" }));
          node.appendChild(actions);
        } else if (state.step === "credit_requested") {
          node = multiUploader({
            title: other + " demande une preuve que l'argent n'est pas encore crédité : envoyez toutes vos captures",
            button: "Envoyer les preuves",
            onSend: function (files) { send("credit_proof", { files: files }); },
            extra: lateValidation(state),
          });
        } else if (state.step === "credit_proved" || state.step === "verifying" || state.step === "dispute") {
          node = el("div", "flow-stack");
          node.appendChild(waiting({
            credit_proved: other + " examine vos preuves…",
            verifying: "L'équipe Mandix vérifie vos preuves à la demande " + de(other) + "…",
            dispute: "Litige : l'équipe Mandix vous contactera au sujet de vos preuves.",
          }[state.step]));
          node.appendChild(lateValidation(state));
        } else if (state.step === "payout_given") {
          node = transferUploader(state);
        } else if (state.step === "not_received") {
          node = fileUploader({
            title: other + " n'a pas encore reçu l'argent : envoyez une nouvelle preuve du transfert",
            button: "Envoyer la nouvelle preuve",
            onSend: function (file) {
              send("sent", { accountName: state.payout.accountName, again: true, name: file.name, type: file.type, size: file.size, preview: file.preview, file: file.file });
            },
          });
        } else {
          node = waiting({
            idle: events.length ? "En attente d'une nouvelle demande " + de(other) + "…" : "En attente d'une demande " + de(other) + "…",
            amount_asked: other + " indique le montant de la transaction…",
            info_sent: other + " effectue le paiement et vous enverra une preuve…",
            validated: other + " indique le compte sur lequel recevoir l'argent…",
            sent: other + " confirme la réception de l'argent…",
          }[state.step] || "En attente " + de(other) + "…");
        }
      }
      composer.appendChild(node);
    }

    // La conversation reste calée sur le dernier message, sauf si l'utilisateur remonte dans l'historique ;
    // une image jointe qui finit de se charger (preuve, capture) ne doit pas la décaler.
    var pinned = true;
    box.addEventListener("scroll", function () { pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 48; }, { passive: true });

    function render() {
      renderMessages();
      renderComposer();
      box.scrollTop = box.scrollHeight;
      pinned = true;
      box.querySelectorAll("img").forEach(function (img) {
        if (img.complete) return;
        img.addEventListener("load", function () { if (pinned) box.scrollTop = box.scrollHeight; }, { once: true });
      });
    }

    if (socketMode) {
      // Salon de la conversation (après vérification côté serveur) ; resynchronisé après une coupure réseau.
      var join = function () {
        if (!flow.conversationId || !root.isConnected) return;
        MC.realtime.request("conversation:join", { conversationId: flow.conversationId }).then(function (reply) {
          if (reply.events) { events = reply.events; render(); }
        }).catch(function () {});
      };
      join();
      MC.realtime.onReconnect(join);
      var onMessage = function (payload) {
        if (!root.isConnected) { MC.realtime.socket.off("message:new", onMessage); return; }
        if (!payload || payload.conversationId !== flow.conversationId) return;
        if (addEvent(payload.event)) {
          if (payload.event.from === role) resetPending(); // mon propre message, confirmé par le serveur
          render();
          if (document.visibilityState === "visible") MC.realtime.socket.emit("conversation:read", { conversationId: flow.conversationId });
        }
      };
      MC.realtime.socket.on("message:new", onMessage);
    }

    // Autre onglet (l'autre partie, en démonstration) : la conversation se met à jour en direct.
    window.addEventListener("storage", function (event) {
      if (socketMode || event.key !== storageKey(flow.key)) return;
      events = readStored(flow.key) || flow.events.slice();
      render();
    });

    render();
  };

  /** Aperçus de la liste des conversations, d'après les messages enregistrés (démonstration). */
  MC.syncChatList = function (scope) {
    var container = scope || document;
    var roleHolder = container.querySelector("[data-chat-role]") || document.querySelector("[data-chat-role]");
    var role = roleHolder ? roleHolder.getAttribute("data-chat-role") : null;
    container.querySelectorAll("[data-chat-item][data-chat-key]").forEach(function (item) {
      var events = readStored(item.getAttribute("data-chat-key"));
      if (!events || !events.length) return;
      var last = events[events.length - 1];
      var preview = item.querySelector("[data-chat-item-preview]");
      var when = item.querySelector("[data-chat-when]");
      if (preview) preview.textContent = (role && last.from === role ? "Vous : " : "") + eventText(last);
      if (when) when.textContent = shortWhen(new Date(last.at));
    });
  };

  /** Recherche dans la liste des conversations (page Messages, panneau latéral). */
  MC.initChatSearch = function (scope) {
    var search = scope.querySelector("[data-chat-search]");
    if (!search || search.getAttribute("data-search-ready")) return;
    search.setAttribute("data-search-ready", "1");
    var noResult = scope.querySelector("[data-chat-noresult]");
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      var visible = 0;
      scope.querySelectorAll("[data-chat-item]").forEach(function (item) {
        var match = !q || item.getAttribute("data-name").indexOf(q) !== -1;
        item.hidden = !match;
        if (match) visible++;
      });
      if (noResult) noResult.hidden = visible !== 0;
    });
  };

  // Message reçu depuis l'autre partie (autre onglet, en démonstration) : les aperçus de la liste suivent.
  window.addEventListener("storage", function (event) {
    if (event.key && event.key.indexOf(STORE) === 0) MC.syncChatList(document);
  });

  document.addEventListener("DOMContentLoaded", function () {
    var page = document.querySelector(".chat");
    if (!page) return;
    MC.syncChatList(page);
    MC.initChat(page.querySelector("[data-chat-root]"), page);
    MC.initChatSearch(page);
  });
})();
