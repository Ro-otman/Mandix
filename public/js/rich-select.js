/**
 * Listes enrichies : remplace visuellement un <select data-rich-select> par une liste avec icônes
 * (logos des comptes, drapeaux des pays). Modèle « select-only combobox » des WAI-ARIA APG :
 * flèches, Début/Fin, Entrée/Espace, Échap, Tab, saisie de la première lettre.
 * Le <select> d'origine reste dans le formulaire (caché) : c'est lui qui envoie la valeur.
 *
 * Options :
 * - data-icon="URL" sur chaque <option> ; sinon l'icône du champ est reprise ;
 * - data-rich-select-flags : icônes au format drapeau ;
 * - data-rich-select-search="Texte d'aide" : champ de recherche en tête de liste (filtre les options).
 * API : MC.refreshSelect(select) reconstruit la liste (options ajoutées), un « change » sur le
 * <select> met l'affichage à jour (valeur modifiée par script).
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  if (MC.refreshSelect) return; // script déjà chargé

  var CHEVRON = '<svg class="rselect__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var CHECK = '<svg class="rselect__check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

  var normalize = function (text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  };

  function enhance(select) {
    if (select.getAttribute("data-rich-ready")) return;
    select.setAttribute("data-rich-ready", "1");

    var id = select.id;
    var isFlag = select.hasAttribute("data-rich-select-flags");
    var searchHint = select.getAttribute("data-rich-select-search");
    var control = select.parentElement;
    var field = control.closest(".sbar__field, .rfield") || control;
    var leadIcon = control.querySelector(":scope > .icon");
    var label = document.querySelector('label[for="' + id + '"]');
    var options = Array.prototype.slice.call(select.options);
    var active = select.selectedIndex;
    var wrap = null;
    var typed = "";
    var typedTimer = null;

    function iconFor(option) {
      var holder = document.createElement("span");
      holder.className = "rselect__icon" + (isFlag ? " rselect__icon--flag" : "");
      var src = option.getAttribute("data-icon");
      if (src) {
        var img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.width = isFlag ? 22 : 20;
        img.height = isFlag ? 16 : 20;
        holder.appendChild(img);
      } else if (leadIcon) {
        holder.classList.add("rselect__icon--generic");
        holder.appendChild(leadIcon.cloneNode(true));
      }
      return holder;
    }

    // Bouton (combobox)
    var combo = document.createElement("div");
    combo.className = "rselect__button";
    combo.id = id + "-combo";
    combo.tabIndex = 0;
    combo.setAttribute("role", "combobox");
    combo.setAttribute("aria-haspopup", "listbox");
    combo.setAttribute("aria-expanded", "false");
    combo.setAttribute("aria-controls", id + "-listbox");
    var comboIcon = document.createElement("span");
    var comboValue = document.createElement("span");
    comboValue.className = "rselect__value";
    combo.appendChild(comboIcon);
    combo.appendChild(comboValue);
    combo.insertAdjacentHTML("beforeend", CHEVRON);

    // Fenêtre : recherche (facultative) + liste des options
    var popup = document.createElement("div");
    popup.className = "rselect__popup";
    popup.hidden = true;

    var search = null;
    if (searchHint) {
      var searchBox = document.createElement("div");
      searchBox.className = "rselect__search";
      searchBox.insertAdjacentHTML("afterbegin", SEARCH);
      search = document.createElement("input");
      search.type = "search";
      search.className = "rselect__search-input";
      search.placeholder = searchHint;
      search.setAttribute("aria-label", searchHint);
      search.setAttribute("aria-controls", id + "-listbox");
      search.setAttribute("autocomplete", "off");
      searchBox.appendChild(search);
      popup.appendChild(searchBox);
    }

    var list = document.createElement("ul");
    list.className = "rselect__list";
    list.id = id + "-listbox";
    list.setAttribute("role", "listbox");
    list.tabIndex = -1;
    popup.appendChild(list);

    var empty = document.createElement("p");
    empty.className = "rselect__empty";
    empty.textContent = "Aucun résultat";
    empty.hidden = true;
    popup.appendChild(empty);

    if (label) {
      label.id = label.id || id + "-label";
      combo.setAttribute("aria-labelledby", label.id + " " + combo.id);
      list.setAttribute("aria-labelledby", label.id);
      if (!label.getAttribute("data-rich-label")) {
        label.setAttribute("data-rich-label", "1");
        label.addEventListener("click", function (event) {
          var current = document.getElementById(id + "-combo");
          if (current) { event.preventDefault(); current.focus(); }
        });
      }
    }

    var items = options.map(function (option, index) {
      var li = document.createElement("li");
      li.id = id + "-opt-" + index;
      li.className = "rselect__option";
      li.setAttribute("role", "option");
      li.appendChild(iconFor(option));
      var text = document.createElement("span");
      text.className = "rselect__text";
      text.textContent = option.textContent;
      li.appendChild(text);
      li.insertAdjacentHTML("beforeend", CHECK);
      li.addEventListener("mousemove", function () { if (active !== index) setActive(index, false); });
      li.addEventListener("click", function () { choose(index); });
      list.appendChild(li);
      return li;
    });

    function visible(index) { return !items[index].hidden; }

    function renderValue() {
      var option = select.options[select.selectedIndex];
      if (!option) return;
      var icon = iconFor(option);
      combo.replaceChild(icon, comboIcon);
      comboIcon = icon;
      comboValue.textContent = option.textContent;
      items.forEach(function (li, index) { li.setAttribute("aria-selected", String(index === select.selectedIndex)); });
    }

    function setActive(index, scroll) {
      if (index < 0 || index >= items.length) return;
      active = index;
      items.forEach(function (li, i) { li.classList.toggle("is-active", i === active); });
      (search || combo).setAttribute("aria-activedescendant", items[active].id);
      if (scroll !== false) items[active].scrollIntoView({ block: "nearest" });
    }

    /** Option visible suivante ou précédente (en sautant celles masquées par la recherche). */
    function step(from, delta) {
      for (var i = from + delta; i >= 0 && i < items.length; i += delta) if (visible(i)) return i;
      return from;
    }
    function firstVisible() { for (var i = 0; i < items.length; i += 1) if (visible(i)) return i; return -1; }
    function lastVisible() { for (var i = items.length - 1; i >= 0; i -= 1) if (visible(i)) return i; return -1; }

    function filter(query) {
      var q = normalize(query.trim());
      var count = 0;
      items.forEach(function (li, index) {
        var match = !q || normalize(options[index].textContent).indexOf(q) !== -1;
        li.hidden = !match;
        if (match) count += 1;
      });
      empty.hidden = count > 0;
      if (!visible(active)) setActive(firstVisible());
    }

    function isOpen() { return !popup.hidden; }

    /**
     * Ouvre vers le haut si la place manque en bas : dans la zone qui défile d'une boîte de dialogue (son contenu
     * y est découpé), sinon dans la boîte de dialogue, sinon dans la fenêtre.
     */
    function scrollArea() {
      var body = field.closest(".modal__body");
      if (body && window.getComputedStyle(body).overflowY !== "visible") return body;
      return field.closest("dialog") || null;
    }

    function place() {
      popup.classList.remove("rselect__popup--up");
      var box = field.getBoundingClientRect();
      var scroller = scrollArea();
      var limit = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      var top = scroller ? scroller.getBoundingClientRect().top : 0;
      var needed = Math.min(popup.scrollHeight, 360) + 12;
      if (limit - box.bottom < needed && box.top - top > limit - box.bottom) popup.classList.add("rselect__popup--up");
    }

    function open() {
      if (isOpen()) return;
      popup.hidden = false;
      combo.setAttribute("aria-expanded", "true");
      field.classList.add("is-open");
      if (search) { search.value = ""; filter(""); }
      place();
      setActive(select.selectedIndex);
      if (search) search.focus({ preventScroll: true });
      document.addEventListener("pointerdown", onOutside, true);
    }

    function close(focusCombo) {
      if (!isOpen()) return;
      popup.hidden = true;
      combo.setAttribute("aria-expanded", "false");
      combo.removeAttribute("aria-activedescendant");
      field.classList.remove("is-open");
      document.removeEventListener("pointerdown", onOutside, true);
      if (focusCombo) combo.focus();
    }

    function choose(index) {
      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      renderValue();
      close(true);
    }

    function onOutside(event) {
      if (!wrap.contains(event.target) && event.target !== label) close(false);
    }

    /** Saisie au clavier : va à la première option qui commence par les lettres tapées. */
    function typeahead(char) {
      typed += normalize(char);
      window.clearTimeout(typedTimer);
      typedTimer = window.setTimeout(function () { typed = ""; }, 600);
      var start = isOpen() ? active : select.selectedIndex;
      // Une seule lettre : on part de l'option suivante (taper « W » plusieurs fois fait défiler Wise, Wero…).
      var offset = typed.length > 1 ? 0 : 1;
      for (var n = 0; n < options.length; n += 1) {
        var index = (start + offset + n) % options.length;
        if (normalize(options[index].textContent).indexOf(typed) === 0) {
          if (isOpen()) setActive(index); else { select.selectedIndex = index; select.dispatchEvent(new Event("change", { bubbles: true })); renderValue(); }
          return;
        }
      }
    }

    /** Navigation dans la liste ouverte (depuis le bouton ou le champ de recherche). */
    function navigate(event) {
      var key = event.key;
      if (key === "ArrowDown") { event.preventDefault(); setActive(step(active, 1)); return true; }
      if (key === "ArrowUp") { event.preventDefault(); setActive(step(active, -1)); return true; }
      if (key === "Home" && !search) { event.preventDefault(); setActive(firstVisible()); return true; }
      if (key === "End" && !search) { event.preventDefault(); setActive(lastVisible()); return true; }
      if (key === "Enter") { event.preventDefault(); if (active >= 0 && visible(active)) choose(active); return true; }
      if (key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return true; }
      if (key === "Tab") { close(false); return true; }
      return false;
    }

    combo.addEventListener("click", function () { if (isOpen()) close(true); else open(); });

    combo.addEventListener("keydown", function (event) {
      var key = event.key;
      if (!isOpen()) {
        if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") { event.preventDefault(); open(); return; }
        if (key === "Home") { event.preventDefault(); open(); setActive(firstVisible()); return; }
        if (key === "End") { event.preventDefault(); open(); setActive(lastVisible()); return; }
      } else {
        if (key === " ") { event.preventDefault(); choose(active); return; }
        if (navigate(event)) return;
      }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && key !== " ") {
        event.preventDefault();
        if (search) { open(); search.value = key; filter(key); return; }
        typeahead(key);
      }
    });

    if (search) {
      search.addEventListener("input", function () { filter(search.value); });
      search.addEventListener("keydown", function (event) { navigate(event); });
    }

    wrap = document.createElement("div");
    wrap.className = "rselect";
    wrap.appendChild(combo);
    wrap.appendChild(popup);
    wrap.addEventListener("focusout", function () {
      window.setTimeout(function () { if (!wrap.contains(document.activeElement)) close(false); }, 0);
    });

    select.hidden = true;
    select.tabIndex = -1;
    control.classList.add("sbar__control--rich");
    control.appendChild(wrap);
    renderValue();

    // Valeur modifiée par script ou formulaire réinitialisé : l'affichage suit le <select>.
    var onReset = function () { window.setTimeout(renderValue, 0); };
    select.addEventListener("change", renderValue);
    if (select.form) select.form.addEventListener("reset", onReset);
    select._richWrap = wrap;
    select._richOff = function () {
      select.removeEventListener("change", renderValue);
      if (select.form) select.form.removeEventListener("reset", onReset);
      document.removeEventListener("pointerdown", onOutside, true);
    };
  }

  /** Reconstruit la liste (après ajout ou retrait d'options). */
  MC.refreshSelect = function (select) {
    if (select._richOff) select._richOff();
    if (select._richWrap) select._richWrap.remove();
    select._richWrap = null;
    select.removeAttribute("data-rich-ready");
    select.hidden = false;
    enhance(select);
  };
  MC.enhanceSelect = enhance;

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("select[data-rich-select]").forEach(enhance);
  });
})();
