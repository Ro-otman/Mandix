/**
 * Animations discrètes avec GSAP (chargé localement depuis /vendor/gsap).
 * - [data-hero-item] : entrée échelonnée du hero au chargement
 * - [data-reveal]    : apparition au défilement ; [data-reveal-stagger] échelonne les enfants
 * - [data-hx-chat]  : conversation de la bannière d'accueil, lue message par message
 * Désactivées si l'utilisateur a demandé à réduire les animations.
 */

/* Conversation de la bannière : quand elle devient visible, les messages arrivent un à un (même ordre que la
   vraie messagerie) et le fil défile pour montrer le dernier arrivé. Sans script, le fil est affiché sur ses
   derniers messages (CSS). Les déplacements se font par transformation : aucun décalage de mise en page. */
(function () {
  "use strict";

  var chat = document.querySelector("[data-hx-chat]");
  if (!chat || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var body = chat.querySelector(".hx-chat__body");
  var track = chat.querySelector(".hx-chat__track");
  var status = chat.querySelector("[data-hx-status]");
  var statusText = chat.querySelector("[data-hx-status-text]");
  if (!body || !track) return;

  var items = Array.prototype.slice.call(track.children);
  var last = null;

  // Fait défiler le fil juste assez pour que le message soit entièrement visible.
  function fit(item) {
    if (!item) return;
    var overflow = item.offsetTop + item.offsetHeight + 14 - body.clientHeight;
    track.style.transform = "translateY(" + -Math.max(0, overflow) + "px)";
  }

  // Départ : fil en haut, messages masqués (sans transition), puis transitions activées.
  track.style.transform = "translateY(0)";
  chat.classList.add("is-playing");
  void chat.offsetHeight;
  chat.classList.add("is-animated");

  // Bas de la conversation, comme dans la vraie messagerie : attente du mandataire ou action du client.
  function showStatus(kind, text) {
    if (!status || !statusText) return;
    status.classList.remove("is-on");
    window.setTimeout(function () {
      status.classList.toggle("is-action", kind === "action");
      statusText.textContent = text || "";
      status.classList.add("is-on");
    }, 160);
  }

  function play() {
    var i = 0;
    (function next() {
      var item = items[i];
      i += 1;
      if (!item) return;
      item.classList.add("is-in");
      last = item;
      fit(item);
      if (item.hasAttribute("data-hx-validates")) chat.classList.add("is-validated");
      var kind = item.getAttribute("data-hx-step");
      if (kind === "answer") {
        // Dernier message : les réponses proposées au client remplacent l'indicateur.
        if (status) status.classList.remove("is-on");
        window.setTimeout(function () { chat.classList.add("is-done"); }, 450);
      } else if (kind) {
        showStatus(kind, item.getAttribute("data-hx-text"));
      }
      window.setTimeout(next, i === 1 ? 250 : 1000);
    })();
  }

  window.addEventListener("resize", function () { fit(last); });

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      observer.disconnect();
      window.setTimeout(play, 350);
    }, { threshold: 0.35 });
    observer.observe(chat);
  } else {
    play();
  }
})();

(function () {
  "use strict";

  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var gsap = window.gsap;

  function showAll() {
    root.classList.add("reveal-fallback");
  }

  if (!gsap || reduce) {
    showAll();
    return;
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Hero
    var heroItems = document.querySelectorAll("[data-hero-item]");
    if (heroItems.length) {
      gsap.fromTo(
        heroItems,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.08, delay: 0.05, onComplete: showAll }
      );
    }

    // Apparition au défilement (les éléments hors écran sont masqués par JS, jamais par CSS).
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length || !("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          observer.unobserve(el);
          var items = el.hasAttribute("data-reveal-stagger") ? el.children : el;
          gsap.to(items, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.07, clearProps: "transform" });
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );

    // Impression : tout afficher, même ce qui n'a jamais été visible à l'écran.
    window.addEventListener("beforeprint", function () {
      gsap.set(document.querySelectorAll("[data-reveal], [data-reveal] > *"), { opacity: 1, y: 0 });
    });

    targets.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight) return; // déjà visible : pas d'animation
      var items = el.hasAttribute("data-reveal-stagger") ? el.children : el;
      gsap.set(items, { opacity: 0, y: 20 });
      observer.observe(el);
    });
  });
})();
