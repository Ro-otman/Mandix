// Démonstrations du guide de style (page de développement uniquement).
document.addEventListener("DOMContentLoaded", function () {
  var messages = {
    success: "Vos modifications ont été enregistrées.",
    danger: "Le fichier dépasse la taille maximale autorisée (5 Mo).",
    info: "Votre dossier a été transmis à notre équipe.",
  };
  document.querySelectorAll("[data-demo-toast]").forEach(function (button) {
    button.addEventListener("click", function () {
      var type = button.getAttribute("data-demo-toast");
      window.MC.toast(messages[type], type);
    });
  });
});
