/** Espaces connectés : infobulle des graphiques (survol et toucher). */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-chart]").forEach(function (chart) {
      var plot = chart.querySelector(".chart__plot");
      var tip = chart.querySelector(".chart__tip");
      if (!plot || !tip) return;

      function show(bar) {
        var mark = bar.querySelector(".chart__mark");
        var box = mark.getBoundingClientRect();
        var host = plot.getBoundingClientRect();
        tip.textContent = bar.getAttribute("data-tip");
        tip.hidden = false;
        var left = box.left - host.left + box.width / 2;
        tip.style.left = Math.min(Math.max(left, 60), host.width - 60) + "px";
        tip.style.top = Math.max(box.top - host.top - 10, 0) + "px";
        chart.querySelectorAll(".chart__bar").forEach(function (b) { b.classList.toggle("is-dim", b !== bar); });
      }
      function hide() {
        tip.hidden = true;
        chart.querySelectorAll(".chart__bar").forEach(function (b) { b.classList.remove("is-dim"); });
      }
      chart.querySelectorAll(".chart__bar").forEach(function (bar) {
        bar.addEventListener("mouseenter", function () { show(bar); });
        bar.addEventListener("touchstart", function () { show(bar); }, { passive: true });
      });
      plot.addEventListener("mouseleave", hide);
    });
  });
})();
