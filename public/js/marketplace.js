/**
 * Marketplace : application immédiate des filtres et du tri, panneau de filtres replié sur mobile.
 * Sans JavaScript, les boutons « Appliquer » / « Trier » prennent le relais.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("form[data-autosubmit]").forEach(function (form) {
      form.classList.add("is-auto");
      form.addEventListener("change", function () {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      });
    });

    var panel = document.querySelector("[data-filters]");
    if (panel && window.matchMedia("(max-width: 960px)").matches) panel.removeAttribute("open");

    // Choix d'un créneau sur le profil : met en évidence le créneau sélectionné.
    document.querySelectorAll("[data-day-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var key = tab.getAttribute("data-day-tab");
        document.querySelectorAll("[data-day-tab]").forEach(function (t) {
          t.setAttribute("aria-selected", String(t === tab));
        });
        document.querySelectorAll("[data-day-panel]").forEach(function (p) {
          p.hidden = p.getAttribute("data-day-panel") !== key;
        });
      });
    });
  });
})();
