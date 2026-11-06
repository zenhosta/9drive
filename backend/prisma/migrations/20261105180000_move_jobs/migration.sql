-- CreateTable
CREATE TABLE `move_jobs` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT 'move',
    `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
    `options` JSON NOT NULL,
    `total_items` INTEGER NOT NULL DEFAULT 0,
    `done_items` INTEGER NOT NULL DEFAULT 0,
    `failed_items` INTEGER NOT NULL DEFAULT 0,
    `skipped_items` INTEGER NOT NULL DEFAULT 0,
    `total_bytes` BIGINT NOT NULL DEFAULT 0,
    `moved_bytes` BIGINT NOT NULL DEFAULT 0,
    `cancel_requested` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `move_jobs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `move_jobs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `move_job_items` (
    `id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `source_account_id` CHAR(36) NOT NULL,
    `target_account_id` CHAR(36) NOT NULL,
    `source_provider_file_id` VARCHAR(191) NOT NULL,
    `target_provider_file_id` VARCHAR(191) NULL,
    `bytes` BIGINT NOT NULL DEFAULT 0,
    `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
    `step` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `move_job_items_job_id_idx`(`job_id`),
    INDEX `move_job_items_status_created_at_idx`(`status`, `created_at`),
    INDEX `move_job_items_file_id_idx`(`file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `move_jobs` ADD CONSTRAINT `move_jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `move_job_items` ADD CONSTRAINT `move_job_items_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `move_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

