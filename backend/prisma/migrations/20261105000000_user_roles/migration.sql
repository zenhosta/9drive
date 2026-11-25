-- AlterTable
ALTER TABLE `users` ADD COLUMN `role` VARCHAR(32) NOT NULL DEFAULT 'user';

-- Promote the oldest account on existing installs so the instance keeps an administrator.
UPDATE `users`
SET `role` = 'admin'
WHERE `id` = (
  SELECT `id` FROM (SELECT `id` FROM `users` ORDER BY `created_at` ASC LIMIT 1) AS `first_user`
);
