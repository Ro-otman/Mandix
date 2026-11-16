/**
 * PROFILS DE DÉMONSTRATION — entièrement fictifs, utilisés uniquement pour concevoir le design.
 * Actifs seulement si DEMO_CONTENT=true (jamais en production, voir config/app.js).
 *
 * Mandix est un annuaire international de MANDATAIRES : chaque profil liste les comptes
 * (PayPal, Wise, virement, Western Union…) sur lesquels il accompagne ses clients.
 * Aucune donnée bancaire de client (numéro de compte, IBAN, identifiant) n'est jamais stockée.
 * Les noms de banques sont fictifs.
 *
 * transactions : opérations menées à terme avec des clients (certification à partir de 1 000).
 * joinedAt : date d'inscription sur la plateforme (« Membre depuis … »).
 * lastSeenMinutes : dernière activité, en minutes avant le chargement de la page (0 = en ligne).
 */

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

// Pièces habituellement demandées, réutilisées d'une offre à l'autre.
const ID = "Pièce d'identité ou passeport en cours de validité";
const ADDRESS = "Justificatif de domicile de moins de 3 mois";
const COMPANY = "Statuts de l'entreprise et extrait du registre du commerce";

export const DEMO_MANDATAIRES = [
  {
    slug: "afiavi-houngbedji", joinedAt: daysAgo(980), firstName: "Afiavi", lastName: "Houngbédji",
    country: "BJ", city: "Cotonou", languages: ["Français", "Fon", "Anglais"],
    responseHours: 2, yearsExperience: 9, transactions: 1240, lastSeenMinutes: 0,
    avatar: { skin: 4, hair: "headwrap", outfit: "emerald", background: "menthe" },
    rating: 4.9, reviewsCount: 38,
    bio: "Je réalise vos transactions entre Western Union, MoneyGram, PayPal et la crypto depuis Cotonou. Réponse rapide, coordonnées envoyées dès le montant validé, capture du transfert à chaque fois. Je parle français, fon et anglais.",
    banks: [{ name: "Banque Lagune", relationship: "Mandataire agréée" }],
    accounts: [
      { id: "afi-1", type: "westernunion", currency: "XOF", country: "BJ", remote: true, description: "Envoi ou réception d'argent via Western Union : pièces à prévoir et suivi du transfert.", documents: [ID] },
      { id: "afi-2", type: "moneygram", currency: "XOF", country: "BJ", remote: true, description: "Envoi ou réception d'argent via MoneyGram : pièces à prévoir et suivi du transfert.", documents: [ID] },
      { id: "afi-3", type: "crypto", currency: "XOF", country: "BJ", remote: true, description: "Ouverture d'un portefeuille crypto sur une plateforme reconnue et règles de sécurité essentielles.", documents: [ID, ADDRESS] },
      { id: "afi-4", type: "paypal", currency: "EUR", country: "BE", remote: true, description: "Paiements PayPal en euros, compte ouvert en Belgique.", documents: [ID] },
    ],
    qualifications: [
      { title: "Certificat d'agent commercial bancaire", issuer: "Centre de formation bancaire (fictif)", year: 2017 },
      { title: "Formation conformité et lutte anti-blanchiment", issuer: "Banque Lagune", year: 2023 },
    ],
    reviews: [
      { author: "Mariette A.", rating: 5, comment: "Transaction MoneyGram vers mon PayPal réglée dans la journée, avec la capture du transfert à chaque étape.", date: daysAgo(12) },
      { author: "Romuald K.", rating: 5, comment: "Paiement validé très vite, argent reçu le soir même. Je recommande.", date: daysAgo(34) },
    ],
  },
  {
    slug: "claire-martin", joinedAt: daysAgo(1120), firstName: "Claire", lastName: "Martin",
    country: "FR", city: "Paris", languages: ["Français", "Anglais"],
    responseHours: 3, yearsExperience: 12, transactions: 1860, lastSeenMinutes: 12,
    avatar: { skin: 1, hair: "long", hairColor: "brown", outfit: "navy", background: "brume", accessory: "glasses" },
    rating: 4.8, reviewsCount: 64,
    bio: "Basée à Paris, je gère vos transactions PayPal, Wero et virements en euros. Idéal pour les étudiants et nouveaux arrivants qui reçoivent de l'argent de leur famille. Paiements validés dans la journée.",
    banks: [{ name: "Banque Méridienne", relationship: "Mandataire" }],
    accounts: [
      { id: "cla-1", type: "paypal", currency: "EUR", country: "FR", remote: true, description: "Je vous aide à créer et faire vérifier votre compte PayPal, puis à l'utiliser en sécurité.", documents: [ID, ADDRESS] },
      { id: "cla-2", type: "wero", currency: "EUR", country: "FR", remote: true, description: "Activation de Wero depuis votre application bancaire et premiers paiements entre particuliers.", documents: [ID] },
      { id: "cla-3", bank: "Banque Méridienne", type: "virement", currency: "EUR", country: "FR", remote: true, description: "Accompagnement pour vos virements bancaires : informations à fournir, délais et frais.", documents: [ID] },
    ],
    qualifications: [{ title: "Licence professionnelle banque et assurance", issuer: "Université (fictive) de Paris", year: 2012 }],
    reviews: [
      { author: "Fatou S.", rating: 5, comment: "Depuis Dakar, j'ai reçu mes euros sur Wero en moins d'une heure. Tout s'est fait dans la messagerie, étape par étape.", date: daysAgo(8) },
      { author: "Lucas P.", rating: 4, comment: "Efficace et claire, réponse le jour même.", date: daysAgo(41) },
    ],
  },
  {
    slug: "moussa-diop", joinedAt: daysAgo(640), firstName: "Moussa", lastName: "Diop",
    country: "SN", city: "Dakar", languages: ["Français", "Wolof", "Anglais"],
    responseHours: 1, yearsExperience: 7, transactions: 760, lastSeenMinutes: 0,
    avatar: { skin: 6, hair: "fade", outfit: "blue", background: "ciel" },
    rating: 4.9, reviewsCount: 41,
    bio: "Je travaille avec la diaspora sénégalaise : vos transactions Wise, PayPal et MoneyGram, entre la France, la Belgique et le Sénégal. Montants clairs, preuves à chaque étape, réponse en quelques minutes.",
    banks: [{ name: "Union Bancaire du Sahel", relationship: "Mandataire agréé" }],
    accounts: [
      { id: "mou-1", type: "wise", currency: "EUR", country: "FR", remote: true, description: "Ouverture de votre compte Wise multidevise et premiers envois à l'international.", documents: [ID, ADDRESS] },
      { id: "mou-2", type: "moneygram", currency: "XOF", country: "SN", remote: true, description: "Envoi ou réception d'argent via MoneyGram : pièces à prévoir et suivi du transfert.", documents: [ID] },
      { id: "mou-3", type: "paypal", currency: "EUR", country: "BE", remote: true, description: "Je vous aide à créer et faire vérifier votre compte PayPal, puis à l'utiliser en sécurité.", documents: [ID, ADDRESS] },
    ],
    qualifications: [{ title: "Certificat en banque de détail", issuer: "Institut bancaire (fictif) de Dakar", year: 2018 }],
    reviews: [
      { author: "Ibrahima N.", rating: 5, comment: "Transaction Wise vers Orange Money sans accroc, preuves envoyées des deux côtés.", date: daysAgo(5) },
      { author: "Awa T.", rating: 5, comment: "Très réactif, il répond en quelques minutes.", date: daysAgo(27) },
    ],
  },
  {
    slug: "marc-andre-tremblay", joinedAt: daysAgo(1260), firstName: "Marc-André", lastName: "Tremblay",
    country: "CA", city: "Montréal", languages: ["Français", "Anglais"],
    responseHours: 4, yearsExperience: 15, transactions: 2310, lastSeenMinutes: 45,
    avatar: { skin: 2, hair: "short", hairColor: "grey", outfit: "white", background: "sable" },
    rating: 4.7, reviewsCount: 57,
    bio: "Depuis Montréal, je traite vos transactions Stripe, PayPal et Wise en dollars canadiens et en euros. Plus de 2 000 transactions menées à terme, toujours avec la capture du transfert.",
    banks: [{ name: "Banque des Lacs", relationship: "Représentant autorisé" }],
    accounts: [
      { id: "mar-1", type: "stripe", currency: "CAD", country: "CA", remote: true, description: "Mise en place de votre compte Stripe pour encaisser vos ventes en ligne, étape par étape.", documents: [ID, COMPANY] },
      { id: "mar-2", type: "paypal", currency: "CAD", country: "CA", remote: true, description: "Je vous aide à créer et faire vérifier votre compte PayPal, puis à l'utiliser en sécurité.", documents: [ID, ADDRESS] },
      { id: "mar-3", type: "wise", currency: "CAD", country: "CA", remote: true, description: "Ouverture de votre compte Wise multidevise et premiers envois à l'international.", documents: [ID, ADDRESS] },
    ],
    qualifications: [{ title: "Certificat de représentant en services bancaires", issuer: "Institut canadien (fictif)", year: 2010 }],
    reviews: [{ author: "Nadia B.", rating: 5, comment: "Virement instantané reçu à Montréal en quelques minutes. Un vrai soulagement.", date: daysAgo(19) }],
  },
  {
    slug: "aya-kouassi", joinedAt: daysAgo(430), firstName: "Aya", lastName: "Kouassi",
    country: "CI", city: "Abidjan", languages: ["Français", "Baoulé"],
    responseHours: 2, yearsExperience: 6, transactions: 480, lastSeenMinutes: 0,
    avatar: { skin: 5, hair: "braids", outfit: "gold", background: "or" },
    rating: 4.8, reviewsCount: 29,
    bio: "À Abidjan, je fais vos transactions crypto, Skrill et Western Union en F CFA. Je vous indique chaque étape dans la messagerie et je valide votre paiement dès qu'il est crédité.",
    banks: [{ name: "Crédit Rivage", relationship: "Mandataire" }],
    accounts: [
      { id: "aya-1", type: "crypto", currency: "XOF", country: "CI", remote: true, description: "Ouverture d'un portefeuille crypto sur une plateforme reconnue et règles de sécurité essentielles.", documents: [ID, ADDRESS] },
      { id: "aya-2", type: "skrill", currency: "XOF", country: "CI", remote: true, description: "Création de votre portefeuille Skrill et vérification de votre identité.", documents: [ID, ADDRESS] },
      { id: "aya-3", type: "westernunion", currency: "XOF", country: "CI", remote: true, description: "Envoi ou réception d'argent via Western Union : pièces à prévoir et suivi du transfert.", documents: [ID] },
    ],
    qualifications: [{ title: "BTS banque", issuer: "École supérieure (fictive) d'Abidjan", year: 2019 }],
    reviews: [{ author: "Serge K.", rating: 5, comment: "Montant vérifié, coordonnées envoyées tout de suite, argent reçu. Merci !", date: daysAgo(10) }],
  },
  {
    slug: "julien-peeters", joinedAt: daysAgo(760), firstName: "Julien", lastName: "Peeters",
    country: "BE", city: "Bruxelles", languages: ["Français", "Néerlandais", "Anglais"],
    responseHours: 6, yearsExperience: 10, transactions: 920, lastSeenMinutes: 180,
    avatar: { skin: 1, hair: "short", hairColor: "brown", outfit: "blue", background: "brume" },
    rating: 4.6, reviewsCount: 22,
    bio: "Indépendants et freelances : je réalise vos transactions Wero, virement et PCS Mastercard depuis la Belgique. Virement instantané ou classique, selon votre besoin.",
    banks: [{ name: "Banque Méridienne", relationship: "Agent délégué" }],
    accounts: [
      { id: "jul-1", type: "wero", currency: "EUR", country: "BE", remote: true, description: "Activation de Wero depuis votre application bancaire et premiers paiements entre particuliers.", documents: [ID] },
      { id: "jul-2", bank: "Banque Méridienne", type: "virement", currency: "EUR", country: "BE", remote: true, description: "Accompagnement pour vos virements bancaires : informations à fournir, délais et frais.", documents: [ID] },
      { id: "jul-3", type: "pcs", currency: "EUR", country: "BE", remote: true, description: "Obtention de votre carte prépayée PCS Mastercard et explication des recharges.", documents: [ID, ADDRESS] },
    ],
    qualifications: [{ title: "Agrément d'agent en services bancaires", issuer: "Autorité de contrôle (fictive)", year: 2015 }],
    reviews: [{ author: "Émilie D.", rating: 4, comment: "Transaction correcte, mais un peu de délai pour valider ma preuve.", date: daysAgo(30) }],
  },
  {
    slug: "sophie-keller", joinedAt: daysAgo(890), firstName: "Sophie", lastName: "Keller",
    country: "CH", city: "Genève", languages: ["Français", "Allemand", "Anglais"],
    responseHours: 3, yearsExperience: 14, transactions: 1050, lastSeenMinutes: 5,
    avatar: { skin: 1, hair: "bun", hairColor: "brown", outfit: "white", background: "ciel" },
    rating: 4.9, reviewsCount: 33,
    bio: "Frontaliers et expatriés : vos transactions Wise, Stripe et virements entre la Suisse et la zone euro, en francs suisses ou en euros. Rapide et précis.",
    banks: [{ name: "Banque Alizé", relationship: "Mandataire" }],
    accounts: [
      { id: "sop-1", type: "wise", currency: "CHF", country: "CH", remote: true, description: "Ouverture de votre compte Wise multidevise et premiers envois à l'international.", documents: [ID, ADDRESS] },
      { id: "sop-2", type: "stripe", currency: "CHF", country: "CH", remote: true, description: "Mise en place de votre compte Stripe pour encaisser vos ventes en ligne, étape par étape.", documents: [ID, COMPANY] },
      { id: "sop-3", bank: "Banque Alizé", type: "virement", currency: "CHF", country: "CH", remote: true, description: "Accompagnement pour vos virements bancaires : informations à fournir, délais et frais.", documents: [ID] },
    ],
    qualifications: [{ title: "Diplôme fédéral (fictif) de conseillère bancaire", issuer: "Association bancaire (fictive)", year: 2011 }],
    reviews: [{ author: "Thomas R.", rating: 5, comment: "Paiement en francs suisses, réception en euros : clair et rapide.", date: daysAgo(15) }],
  },
  {
    slug: "yasmine-el-idrissi", joinedAt: daysAgo(560), firstName: "Yasmine", lastName: "El Idrissi",
    country: "MA", city: "Casablanca", languages: ["Français", "Arabe", "Anglais"],
    responseHours: 2, yearsExperience: 8, transactions: 640, lastSeenMinutes: 1500,
    avatar: { skin: 3, hair: "long", outfit: "clay", background: "or" },
    rating: 4.8, reviewsCount: 26,
    bio: "Depuis Casablanca, je gère vos transactions Paysafecard, Neosurf et Skrill pour les Marocains de l'étranger et les particuliers. Coordonnées et preuves envoyées sans attendre.",
    banks: [{ name: "Cèdre Banque", relationship: "Mandataire" }],
    accounts: [
      { id: "yas-1", type: "paysafecard", currency: "MAD", country: "MA", remote: true, description: "Paiement en ligne avec Paysafecard : achat du code, utilisation et précautions.", documents: [] },
      { id: "yas-2", type: "neosurf", currency: "MAD", country: "MA", remote: true, description: "Paiement en ligne avec Neosurf : achat du ticket, utilisation et bonnes pratiques.", documents: [] },
      { id: "yas-3", type: "skrill", currency: "MAD", country: "MA", remote: true, description: "Création de votre portefeuille Skrill et vérification de votre identité.", documents: [ID, ADDRESS] },
    ],
    qualifications: [{ title: "Master finance et banque", issuer: "Université (fictive) de Casablanca", year: 2016 }],
    reviews: [{ author: "Karim B.", rating: 5, comment: "Transaction Paysafecard réglée depuis Bruxelles, très professionnelle.", date: daysAgo(22) }],
  },
  {
    slug: "brice-ngono", joinedAt: daysAgo(300), firstName: "Brice", lastName: "Ngono",
    country: "CM", city: "Douala", languages: ["Français", "Anglais"],
    responseHours: 5, yearsExperience: 5, transactions: 310, lastSeenMinutes: 25,
    avatar: { skin: 6, hair: "short", outfit: "navy", background: "menthe", accessory: "glasses" },
    rating: 4.6, reviewsCount: 14,
    bio: "À Douala, je fais vos transactions Transcash, PCS Mastercard et crypto pour les commerçants et les particuliers. Paiements suivis de bout en bout dans la messagerie.",
    banks: [{ name: "Crédit Rivage", relationship: "Mandataire" }],
    accounts: [
      { id: "bri-1", type: "transcash", currency: "XAF", country: "CM", remote: true, description: "Où acheter un ticket Transcash, comment le recharger et l'utiliser sans risque.", documents: [ID] },
      { id: "bri-2", type: "pcs", currency: "XAF", country: "CM", remote: true, description: "Obtention de votre carte prépayée PCS Mastercard et explication des recharges.", documents: [ID, ADDRESS] },
      { id: "bri-3", type: "crypto", currency: "XAF", country: "CM", remote: true, description: "Ouverture d'un portefeuille crypto sur une plateforme reconnue et règles de sécurité essentielles.", documents: [ID, ADDRESS] },
    ],
    qualifications: [{ title: "Licence en banque et finance", issuer: "Université (fictive) de Douala", year: 2020 }],
    reviews: [{ author: "Joëlle M.", rating: 5, comment: "Rapide et fiable pour mes paiements de fournisseurs.", date: daysAgo(18) }],
  },
];
