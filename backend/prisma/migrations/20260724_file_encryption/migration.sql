-- AlterTable: Add encryption fields to files table
ALTER TABLE `files` ADD COLUMN `is_encrypted` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `files` ADD COLUMN `encryption_version` INTEGER NULL;
ALTER TABLE `files` ADD COLUMN `encrypted_dek` TEXT NULL;
ALTER TABLE `files` ADD COLUMN `dek_iv` VARCHAR(32) NULL;
ALTER TABLE `files` ADD COLUMN `dek_auth_tag` VARCHAR(32) NULL;
ALTER TABLE `files` ADD COLUMN `file_nonce` VARCHAR(32) NULL;
ALTER TABLE `files` ADD COLUMN `plaintext_size` BIGINT NULL;

-- AlterTable: Add encryption_enabled flag to users table
ALTER TABLE `users` ADD COLUMN `encryption_enabled` BOOLEAN NOT NULL DEFAULT false;
