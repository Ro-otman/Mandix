/** Centre d'aide : filtre instantané des questions. */
(function () {
  "use strict";
  var normalize = function (s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };

  document.addEventListener("DOMContentLoaded", function () {
    var input = document.querySelector("[data-help-search]");
    var empty = document.querySelector("[data-help-empty]");
    if (!input) return;
    input.addEventListener("input", function () {
      var q = normalize(input.value.trim());
      var total = 0;
      document.querySelectorAll("[data-help-group]").forEach(function (group) {
        var visible = 0;
        group.querySelectorAll("[data-help-item]").forEach(function (item) {
          var match = !q || normalize(item.textContent).indexOf(q) !== -1;
          item.hidden = !match;
          if (match) visible++;
          if (q && match) item.open = true;
          if (!q) item.open = false;
        });
        group.hidden = visible === 0;
        total += visible;
      });
      empty.hidden = total !== 0;
    });
  });
})();
