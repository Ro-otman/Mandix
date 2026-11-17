/**
 * Sonnerie des espaces client et mandataire : nouveau message, nouvelle notification.
 *  - Son synthétisé dans le navigateur (Web Audio) : court carillon doux, sans fichier ni service externe.
 *    « message » : deux notes montantes ; « notification » : une note claire.
 *  - Un seul son par événement : un message et la notification qui l'accompagne ne sonnent qu'une fois, et
 *    plusieurs onglets ouverts ne sonnent pas ensemble (l'onglet visible joue, les autres se taisent).
 *  - Bouton « son » de la barre du haut : activé par défaut, choix mémorisé sur cet appareil.
 *  - Les navigateurs n'autorisent le son qu'après une première interaction avec la page (clic, touche).
 * MC.sound.play("message" | "notification") — appelé par public/js/realtime.js.
 */
(function () {
  "use strict";

  var MC = (window.MC = window.MC || {});
  var PREF = "mandix:sound";
  var LAST = "mandix:sound:last";
  var GAP_MS = 2000; // un seul son pour une rafale (message + notification, plusieurs onglets)
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var lastLocal = 0;

  function read(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* stockage indisponible */ } }

  function enabled() { return read(PREF) !== "off"; }

  function context() {
    if (!AudioCtx) return null;
    if (!ctx) { try { ctx = new AudioCtx(); } catch (e) { return null; } }
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    return ctx;
  }

  /** Une note douce : sinusoïde + harmonique légère (timbre de marimba), attaque brève, extinction naturelle. */
  function note(audio, out, freq, start, length, volume) {
    [[1, volume], [2.01, volume * 0.18]].forEach(function (partial) {
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * partial[0], start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(partial[1], start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + length + 0.05);
    });
  }

  function chime(kind) {
    var audio = context();
    if (!audio || audio.state !== "running") return;
    var out = audio.createGain();
    out.gain.value = 0.55;
    out.connect(audio.destination);
    var t = audio.currentTime + 0.01;
    if (kind === "message") {
      note(audio, out, 880, t, 0.22, 0.32); // la
      note(audio, out, 1318.5, t + 0.1, 0.42, 0.28); // mi, une quinte au-dessus
    } else {
      note(audio, out, 1174.7, t, 0.38, 0.3); // ré
    }
  }

  function recentlyPlayed() {
    var shared = parseInt(read(LAST), 10) || 0;
    return Date.now() - Math.max(shared, lastLocal) < GAP_MS;
  }

  function play(kind) {
    if (!enabled() || recentlyPlayed()) return;
    var go = function () {
      if (recentlyPlayed()) return; // un autre onglet a déjà sonné
      lastLocal = Date.now();
      write(LAST, String(lastLocal));
      chime(kind);
    };
    // L'onglet visible sonne tout de suite ; un onglet en arrière-plan attend un instant, au cas où un onglet
    // visible du même compte sonnerait déjà.
    if (document.visibilityState === "visible") go();
    else window.setTimeout(go, 250 + Math.floor(Math.random() * 250));
  }

  MC.sound = { play: play, enabled: enabled };

  // Première interaction avec la page : le navigateur autorise alors le son.
  var unlock = function () {
    if (enabled()) context();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);

  // Bouton « son » de la barre du haut
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-sound-toggle]").forEach(function (button) {
      var paint = function () {
        var on = enabled();
        button.classList.toggle("is-muted", !on);
        button.setAttribute("aria-pressed", String(!on));
        button.setAttribute("aria-label", on ? "Couper le son des notifications" : "Activer le son des notifications");
        button.title = on ? "Son des notifications activé" : "Son des notifications coupé";
      };
      paint();
      button.addEventListener("click", function () {
        write(PREF, enabled() ? "off" : "on");
        paint();
        if (enabled()) { context(); window.setTimeout(function () { chime("message"); }, 30); } // aperçu du son
      });
      // Choix changé dans un autre onglet
      window.addEventListener("storage", function (event) { if (event.key === PREF) paint(); });
    });
  });
})();
