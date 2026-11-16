/**
 * Construction de l'application Express (sans démarrage du serveur : voir server.js).
 * Séparé pour pouvoir tester l'application sans ouvrir de port.
 */
import path from "node:path";
import zlib from "node:zlib";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import expressStaticGzip from "express-static-gzip";
import cookieParser from "cookie-parser";

import config from "./config/app.js";
import { globalLimiter } from "./middlewares/rateLimiter.js";
import { authenticate } from "./middlewares/authenticate.js";
import { visitorId, exposeCsrfToken, csrfProtection } from "./middlewares/csrf.js";
import { flash } from "./middlewares/flash.js";
import { viewLocals } from "./middlewares/locals.js";
import { layoutMiddleware } from "./middlewares/layout.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";
import routes from "./routes/index.js";

const app = express();

app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);

app.set("view engine", "ejs");
app.set("views", path.join(config.rootDir, "views"));

// En-têtes de sécurité. CSP stricte : aucun script inline, aucune ressource tierce (polices comprises).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"], // polices hébergées sur le site (public/fonts)
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        // Temps réel : connexion WebSocket vers le même site uniquement
        connectSrc: ["'self'", new URL(config.baseUrl).origin.replace(/^http/, "ws")],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// Fichiers construits (npm run build) : nom avec empreinte de contenu, donc cache d'un an sans revalidation.
// Copies pré-compressées (.br, .gz) servies directement selon ce que le navigateur accepte.
app.use(
  "/dist",
  expressStaticGzip(path.join(config.rootDir, "public", "dist"), {
    enableBrotli: true,
    orderPreference: ["br", "gz"],
    serveStatic: { maxAge: "1y", immutable: true },
  }),
);
// Compression à la volée (Brotli si le navigateur l'accepte, sinon gzip) pour le reste : pages HTML, SVG, JSON.
// Niveau Brotli modéré : bon rapport taille / temps de calcul pour des pages générées à chaque requête.
app.use(compression({ brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } } }));

// Polices (public/fonts) : fichiers stables, cache long en production.
app.use(
  "/fonts",
  express.static(path.join(config.rootDir, "public", "fonts"), { maxAge: config.isProduction ? "365d" : 0 }),
);
// Images, logos et drapeaux : rarement modifiés, cache long en production.
app.use(
  "/images",
  express.static(path.join(config.rootDir, "public", "images"), { maxAge: config.isProduction ? "30d" : 0 }),
);
const staticOptions = { maxAge: config.isProduction ? "7d" : 0 };
app.use(express.static(path.join(config.rootDir, "public"), staticOptions));
// Bibliothèques front servies localement (pas de CDN : CSP 'self' et fonctionnement hors ligne).
// Version figée dans package.json : cache long en production.
app.use(
  "/vendor/gsap",
  express.static(
    path.join(config.rootDir, "node_modules", "gsap", "dist"),
    { maxAge: config.isProduction ? "30d" : 0 },
  ),
);
// Client socket.io (temps réel), servi localement.
app.use(
  "/vendor/socket.io",
  express.static(path.join(config.rootDir, "node_modules", "socket.io", "client-dist"), { maxAge: config.isProduction ? "30d" : 0 }),
);
app.use(globalLimiter);
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));
// Cookies : signés avec COOKIE_SECRET pour les messages flash ; jetons de connexion en cookies HttpOnly.
app.use(cookieParser(config.cookieSecret));
app.use(visitorId);
app.use(flash);
app.use(viewLocals); // avant tout middleware pouvant échouer : la page d'erreur en dépend
app.use(layoutMiddleware("layouts/public"));

app.use(authenticate); // jeton d'accès vérifié, renouvelé si besoin avec le jeton de rafraîchissement
app.use(exposeCsrfToken);
app.use(csrfProtection); // vérifie POST/PUT/PATCH/DELETE ; GET/HEAD/OPTIONS ignorés

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
