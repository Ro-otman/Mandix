-- =============================================================================
-- Migration 008 : authentification par jetons (jeton d'accès + jeton de rafraîchissement)
-- Remplace les sessions serveur (express-session, table `sessions`) par :
--   * auth_sessions        : une session par appareil connecté (révocable à tout moment) ;
--   * auth_refresh_tokens  : jetons de rafraîchissement hachés, renouvelés à chaque usage.
-- À appliquer sur une base déjà au schéma v2 (migrations 002 à 007). Idempotente.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(36)        NOT NULL COMMENT 'Identifiant porté par le jeton d''accès (sid)',
  user_id         BIGINT UNSIGNED NOT NULL,
  remember        TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '« Rester connecté » : 30 jours, sinon 12 heures',
  user_agent      VARCHAR(255)    NULL,
  ip_address      VARCHAR(45)     NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME        NOT NULL COMMENT 'Fin absolue : aucun renouvellement au-delà',
  revoked_at      DATETIME        NULL,
  revoked_reason  ENUM('logout','logout_all','password_reset','reuse_detected','account_suspended') NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_public_id (public_id),
  KEY idx_auth_sessions_user (user_id, revoked_at),
  KEY idx_auth_sessions_expires (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id   BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64)        NOT NULL COMMENT 'SHA-256 du jeton envoyé dans le cookie',
  expires_at   DATETIME        NOT NULL,
  rotated_at   DATETIME        NULL COMMENT 'Renseigné quand le jeton a été remplacé par un nouveau',
  replaced_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_refresh_tokens_hash (token_hash),
  KEY idx_auth_refresh_tokens_session (session_id),
  KEY idx_auth_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_auth_refresh_tokens_session FOREIGN KEY (session_id) REFERENCES auth_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les sessions serveur ne sont plus utilisées.
DROP TABLE IF EXISTS sessions;
