CREATE TABLE `cloudinary_configs` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `connected_account_id` CHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `cloud_name` VARCHAR(191) NOT NULL,
  `api_key_encrypted` TEXT NOT NULL,
  `api_secret_encrypted` TEXT NOT NULL,
  `folder` VARCHAR(191) NOT NULL DEFAULT 'multinary',
  `quota_bytes` BIGINT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `cloudinary_configs_connected_account_id_key` ON `cloudinary_configs`(`connected_account_id`);
CREATE INDEX `cloudinary_configs_user_id_idx` ON `cloudinary_configs`(`user_id`);
CREATE INDEX `cloudinary_configs_user_id_status_idx` ON `cloudinary_configs`(`user_id`, `status`);

ALTER TABLE `cloudinary_configs` ADD CONSTRAINT `cloudinary_configs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `cloudinary_configs` ADD CONSTRAINT `cloudinary_configs_connected_account_id_fkey` FOREIGN KEY (`connected_account_id`) REFERENCES `connected_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
