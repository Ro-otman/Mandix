/**
 * Formulaires en plusieurs étapes : <form data-stepper> contenant des <fieldset data-step="n">.
 * - Chaque étape est validée (champs requis) avant de passer à la suivante.
 * - Les éléments [data-recap="nom"] reçoivent le libellé (data-recap-label) du champ coché « nom ».
 * - <form data-demo-success> : à l'envoi, affiche le panneau [data-success] (mode démonstration).
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("form[data-stepper]").forEach(function (form) {
      var steps = Array.prototype.slice.call(form.querySelectorAll("[data-step]"));
      var nav = document.querySelectorAll("[data-stepper-nav] li");
      var prev = form.querySelector("[data-step-prev]");
      var next = form.querySelector("[data-step-next]");
      var submit = form.querySelector("[data-step-submit]");
      var current = 0;

      function fillRecap() {
        form.querySelectorAll("[data-recap]").forEach(function (target) {
          var checked = form.querySelector('input[name="' + target.getAttribute("data-recap") + '"]:checked');
          target.textContent = checked ? checked.getAttribute("data-recap-label") || checked.value : "—";
        });
      }

      function go(index, initial) {
        current = Math.max(0, Math.min(index, steps.length - 1));
        steps.forEach(function (s, i) { s.hidden = i !== current; });
        nav.forEach(function (li, i) {
          li.classList.toggle("is-current", i === current);
          li.classList.toggle("is-done", i < current);
        });
        prev.hidden = current === 0;
        next.hidden = current === steps.length - 1;
        submit.hidden = current !== steps.length - 1;
        if (current === steps.length - 1) fillRecap();
        var progress = document.querySelector("[data-stepper-progress]");
        if (progress) progress.style.width = ((current + 1) / steps.length) * 100 + "%";
        if (initial) return;
        var heading = steps[current].querySelector("legend:not(.visually-hidden), input, select, textarea");
        if (heading && heading.focus && heading.tagName !== "LEGEND") heading.focus({ preventScroll: true });
        form.scrollIntoView({ block: "start", behavior: "smooth" });
      }

      function stepIsValid() {
        var fields = steps[current].querySelectorAll("input, select, textarea");
        for (var i = 0; i < fields.length; i++) {
          if (!fields[i].checkValidity()) { fields[i].reportValidity(); return false; }
        }
        return true;
      }

      next.addEventListener("click", function () { if (stepIsValid()) go(current + 1); });
      prev.addEventListener("click", function () { go(current - 1); });

      if (form.hasAttribute("data-demo-success")) {
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          if (!stepIsValid()) return;
          submit.classList.add("is-busy");
          window.setTimeout(function () {
            var success = document.querySelector("[data-success]");
            form.hidden = true;
            document.querySelectorAll("[data-stepper-nav]").forEach(function (n) { n.hidden = true; });
            if (success) { success.hidden = false; success.focus(); }
          }, 700);
        });
      }
      go(0, true);
    });
  });
})();
