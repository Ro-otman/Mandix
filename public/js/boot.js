// Chargé dans <head> sans defer : signale que JS est actif et applique le thème avant le premier rendu.
(function () {
  var root = document.documentElement;
  root.classList.add("js");

  /* Mode jour / mode nuit : choix mémorisé sur l'appareil, sinon préférence du système.
     Posé sur <html data-theme="…"> avant l'affichage : pas d'éclair blanc en mode nuit. */
  var THEME_KEY = "mandix:theme";
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function storedTheme() {
    try { var v = window.localStorage.getItem(THEME_KEY); return v === "dark" || v === "light" ? v : null; } catch (e) { return null; }
  }
  function applyTheme(theme) {
    var dark = theme === "dark";
    root.setAttribute("data-theme", dark ? "dark" : "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0A1322" : "#0B1B3A");
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute("aria-pressed", String(dark));
      buttons[i].setAttribute("aria-label", dark ? "Activer le mode jour" : "Activer le mode nuit");
      buttons[i].title = dark ? "Mode jour" : "Mode nuit";
    }
  }
  applyTheme(storedTheme() || (media && media.matches ? "dark" : "light"));

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(root.getAttribute("data-theme"));
    document.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-theme-toggle]");
      if (!button) return;
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.classList.add("theme-switching");
      applyTheme(next);
      try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* stockage indisponible : choix limité à la page */ }
      window.setTimeout(function () { root.classList.remove("theme-switching"); }, 320);
    });
  });
  // Sans choix mémorisé, le site suit les changements de préférence du système.
  if (media) {
    var follow = function (e) { if (!storedTheme()) applyTheme(e.matches ? "dark" : "light"); };
    if (media.addEventListener) media.addEventListener("change", follow); else if (media.addListener) media.addListener(follow);
  }

  // Loader : visible seulement si le chargement dépasse ~150 ms (délai géré en CSS).
  root.classList.add("is-loading");
  function done() {
    root.classList.remove("is-loading");
  }
  window.addEventListener("load", done);
  window.setTimeout(done, 5000); // filet de sécurité

  // Filet de sécurité des animations : le contenu redevient visible quoi qu'il arrive.
  window.setTimeout(function () {
    root.classList.add("reveal-fallback");
  }, 2500);
})();
