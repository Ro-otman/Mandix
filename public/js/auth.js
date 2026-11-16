/** Pages d'authentification : robustesse du mot de passe, choix client / professionnel. */
(function () {
  "use strict";

  var LABELS = ["Trop court", "Faible", "Correct", "Solide", "Excellent"];

  function score(value) {
    if (value.length < 10) return 0;
    var s = 1;
    if (/[a-z]/i.test(value) && /\d/.test(value)) s++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) s++;
    if (/[^A-Za-z0-9]/.test(value) || value.length >= 14) s++;
    return Math.min(s, 4);
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Indicateur de robustesse
    document.querySelectorAll("[data-strength]").forEach(function (input) {
      var field = input.closest(".field");
      var meter = field.querySelector(".strength");
      var text = field.querySelector("[data-strength-text]");
      var initial = text ? text.textContent : "";
      input.addEventListener("input", function () {
        var s = input.value ? score(input.value) : -1;
        meter.setAttribute("data-score", String(s));
        if (text) text.textContent = s < 0 ? initial : "Robustesse : " + LABELS[s] + (s === 0 ? " (10 caractères minimum)" : "");
      });
    });

    // Confirmation du mot de passe : les deux saisies doivent être identiques.
    // L'erreur s'affiche pendant la saisie (dès que la confirmation atteint la longueur du mot de passe) ou à
    // l'envoi, jamais à la sortie du champ : le texte qui apparaît décalerait la case des conditions sous le clic.
    document.querySelectorAll("[data-password-confirm]").forEach(function (confirm) {
      var original = document.getElementById(confirm.getAttribute("data-password-confirm"));
      var error = confirm.closest(".field").querySelector("[data-password-confirm-error]");
      if (!original) return;
      function check(show) {
        var mismatch = confirm.value !== "" && confirm.value !== original.value;
        confirm.setCustomValidity(mismatch ? "Les deux mots de passe ne correspondent pas." : "");
        if (!show && mismatch) return;
        if (error) error.hidden = !mismatch;
        if (mismatch) confirm.setAttribute("aria-invalid", "true"); else confirm.removeAttribute("aria-invalid");
      }
      confirm.addEventListener("input", function () { check(confirm.value.length >= original.value.length); });
      original.addEventListener("input", function () { if (confirm.value) check(false); });
      // À l'envoi : le navigateur signale le champ invalide (« invalid ») avant tout événement « submit ».
      confirm.addEventListener("invalid", function () { check(true); });
    });

    // Zones de téléversement : affiche le nom du fichier choisi
    document.querySelectorAll("[data-upload]").forEach(function (input) {
      input.addEventListener("change", function () {
        var zone = input.closest(".upload");
        var action = zone.querySelector(".upload__action");
        var file = input.files && input.files[0];
        zone.classList.toggle("is-filled", !!file);
        if (file) action.textContent = file.name.length > 26 ? file.name.slice(0, 23) + "…" : file.name;
      });
    });

    // Onglets Client / Professionnel de la connexion : chaque onglet n'accepte que son type de compte
    // (contrôlé par le serveur via le champ « espace »). Le changement est instantané, sans recharger la page.
    var card = document.querySelector("[data-login-space]");
    if (card) {
      var tabs = card.querySelectorAll("[data-role-tab]");
      var spaceInput = card.querySelector("[data-space-input]");
      var submit = card.querySelector(".auth-submit");
      var setSpace = function (space) {
        if (card.getAttribute("data-login-space") === space) return;
        card.setAttribute("data-login-space", space);
        if (spaceInput) spaceInput.value = space;
        tabs.forEach(function (t) {
          var on = t.getAttribute("data-role-tab") === space;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", String(on));
        });
        card.querySelectorAll("[data-space-show]").forEach(function (el) {
          el.hidden = el.getAttribute("data-space-show") !== space;
        });
        if (submit) {
          submit.classList.toggle("btn--gold", space === "mandataire");
          submit.classList.toggle("btn--primary", space !== "mandataire");
        }
        // Le message renvoyé par le serveur concernait l'autre onglet : il n'a plus lieu d'être.
        var alert = card.querySelector(".form-alert");
        if (alert) alert.remove();
        var url = new URL(window.location.href);
        if (space === "mandataire") url.searchParams.set("espace", "mandataire");
        else url.searchParams.delete("espace");
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      };
      tabs.forEach(function (tab) {
        if (tab.hasAttribute("data-role-tab-nav")) return; // lien réel (client déjà connecté → son espace)
        tab.addEventListener("click", function (event) {
          event.preventDefault();
          setSpace(tab.getAttribute("data-role-tab"));
        });
      });
    }
  });
})();
