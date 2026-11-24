CREATE TABLE `storage_rebalance_jobs` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `plan` JSON NOT NULL,
  `pause_requested` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `storage_rebalance_jobs_user_id_key` (`user_id`),
  INDEX `storage_rebalance_jobs_status_idx` (`status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `storage_rebalance_jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;