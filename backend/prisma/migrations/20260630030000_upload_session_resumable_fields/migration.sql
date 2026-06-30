ALTER TABLE `upload_sessions`
  ADD COLUMN `folder_id` CHAR(36) NULL,
  ADD COLUMN `google_session_uri` TEXT NULL;

CREATE INDEX `upload_sessions_folder_id_idx` ON `upload_sessions`(`folder_id`);

ALTER TABLE `upload_sessions`
  ADD CONSTRAINT `upload_sessions_folder_id_fkey`
  FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
