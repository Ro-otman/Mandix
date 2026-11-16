/**
 * Comptes du mandataire.
 * - « Ajouter un compte » : catalogue des comptes de la plateforme (logos) + « Autre » ;
 * - « Autre » : nom + logo (PNG, JPG ou WebP, 1 Mo maximum), ajouté à la liste des comptes de la plateforme ;
 * - formulaire : compte (logos), pays du compte (drapeaux + recherche), devise, puis cases à cocher :
 *   E-mail et/ou RIB (où recevoir l'argent, au moins l'un des deux), Prix sur 100 (100 € = 65 000 FCFA, symbole
 *   et unité choisis par le mandataire) et Pourcentage sur la transaction ; les champs apparaissent une fois cochés ;
 * - cartes : coordonnées affichées en clair (espace privé du mandataire), tarifs ; suppression.
 * Enregistrement côté serveur (POST /mandataire/comptes, /mandataire/comptes/:id/supprimer) : mêmes contrôles,
 * coordonnées chiffrées en base (AES-256-GCM).
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  var CARD_NUMBER = /^\d{13,19}$/;               // numéro de carte (espaces et tirets retirés)
  var LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
  var LOGO_MAX = 1024 * 1024;

  function toast(message, type) { if (MC.toast) MC.toast(message, type); }

  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.querySelector("[data-accounts-grid]");
    var dialog = document.getElementById("account-dialog");
    var template = document.querySelector("[data-account-template]");
    var empty = document.querySelector("[data-accounts-empty]");
    var countEl = document.querySelector("[data-accounts-count]");
    if (!grid || !dialog) return;

    var labels = JSON.parse(document.getElementById("accounts-labels").textContent);
    var steps = Array.prototype.slice.call(dialog.querySelectorAll("[data-step]"));
    var details = dialog.querySelector("[data-account-form]");
    var custom = dialog.querySelector("[data-custom-form]");
    var catalog = dialog.querySelector("[data-catalog]");
    var catalogSearch = dialog.querySelector("[data-catalog-search]");
    var catalogEmpty = dialog.querySelector("[data-catalog-empty]");
    var typeSelect = details.elements.type;
    var countrySelect = details.elements.country;
    var currencySelect = details.elements.currency;
    var toggles = Array.prototype.slice.call(details.querySelectorAll("[data-offer-toggle]"));
    var bankField = details.querySelector("[data-bank-field]");
    var submitButton = details.querySelector("[data-account-submit]");
    var backButton = details.querySelector("[data-step-back]");
    var logoInput = custom.elements.logo;
    var logoPreview = custom.querySelector("[data-logo-preview]");
    var logoName = custom.querySelector("[data-logo-name]");
    var customError = custom.querySelector("[data-custom-error]");
    var defaultPreview = logoPreview.innerHTML;
    var pendingLogo = null; // logo du compte « Autre », lu en data: URL (autorisé par la CSP)

    function typeInfo(slug) {
      return labels.types[slug] || { name: slug, logo: "", receiveLabel: labels.defaultReceive.receiveLabel, receivePlaceholder: labels.defaultReceive.receivePlaceholder };
    }

    function refreshCount() {
      var n = grid.querySelectorAll("[data-account-card]").length;
      countEl.textContent = n;
      countEl.parentElement.lastChild.textContent = " compte" + (n > 1 ? "s" : "") + " enregistré" + (n > 1 ? "s" : "");
      empty.hidden = n !== 0;
    }

    /* ------------------------------------------------------------------ Étapes de la boîte d'ajout */

    function showStep(name) {
      steps.forEach(function (step) { step.hidden = step.getAttribute("data-step") !== name; });
      var current = steps.filter(function (step) { return !step.hidden; })[0];
      dialog.setAttribute("aria-labelledby", current.getAttribute("data-step-title"));
      var target = name === "catalog" ? catalogSearch : name === "custom" ? custom.elements.name : toggles[0];
      window.setTimeout(function () { if (target) target.focus(); }, 30);
    }

    function setSelectValue(select, value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true })); // la liste enrichie suit
    }

    /** Compte choisi : banque (virement), logo de l'en-tête. */
    function syncType() {
      var info = typeInfo(typeSelect.value);
      bankField.hidden = typeSelect.value !== "virement";
      var holder = details.querySelector("[data-selected-logo]");
      if (info.logo) {
        holder.textContent = "";
        var img = document.createElement("img");
        img.src = info.logo;
        img.alt = "";
        img.width = 28;
        img.height = 28;
        holder.appendChild(img);
        holder.classList.add("acc-selected--logo");
      }
    }

    /** Pays du compte : la devise principale du pays est proposée. */
    function syncCurrency() {
      var country = labels.countries[countrySelect.value];
      if (country && currencySelect.querySelector('option[value="' + country.currency + '"]')) setSelectValue(currencySelect, country.currency);
    }

    typeSelect.addEventListener("change", syncType);
    countrySelect.addEventListener("change", syncCurrency);

    /* ------------------------------------------------------------------ Cases à cocher (réception et tarifs) */

    function offerField(key) { return details.querySelector('[data-offer-field="' + key + '"]'); }
    function offerError(key) { return details.querySelector('[data-offer-error="' + key + '"]'); }
    function isChecked(key) { return details.querySelector('[data-offer-toggle="' + key + '"]').checked; }

    function clearErrors() {
      details.querySelectorAll("[data-offer-error]").forEach(function (p) { p.hidden = true; p.textContent = ""; });
      details.querySelectorAll('[aria-invalid="true"]').forEach(function (input) { input.removeAttribute("aria-invalid"); });
    }

    /**
     * Message d'erreur sous le bloc concerné ; le champ fautif reçoit le focus (pour une liste de devises :
     * son champ de choix, la liste native étant masquée).
     */
    function offerFail(key, message, input) {
      var p = offerError(key);
      if (p) { p.textContent = message; p.hidden = false; }
      if (input) {
        input.setAttribute("aria-invalid", "true");
        var target = input.tagName === "SELECT" ? document.getElementById(input.id + "-combo") || input : input;
        target.focus();
      }
      return null;
    }

    /** Case cochée : son champ apparaît (et reçoit le focus) ; décochée : il disparaît. */
    function syncToggle(toggle, focus) {
      var key = toggle.getAttribute("data-offer-toggle");
      var field = offerField(key);
      field.hidden = !toggle.checked;
      // Prix sur 100 : la devise des 100 reprend celle du compte (modifiable dans la liste).
      if (key === "price" && toggle.checked && !details.elements.priceSymbol.value && currencySelect.value) {
        setSelectValue(details.elements.priceSymbol, currencySelect.value);
      }
      if (toggle.checked && focus) {
        var first = field.querySelector(key === "price" ? '[name="priceAmount"]' : "input");
        if (first) window.setTimeout(function () { first.focus(); }, 0);
      }
    }
    toggles.forEach(function (toggle) {
      toggle.addEventListener("change", function () { syncToggle(toggle, true); });
    });
    function clearFieldError(event) {
      var field = event.target.closest("[data-offer-field]");
      if (!field) return;
      var p = offerError(field.getAttribute("data-offer-field"));
      if (p) p.hidden = true;
      event.target.removeAttribute("aria-invalid");
    }
    details.addEventListener("input", clearFieldError);
    details.addEventListener("change", clearFieldError); // listes de devises

    /** Nombre saisi en français (« 65 000 », « 2,5 ») ; null si invalide. */
    function parseAmount(value) {
      var compact = String(value || "").replace(/[\s  ]/g, "").replace(",", ".");
      return /^\d+(\.\d{1,2})?$/.test(compact) ? Number(compact) : null;
    }

    /** Vérifie les cases cochées et prépare l'envoi ; null si une valeur est à corriger (message affiché). */
    function readOffer() {
      clearErrors();
      var el = details.elements;
      var offer = { checks: {} };
      ["holder", "email", "rib", "bic", "address", "price", "percent"].forEach(function (key) { offer.checks[key] = isChecked(key); });
      // Aucune case obligatoire : seules les cases cochées sont vérifiées.
      if (offer.checks.holder) {
        offer.holder = el.holder.value.replace(/\s+/g, " ").trim();
        if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' .-]{1,99}$/.test(offer.holder)) return offerFail("holder", "Indiquez le nom et les prénoms du titulaire (lettres uniquement).", el.holder);
      }
      if (offer.checks.email) {
        offer.email = el.email.value.trim();
        if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(offer.email)) return offerFail("email", "Indiquez une adresse e-mail valide.", el.email);
      }
      if (offer.checks.rib) {
        offer.rib = el.rib.value.replace(/\s+/g, " ").trim().toUpperCase();
        if (CARD_NUMBER.test(offer.rib.replace(/[\s-]/g, ""))) return offerFail("rib", "Ceci ressemble à un numéro de carte bancaire : indiquez le RIB.", el.rib);
        if (!/^[A-Z0-9 ]{10,60}$/.test(offer.rib)) return offerFail("rib", "Indiquez le RIB (10 à 60 lettres et chiffres).", el.rib);
      }
      if (offer.checks.bic) {
        offer.bic = el.bic.value.replace(/\s/g, "").toUpperCase();
        if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(offer.bic)) return offerFail("bic", "Indiquez un BIC valide : 8 ou 11 caractères (ex. BNPAFRPP).", el.bic);
      }
      if (offer.checks.address) {
        offer.address = el.address.value.replace(/\s+/g, " ").trim();
        if (offer.address.length < 5) return offerFail("address", "Indiquez l'adresse (5 caractères minimum).", el.address);
      }
      if (offer.checks.price) {
        var symbol = el.priceSymbol.value;
        var amount = parseAmount(el.priceAmount.value);
        var unit = el.priceUnit.value;
        if (!symbol) return offerFail("price", "Choisissez la devise des 100 (€, $…).", el.priceSymbol);
        if (amount == null || amount <= 0) return offerFail("price", "Indiquez le montant pour 100 " + symbol + " (ex. 65 000).", el.priceAmount);
        if (!unit) return offerFail("price", "Choisissez la devise du montant (ex. FCFA).", el.priceUnit);
        offer.price = { symbol: symbol, amount: amount, unit: unit };
      }
      if (offer.checks.percent) {
        var percent = parseAmount(el.percent.value.replace(/%/g, "")); // « 25 », « 25% » ou « 25 % »
        if (percent == null || percent <= 0 || percent > 100) return offerFail("percent", "Indiquez un pourcentage entre 0 et 100 (ex. 25).", el.percent);
        offer.percent = percent;
      }
      return offer;
    }

    function resetDetails() {
      details.reset();
      clearErrors();
      toggles.forEach(function (toggle) { syncToggle(toggle, false); });
      // Listes enrichies : leur affichage suit la valeur remise à zéro.
      setSelectValue(details.elements.priceSymbol, "");
      setSelectValue(details.elements.priceUnit, "");
      setSelectValue(currencySelect, currencySelect.value);
      setSelectValue(countrySelect, ""); // pays du compte : choix obligatoire, aucun pays présélectionné
      syncCurrency();
    }

    document.querySelector("[data-account-add]").addEventListener("click", function () {
      resetDetails();
      resetCustom();
      catalogSearch.value = "";
      filterCatalog("");
      showStep("catalog");
      dialog.showModal();
    });

    /* ------------------------------------------------------------------ Catalogue */

    function filterCatalog(query) {
      var q = query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      var visible = 0;
      catalog.querySelectorAll("[data-catalog-item]").forEach(function (item) {
        var name = item.getAttribute("data-name").normalize("NFD").replace(/[̀-ͯ]/g, "");
        var match = !q || name.indexOf(q) !== -1;
        item.hidden = !match;
        if (match) visible += 1;
      });
      catalogEmpty.hidden = visible > 0;
    }
    catalogSearch.addEventListener("input", function () { filterCatalog(catalogSearch.value); });

    function openDetails(slug) {
      resetDetails();
      setSelectValue(typeSelect, slug);
      syncType();
      details.querySelector("[data-details-title]").textContent = "Ajouter un compte";
      submitButton.textContent = "Ajouter le compte";
      backButton.hidden = false;
      showStep("details");
    }

    catalog.addEventListener("click", function (event) {
      var tile = event.target.closest("[data-catalog-type]");
      if (tile) { openDetails(tile.getAttribute("data-catalog-type")); return; }
      if (event.target.closest("[data-catalog-other]")) showStep("custom");
    });

    dialog.addEventListener("click", function (event) {
      if (event.target.closest("[data-step-back]")) showStep("catalog");
    });

    /* ------------------------------------------------------------------ « Autre » : nouveau compte de la plateforme */

    function resetCustom() {
      custom.reset();
      pendingLogo = null;
      logoPreview.innerHTML = defaultPreview;
      logoPreview.classList.remove("has-image");
      logoName.textContent = "Choisir une image";
      customError.hidden = true;
    }

    function customFail(message, field) {
      customError.textContent = message;
      customError.hidden = false;
      if (field) field.focus();
    }

    logoInput.addEventListener("change", function () {
      customError.hidden = true;
      var file = logoInput.files && logoInput.files[0];
      pendingLogo = null;
      if (!file) return;
      if (LOGO_TYPES.indexOf(file.type) === -1) { logoInput.value = ""; customFail("Format non accepté : choisissez une image PNG, JPG ou WebP.", logoInput); return; }
      if (file.size > LOGO_MAX) { logoInput.value = ""; customFail("Image trop lourde : 1 Mo maximum.", logoInput); return; }
      var reader = new FileReader();
      reader.onload = function () {
        pendingLogo = reader.result;
        logoPreview.textContent = "";
        var img = document.createElement("img");
        img.src = pendingLogo;
        img.alt = "";
        logoPreview.appendChild(img);
        logoPreview.classList.add("has-image");
        logoName.textContent = file.name;
      };
      reader.readAsDataURL(file);
    });

    custom.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = custom.elements.name.value.replace(/\s+/g, " ").trim();
      if (name.length < 2) { customFail("Indiquez le nom du compte (2 caractères minimum).", custom.elements.name); return; }
      var exists = Object.keys(labels.types).filter(function (slug) { return labels.types[slug].name.toLowerCase() === name.toLowerCase(); })[0];
      if (exists) { customFail("« " + name + " » existe déjà : choisissez-le dans la liste.", custom.elements.name); return; }
      if (!pendingLogo) { customFail("Ajoutez le logo du compte.", logoInput); return; }

      var slug = "autre-" + Date.now();
      labels.types[slug] = { name: name, logo: pendingLogo, receiveLabel: labels.defaultReceive.receiveLabel, receivePlaceholder: labels.defaultReceive.receivePlaceholder };

      // Nouvelle tuile dans le catalogue (avant « Autre ») et nouvelle option de la liste « Compte ».
      var li = document.createElement("li");
      li.setAttribute("data-catalog-item", "");
      li.setAttribute("data-name", name.toLowerCase());
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "acc-tile";
      tile.setAttribute("data-catalog-type", slug);
      var logo = document.createElement("span");
      logo.className = "acc-tile__logo";
      var img = document.createElement("img");
      img.src = pendingLogo;
      img.alt = "";
      img.width = 34;
      img.height = 34;
      logo.appendChild(img);
      var label = document.createElement("span");
      label.className = "acc-tile__name";
      label.textContent = name;
      tile.appendChild(logo);
      tile.appendChild(label);
      li.appendChild(tile);
      catalog.insertBefore(li, catalog.querySelector(".acc-catalog__other"));

      var option = document.createElement("option");
      option.value = slug;
      option.textContent = name;
      option.setAttribute("data-icon", pendingLogo);
      typeSelect.appendChild(option);
      if (MC.refreshSelect) MC.refreshSelect(typeSelect);

      toast("« " + name + " » a été ajouté aux comptes de la plateforme.", "success");
      resetCustom();
      openDetails(slug);
    });

    /* ------------------------------------------------------------------ Informations du compte */

    /** Données d'une carte (attribut data-account) à partir de la réponse du serveur. */
    function cardData(a) {
      return {
        id: a.id, type: a.type, country: a.country, currency: a.currency, bank: a.bank || "",
        receive: a.receive || "", receiveHolder: a.receiveHolder || "", receiveEmail: a.receiveEmail || "",
        receiveRib: a.receiveRib || "", receiveBic: a.receiveBic || "", receiveAddress: a.receiveAddress || "",
        rateLabel: a.rateLabel || "", feeLabel: a.feeLabel || "",
      };
    }

    function fill(card, data) {
      var info = typeInfo(data.type);
      card.setAttribute("data-account", JSON.stringify(data));

      var logo = card.querySelector('[data-field="logo"]');
      logo.textContent = "";
      if (info.logo) {
        var img = document.createElement("img");
        img.className = "service-logo";
        img.src = info.logo;
        img.alt = "";
        img.width = 26;
        img.height = 26;
        logo.appendChild(img);
      }
      card.querySelector('[data-field="type"]').textContent = info.name;
      var bank = card.querySelector('[data-field="bank"]');
      bank.textContent = data.bank || "";
      bank.hidden = !data.bank;

      var flagHolder = card.querySelector('[data-field="flag"]');
      flagHolder.textContent = "";
      var flag = document.createElement("img");
      flag.className = "flag";
      flag.src = "/images/flags/" + data.country.toLowerCase() + ".svg";
      flag.alt = "";
      flag.width = 18;
      flag.height = 14;
      flagHolder.appendChild(flag);
      card.querySelector('[data-field="country"]').textContent = (labels.countries[data.country] || {}).name || data.country;
      card.querySelector('[data-field="currency"]').textContent = data.currency;
      card.querySelector('[data-field="rate"]').textContent = data.rateLabel || "";
      card.querySelector('[data-field="rate-row"]').hidden = !data.rateLabel;
      card.querySelector('[data-field="fee"]').textContent = data.feeLabel || "";
      card.querySelector('[data-field="fee-row"]').hidden = !data.feeLabel;

      var status = card.querySelector('[data-field="status"]');
      status.className = "badge badge--success badge--dot";
      status.textContent = "Publié";
    }

    details.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!typeSelect.value) { document.getElementById(typeSelect.id + "-combo").focus(); toast("Choisissez un compte.", "warning"); return; }
      if (!countrySelect.value) { document.getElementById(countrySelect.id + "-combo").focus(); toast("Choisissez le pays du compte : il s'affiche avec son drapeau sur votre fiche.", "warning"); return; }
      var offer = readOffer();
      if (!offer) return;

      var payload = {
        type: typeSelect.value,
        country: countrySelect.value,
        currency: currencySelect.value,
        bank: typeSelect.value === "virement" ? details.elements.bank.value.trim() : "",
        checks: offer.checks,
        holder: offer.holder,
        email: offer.email,
        rib: offer.rib,
        bic: offer.bic,
        address: offer.address,
        price: offer.price,
        percent: offer.percent,
      };
      // Enregistrement côté serveur (coordonnées chiffrées en base), puis affichage de la carte.
      if (MC.setBusy) MC.setBusy(submitButton, true);
      MC.api("/mandataire/comptes", { method: "POST", json: payload }).then(function (result) {
        var card = template.content.firstElementChild.cloneNode(true);
        grid.prepend(card);
        fill(card, cardData(result.account));
        card.classList.remove("account-card--flash");
        void card.offsetWidth; // relance l'animation de mise en évidence
        card.classList.add("account-card--flash");
        dialog.close();
        refreshCount();
        toast("Compte ajouté et publié sur votre profil.", "success", "Compte publié");
      }).catch(function (error) {
        var fields = error.details || {};
        var shown = false;
        ["holder", "email", "rib", "bic", "address", "price", "percent"].forEach(function (key) {
          if (fields[key] && !shown) {
            var input = key === "price" ? details.elements.priceAmount : details.elements[key];
            offerFail(key, fields[key], input);
            shown = true;
          }
        });
        if (!shown) toast(fields.type || fields.country || fields.currency || error.message, "danger");
      }).then(function () { if (MC.setBusy) MC.setBusy(submitButton, false); });
    });

    /* ------------------------------------------------------------------ Voir le compte */

    var viewDialog = document.getElementById("account-view");
    grid.addEventListener("click", function (event) {
      var button = event.target.closest("[data-account-view]");
      if (!button || !viewDialog) return;
      var data = JSON.parse(button.closest("[data-account-card]").getAttribute("data-account"));
      var info = typeInfo(data.type);
      var logo = viewDialog.querySelector("[data-view-logo]");
      logo.textContent = "";
      if (info.logo) {
        var img = document.createElement("img");
        img.src = info.logo;
        img.alt = "";
        img.width = 28;
        img.height = 28;
        logo.appendChild(img);
      }
      viewDialog.querySelector("[data-view-name]").textContent = info.name;
      var flagHolder = viewDialog.querySelector("[data-view-flag]");
      flagHolder.textContent = "";
      var flag = document.createElement("img");
      flag.className = "flag";
      flag.src = "/images/flags/" + String(data.country).toLowerCase() + ".svg";
      flag.alt = "";
      flag.width = 18;
      flag.height = 14;
      flagHolder.appendChild(flag);
      viewDialog.querySelector("[data-view-country]").textContent = (labels.countries[data.country] || {}).name || data.country;
      viewDialog.querySelector("[data-view-currency]").textContent = data.currency;
      viewDialog.querySelector("[data-view-bank-row]").hidden = !data.bank;
      viewDialog.querySelector("[data-view-bank]").textContent = data.bank || "";
      // Titulaire, e-mail, RIB, BIC, adresse (ou coordonnées libres d'un compte plus ancien), puis tarifs :
      // seules les lignes renseignées s'affichent.
      var structured = data.receiveHolder || data.receiveEmail || data.receiveRib || data.receiveBic || data.receiveAddress;
      var rows = {
        holder: data.receiveHolder,
        email: data.receiveEmail,
        rib: data.receiveRib,
        bic: data.receiveBic,
        address: data.receiveAddress,
        legacy: structured ? "" : data.receive,
        rate: data.rateLabel,
        fee: data.feeLabel,
      };
      Object.keys(rows).forEach(function (key) {
        viewDialog.querySelector('[data-view-row="' + key + '"]').hidden = !rows[key];
        viewDialog.querySelector('[data-view-value="' + key + '"]').textContent = rows[key] || "";
        var copy = viewDialog.querySelector('[data-view-copy="' + key + '"]');
        if (copy) copy.onclick = function () {
          if (!navigator.clipboard || !rows[key]) return;
          navigator.clipboard.writeText(rows[key]).then(function () { toast("Copié.", "success"); }, function () { toast("Copie impossible : sélectionnez le texte.", "warning"); });
        };
      });
      viewDialog.showModal();
    });

    // Suppression, après la modale de confirmation (app.js rejoue l'envoi avec data-confirmed="1").
    document.addEventListener("submit", function (event) {
      var del = event.target;
      if (!del.matches("form[data-account-delete]") || del.dataset.confirmed !== "1") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      del.dataset.confirmed = "";
      var card = del.closest("[data-account-card]");
      var data = JSON.parse(card.getAttribute("data-account") || "{}");
      var button = del.querySelector('[type="submit"]');
      if (MC.setBusy) MC.setBusy(button, true);
      MC.api("/mandataire/comptes/" + encodeURIComponent(data.id) + "/supprimer", { method: "POST", json: {} }).then(function () {
        card.classList.add("account-card--removing");
        window.setTimeout(function () {
          card.remove();
          refreshCount();
        }, 250);
        toast("Compte supprimé de votre profil.", "success", "Compte supprimé");
      }).catch(function (error) {
        if (MC.setBusy) MC.setBusy(button, false);
        toast(error.message, "danger");
      });
    }, true);
  });
})();
