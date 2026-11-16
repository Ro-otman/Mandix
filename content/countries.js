/**
 * Pays proposés dans les formulaires et les filtres (plateforme internationale).
 * code : ISO 3166-1 alpha-2 ; currency : devise principale (ISO 4217).
 */
export const COUNTRIES = [
  { code: "DZ", name: "Algérie", currency: "DZD" },
  { code: "DE", name: "Allemagne", currency: "EUR" },
  { code: "BE", name: "Belgique", currency: "EUR" },
  { code: "BJ", name: "Bénin", currency: "XOF" },
  { code: "BF", name: "Burkina Faso", currency: "XOF" },
  { code: "CM", name: "Cameroun", currency: "XAF" },
  { code: "CA", name: "Canada", currency: "CAD" },
  { code: "CG", name: "Congo", currency: "XAF" },
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF" },
  { code: "AE", name: "Émirats arabes unis", currency: "AED" },
  { code: "ES", name: "Espagne", currency: "EUR" },
  { code: "US", name: "États-Unis", currency: "USD" },
  { code: "FR", name: "France", currency: "EUR" },
  { code: "GA", name: "Gabon", currency: "XAF" },
  { code: "GN", name: "Guinée", currency: "GNF" },
  { code: "HT", name: "Haïti", currency: "HTG" },
  { code: "IT", name: "Italie", currency: "EUR" },
  { code: "LU", name: "Luxembourg", currency: "EUR" },
  { code: "MG", name: "Madagascar", currency: "MGA" },
  { code: "ML", name: "Mali", currency: "XOF" },
  { code: "MA", name: "Maroc", currency: "MAD" },
  { code: "NE", name: "Niger", currency: "XOF" },
  { code: "CD", name: "République démocratique du Congo", currency: "CDF" },
  { code: "GB", name: "Royaume-Uni", currency: "GBP" },
  { code: "SN", name: "Sénégal", currency: "XOF" },
  { code: "CH", name: "Suisse", currency: "CHF" },
  { code: "TG", name: "Togo", currency: "XOF" },
  { code: "TN", name: "Tunisie", currency: "TND" },
];

export const countryName = (code) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

// Préposition de lieu : « au Sénégal », « aux États-Unis », « à Madagascar », « en France » (défaut).
const PREPOSITION = {
  au: ["BJ", "BF", "CM", "CA", "CG", "GA", "LU", "ML", "MA", "NE", "GB", "SN", "TG"],
  aux: ["AE", "US"],
  "à": ["MG"],
};

export const countryIn = (code) => {
  const name = countryName(code);
  const prep = Object.keys(PREPOSITION).find((p) => PREPOSITION[p].includes(code)) ?? "en";
  return `${prep} ${name}`;
};
