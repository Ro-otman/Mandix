-- =============================================================================
-- Migration 015 : contenu des fichiers joints (photos, PDF) enregistré dans la base. MySQL 8 et MariaDB.
--
-- Hébergement : le dossier de l'application est recréé à chaque déploiement ; les fichiers écrits sur le disque
-- (storage/private) disparaissaient, et les photos du chat ne s'affichaient plus. Le contenu, toujours chiffré
-- par l'application (AES-256-GCM), est désormais conservé ici. Effacé avec les messages (10 jours après la
-- clôture de la transaction).
-- =============================================================================

CREATE TABLE IF NOT EXISTS attachment_blobs (
  storage_key  VARCHAR(100) NOT NULL COMMENT 'Même clé que attachments.storage_key',
  content      MEDIUMBLOB   NOT NULL COMMENT 'Contenu chiffré (5 Mo au plus avant chiffrement)',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (storage_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
