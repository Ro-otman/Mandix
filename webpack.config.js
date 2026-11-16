/**
 * Construction des fichiers front pour la production : `npm run build`.
 *
 * - Chaque feuille de style (public/css/*.css) et chaque script (public/js/*.js) reste un fichier distinct,
 *   chargé dans le même ordre qu'avant : la cascade CSS et l'ordre des scripts ne changent pas.
 * - Minification : CSS par cssnano (préréglage sûr), JavaScript par Terser.
 * - Nom avec empreinte de contenu (ex. app.3f2a1c9d.js) : mis en cache un an par les navigateurs ; un fichier
 *   modifié change de nom, donc jamais de version périmée.
 * - public/dist/manifest.json relie « js/app.js » au fichier construit ; utils/assets.js s'en sert dans les vues.
 * - Les url(/images/…) des feuilles de style restent des chemins absolus (aucune image recopiée).
 * - Pré-compression : une copie .br (Brotli, niveau maximal) et .gz de chaque fichier, servie telle quelle par
 *   le serveur (express-static-gzip) : aucune compression à la volée pour ces fichiers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import CssMinimizerPlugin from "css-minimizer-webpack-plugin";
import TerserPlugin from "terser-webpack-plugin";
import RemoveEmptyScriptsPlugin from "webpack-remove-empty-scripts";
import { WebpackManifestPlugin } from "webpack-manifest-plugin";
import CompressionPlugin from "compression-webpack-plugin";
import zlib from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = (dir, ext) =>
  fs.readdirSync(path.join(root, "public", dir))
    .filter((file) => file.endsWith(ext))
    .sort();

// Une entrée par fichier : « js/app » -> public/js/app.js, « css/main » -> public/css/main.css
const entry = {};
for (const file of source("js", ".js")) entry[`js/${path.basename(file, ".js")}`] = `./public/js/${file}`;
for (const file of source("css", ".css")) entry[`css/${path.basename(file, ".css")}`] = `./public/css/${file}`;

export default {
  mode: "production",
  context: root,
  entry,
  output: {
    path: path.join(root, "public", "dist"),
    publicPath: "/dist/",
    filename: "[name].[contenthash:8].js",
    clean: true,
    iife: true,
  },
  devtool: false,
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, { loader: "css-loader", options: { url: false, import: false } }],
      },
    ],
  },
  plugins: [
    new RemoveEmptyScriptsPlugin(),
    new MiniCssExtractPlugin({ filename: "[name].[contenthash:8].css" }),
    new WebpackManifestPlugin({ fileName: "manifest.json", publicPath: "/dist/" }),
    new CompressionPlugin({ filename: "[path][base].br", algorithm: "brotliCompress", test: /\.(js|css)$/, compressionOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }, threshold: 1024, minRatio: 0.9 }),
    new CompressionPlugin({ filename: "[path][base].gz", algorithm: "gzip", test: /\.(js|css)$/, compressionOptions: { level: 9 }, threshold: 1024, minRatio: 0.9 }),
  ],
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({ extractComments: false, terserOptions: { format: { comments: false } } }),
      new CssMinimizerPlugin({ minimizerOptions: { preset: ["default", { discardComments: { removeAll: true } }] } }),
    ],
    // Scripts indépendants (aucun import) : pas de code d'exécution webpack partagé ni de découpage.
    runtimeChunk: false,
    splitChunks: false,
  },
  performance: { hints: false },
  stats: "summary",
};
