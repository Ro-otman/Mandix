/** Centre d'aide : thèmes et questions (contenu éditorial). */
export const helpTopics = [
  {
    id: "messages", title: "Messagerie", icon: "message-circle",
    items: [
      { question: "Comment écrire à un mandataire ?", answer: "Sur la carte ou le profil d'un mandataire, cliquez sur « Message ». La conversation s'ouvre dans votre espace client, rubrique « Messages »." },
      { question: "Comment savoir si le mandataire m'a répondu ?", answer: "Vous recevez une notification dans votre espace (et par e-mail selon vos préférences). Les conversations non lues sont signalées par un compteur." },
      { question: "Pourquoi mon message n'a-t-il pas été envoyé ?", answer: "Par sécurité, un message qui semble contenir un numéro de carte ou un IBAN est bloqué. Ne partagez jamais ces informations, ni vos codes." },
    ],
  },
  {
    id: "comptes", title: "Comptes et pays", icon: "landmark",
    items: [
      { question: "Quels types de comptes puis-je ouvrir ?", answer: "Compte courant, épargne, professionnel, en devises, étudiant, joint ou non-résident, selon les offres de chaque mandataire. Filtrez la recherche par type de compte." },
      { question: "Puis-je ouvrir un compte dans un autre pays que le mien ?", answer: "Oui, si l'offre le permet. Activez le filtre « Accompagnement à distance » pour voir les mandataires qui accompagnent des clients résidant à l'étranger." },
      { question: "Mandix ouvre-t-il le compte à ma place ?", answer: "Non. Le compte est ouvert par la banque. Le mandataire vous accompagne ; la décision d'ouverture appartient toujours à la banque." },
    ],
  },
  {
    id: "confiance", title: "Choisir un mandataire", icon: "user-check",
    items: [
      { question: "Les mandataires sont-ils vérifiés ?", answer: "Non : aucune pièce justificative n'est demandée à l'inscription. Fiez-vous à leur niveau, à leur nombre de transactions et aux avis des clients." },
      { question: "Que se passe-t-il en cas de paiement contesté ?", answer: "Après 7 jours de paiement « en attente », vous pouvez demander des preuves au mandataire, puis un examen par notre équipe, qui vous notifie sa décision." },
    ],
  },
  {
    id: "securite", title: "Sécurité et données", icon: "shield-check",
    items: [
      { question: "Mandix peut-il me demander mes codes bancaires ?", answer: "Jamais. Ni Mandix ni un mandataire ne doivent vous demander vos codes, mots de passe ou identifiants bancaires. Si cela arrive, signalez-le immédiatement." },
      { question: "La plateforme effectue-t-elle des paiements ?", answer: "Non. Mandix est un service de mise en relation : aucun paiement, dépôt, retrait ou virement n'est réalisé sur la plateforme." },
      { question: "Qui peut voir mes messages ?", answer: "Uniquement vous et le mandataire concerné. Notre équipe n'y accède qu'en cas de signalement, et cet accès est tracé." },
    ],
  },
  {
    id: "compte", title: "Mon compte", icon: "circle-user-round",
    items: [
      { question: "J'ai oublié mon mot de passe", answer: "Sur la page de connexion, cliquez sur « Mot de passe oublié ? » et indiquez votre adresse e-mail. Vous recevrez un lien de réinitialisation à usage unique." },
      { question: "Comment supprimer mon compte ?", answer: "Dans « Paramètres », section « Supprimer mon compte ». Vos données personnelles sont anonymisées." },
    ],
  },
];
