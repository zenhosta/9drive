-- AlterTable
ALTER TABLE `upload_sessions` ADD COLUMN `drive_path` VARCHAR(1024) NULL;

-- CreateTable
CREATE TABLE `drive_folders` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `connected_account_id` CHAR(36) NOT NULL,
    `provider_folder_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(1024) NOT NULL,
    `scan_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `drive_folders_user_id_idx`(`user_id`),
    INDEX `drive_folders_connected_account_id_scan_id_idx`(`connected_account_id`, `scan_id`),
    UNIQUE INDEX `drive_folders_connected_account_id_provider_folder_id_key`(`connected_account_id`, `provider_folder_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `drive_folders` ADD CONSTRAINT `drive_folders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drive_folders` ADD CONSTRAINT `drive_folders_connected_account_id_fkey` FOREIGN KEY (`connected_account_id`) REFERENCES `connected_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
