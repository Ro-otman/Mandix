-- Données de référence (idempotent). Aucune donnée de démonstration n'est présentée comme réelle :
-- pas de faux mandataires, pas de fausses évaluations.

SET NAMES utf8mb4;

-- Catalogue des comptes de la plateforme, dans l'ordre d'affichage (content/account-types.js).
-- Logos : public/images/services/<slug>.svg. Mandix n'est affilié à aucun de ces services ; les marques
-- appartiennent à leurs propriétaires. Les comptes ajoutés par les mandataires (« Autre ») s'ajoutent à la suite.
INSERT INTO account_types (slug, name, logo_path, receive_label, receive_placeholder, is_builtin, sort_order) VALUES
  ('paypal', 'PayPal', '/images/services/paypal.svg', 'Adresse e-mail PayPal', 'vous@exemple.com', 1, 10),
  ('stripe', 'Stripe', '/images/services/stripe.svg', 'E-mail ou identifiant du compte Stripe', 'vous@exemple.com', 1, 20),
  ('wise', 'Wise', '/images/services/wise.svg', 'IBAN ou e-mail Wise', 'BE68 5390 0754 7034 ou vous@exemple.com', 1, 30),
  ('virement', 'Virement', '/images/services/virement.svg', 'IBAN', 'FR76 3000 6000 0112 3456 7890 189', 1, 40),
  ('transcash', 'Transcash', '/images/services/transcash.svg', 'Référence du compte Transcash', 'Référence indiquée dans votre espace Transcash', 1, 50),
  ('neosurf', 'Neosurf', '/images/services/neosurf.svg', 'Identifiant myNeosurf', 'Identifiant ou e-mail myNeosurf', 1, 60),
  ('paysafecard', 'Paysafecard', '/images/services/paysafecard.svg', 'Identifiant my paysafecard', 'Identifiant ou e-mail my paysafecard', 1, 70),
  ('wero', 'Wero', '/images/services/wero.svg', 'Téléphone ou e-mail Wero', '+33 6 12 34 56 78', 1, 80),
  ('pcs', 'PCS Mastercard', '/images/services/pcs.svg', 'IBAN de la carte PCS Mastercard', 'FR76 …', 1, 90),
  ('skrill', 'Skrill', '/images/services/skrill.svg', 'Adresse e-mail Skrill', 'vous@exemple.com', 1, 100),
  ('westernunion', 'Western Union', '/images/services/westernunion.svg', 'Nom complet et pays du bénéficiaire', 'Prénom Nom — Ville, Pays', 1, 110),
  ('moneygram', 'MoneyGram', '/images/services/moneygram.svg', 'Nom complet et pays du bénéficiaire', 'Prénom Nom — Ville, Pays', 1, 120),
  ('crypto', 'Crypto', '/images/services/crypto.svg', 'Adresse de portefeuille (publique) et réseau', 'Ex. bc1q… (réseau Bitcoin)', 1, 130)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), logo_path = VALUES(logo_path), receive_label = VALUES(receive_label),
  receive_placeholder = VALUES(receive_placeholder), is_builtin = 1, sort_order = VALUES(sort_order);
