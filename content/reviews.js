/**
 * Évaluation d'une transaction : note de 1 à 5 et appréciation préfaite (pas de texte libre).
 * Mêmes valeurs que public/js/chat.js ; la clé est enregistrée en base (reviews.appreciation).
 */
export const RATING_LABELS = ["", "Très décevant", "Décevant", "Correct", "Très bien", "Excellent"];

export const APPRECIATIONS = {
  high: [["rapide_fiable", "Rapide et fiable"], ["professionnel", "Très professionnel"], ["recommande", "Je recommande"]],
  mid: [["correct", "Transaction correcte"], ["delai", "Un peu de délai, mais sérieux"]],
  low: [["trop_lent", "Délais trop longs"], ["communication", "Communication difficile"], ["decevant", "Expérience décevante"]],
};

export const appreciationsFor = (rating) => (rating >= 4 ? APPRECIATIONS.high : rating === 3 ? APPRECIATIONS.mid : APPRECIATIONS.low);

const LABELS = new Map(Object.values(APPRECIATIONS).flat());
export const appreciationLabel = (key) => LABELS.get(key) ?? key;
