-- CreateIndex
CREATE INDEX `files_user_id_status_mime_type_idx` ON `files`(`user_id`, `status`, `mime_type`);
