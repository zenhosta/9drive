-- AlterTable
ALTER TABLE `move_job_items` ADD COLUMN `drive_item_id` CHAR(36) NULL,
    MODIFY `file_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `drive_items` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `connected_account_id` CHAR(36) NOT NULL,
    `provider_file_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `md5` VARCHAR(64) NULL,
    `path` VARCHAR(1024) NOT NULL,
    `modified_at` DATETIME(3) NULL,
    `scan_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `drive_items_user_id_mime_type_idx`(`user_id`, `mime_type`),
    INDEX `drive_items_user_id_size_bytes_idx`(`user_id`, `size_bytes`),
    INDEX `drive_items_connected_account_id_size_bytes_idx`(`connected_account_id`, `size_bytes`),
    INDEX `drive_items_connected_account_id_scan_id_idx`(`connected_account_id`, `scan_id`),
    UNIQUE INDEX `drive_items_connected_account_id_provider_file_id_key`(`connected_account_id`, `provider_file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drive_scans` (
    `id` CHAR(36) NOT NULL,
    `connected_account_id` CHAR(36) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'idle',
    `scan_id` CHAR(36) NULL,
    `items_found` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `drive_scans_connected_account_id_key`(`connected_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `move_job_items_drive_item_id_idx` ON `move_job_items`(`drive_item_id`);

-- AddForeignKey
ALTER TABLE `drive_items` ADD CONSTRAINT `drive_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drive_items` ADD CONSTRAINT `drive_items_connected_account_id_fkey` FOREIGN KEY (`connected_account_id`) REFERENCES `connected_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drive_scans` ADD CONSTRAINT `drive_scans_connected_account_id_fkey` FOREIGN KEY (`connected_account_id`) REFERENCES `connected_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

