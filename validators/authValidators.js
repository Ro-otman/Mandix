/**
 * Validation serveur des formulaires d'authentification (express-validator).
 * Les contrôles du navigateur (required, pattern…) ne sont qu'un confort : tout est revérifié ici.
 * La robustesse du mot de passe est contrôlée par utils/password.js (checkPasswordPolicy).
 */
import { body, matchedData, validationResult } from "express-validator";
import { PASSWORD_MAX } from "../utils/password.js";

/** Adresse e-mail : espaces retirés, minuscules (sans autre réécriture : l'adresse reste celle saisie). */
const email = () =>
  body("email")
    .isString().withMessage("Indiquez votre adresse e-mail.")
    .bail()
    .trim()
    .toLowerCase()
    .notEmpty().withMessage("Indiquez votre adresse e-mail.")
    .bail()
    .isLength({ max: 191 }).withMessage("Adresse e-mail trop longue.")
    .bail()
    .isEmail({ allow_utf8_local_part: false, require_tld: true }).withMessage("Adresse e-mail invalide.");

const newPassword = () =>
  body("password")
    .isString().withMessage("Choisissez un mot de passe.")
    .bail()
    .isLength({ min: 1, max: PASSWORD_MAX }).withMessage("Choisissez un mot de passe.");

const passwordConfirm = () =>
  body("passwordConfirm")
    .isString().withMessage("Retapez le mot de passe.")
    .bail()
    .custom((value, { req }) => value === req.body.password).withMessage("Les deux mots de passe ne correspondent pas.");

export const registerRules = [
  body("pseudo")
    .isString().withMessage("Choisissez un pseudo.")
    .bail()
    .trim()
    .matches(/^[A-Za-z0-9._-]{3,20}$/).withMessage("Pseudo : 3 à 20 caractères (lettres, chiffres, point, tiret, tiret bas)."),
  email(),
  newPassword(),
  passwordConfirm(),
  body("terms").equals("on").withMessage("Vous devez accepter les conditions d'utilisation et la politique de confidentialité."),
];

export const loginRules = [
  email(),
  body("password").isString().bail().isLength({ min: 1, max: PASSWORD_MAX }).withMessage("Indiquez votre mot de passe."),
  body("remember").optional().equals("on"),
  body("suite").optional().isString().isLength({ max: 300 }),
  body("espace").optional().isString().isLength({ max: 20 }),
];

export const emailOnlyRules = [email()];

export const resetRules = [newPassword(), passwordConfirm()];

/**
 * Résultat de la validation : première erreur par champ, et données nettoyées (seuls les champs déclarés).
 * @returns {{errors: Record<string, string> | null, data: Record<string, any>}}
 */
export function readValidation(req) {
  const result = validationResult(req);
  const errors = {};
  for (const error of result.array({ onlyFirstError: true })) {
    if (error.type === "field" && !errors[error.path]) errors[error.path] = error.msg;
  }
  return { errors: Object.keys(errors).length ? errors : null, data: matchedData(req, { onlyValidData: false, includeOptionals: true }) };
}
