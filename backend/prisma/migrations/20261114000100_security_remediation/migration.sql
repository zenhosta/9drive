ALTER TABLE `users` ADD COLUMN `role` VARCHAR(32) NOT NULL DEFAULT 'user';

CREATE TABLE `refresh_tokens` (
  `id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `refresh_tokens_token_hash_key` (`token_hash`),
  INDEX `refresh_tokens_session_id_used_at_idx` (`session_id`, `used_at`),
  CONSTRAINT `refresh_tokens_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `user_sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;