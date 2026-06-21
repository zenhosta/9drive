-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" DATETIME,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "upload_routing_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'most_available',
    "priority_account_ids" JSONB NOT NULL,
    "round_robin_cursor" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "upload_routing_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_handoffs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_handoffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "provider" TEXT NOT NULL,
    "client_id_encrypted" TEXT NOT NULL,
    "client_secret_encrypted" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "provider_config_id" TEXT NOT NULL,
    "flow" TEXT NOT NULL DEFAULT 'connect',
    "state_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_states_provider_config_id_fkey" FOREIGN KEY ("provider_config_id") REFERENCES "provider_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider_config_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" DATETIME,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "connected_accounts_provider_config_id_fkey" FOREIGN KEY ("provider_config_id") REFERENCES "provider_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "s3_storage_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "endpoint" TEXT,
    "access_key_id_encrypted" TEXT NOT NULL,
    "secret_access_key_encrypted" TEXT NOT NULL,
    "force_path_style" BOOLEAN NOT NULL DEFAULT false,
    "prefix" TEXT NOT NULL DEFAULT '9drive',
    "quota_bytes" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "s3_storage_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "s3_storage_configs_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "storage_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connected_account_id" TEXT NOT NULL,
    "total_bytes" BIGINT,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "available_bytes" BIGINT,
    "trash_bytes" BIGINT,
    "last_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "storage_accounts_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_file_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "files_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "file_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT,
    "token_hash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "file_shares_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "file_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "file_preview_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_preview_tokens_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "file_preview_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "connected_account_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'google_drive',
    "provider_folder_id" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'text-blue-500',
    "icon_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "folders_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "target_connected_account_id" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "upload_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "upload_sessions_target_connected_account_id_fkey" FOREIGN KEY ("target_connected_account_id") REFERENCES "connected_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviter_id" TEXT NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "target_type" TEXT NOT NULL DEFAULT 'file',
    "target_id" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "revoked_at" DATETIME,
    "accepted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "api_keys_user_id_status_created_at_idx" ON "api_keys"("user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "upload_routing_policies_user_id_key" ON "upload_routing_policies"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_refresh_token_hash_idx" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_handoffs_token_hash_key" ON "auth_handoffs"("token_hash");

-- CreateIndex
CREATE INDEX "auth_handoffs_user_id_idx" ON "auth_handoffs"("user_id");

-- CreateIndex
CREATE INDEX "provider_configs_user_id_idx" ON "provider_configs"("user_id");

-- CreateIndex
CREATE INDEX "provider_configs_provider_idx" ON "provider_configs"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "oauth_states_user_id_idx" ON "oauth_states"("user_id");

-- CreateIndex
CREATE INDEX "connected_accounts_user_id_idx" ON "connected_accounts"("user_id");

-- CreateIndex
CREATE INDEX "connected_accounts_user_id_status_created_at_idx" ON "connected_accounts"("user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_user_id_provider_provider_account_id_key" ON "connected_accounts"("user_id", "provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "s3_storage_configs_connected_account_id_key" ON "s3_storage_configs"("connected_account_id");

-- CreateIndex
CREATE INDEX "s3_storage_configs_user_id_idx" ON "s3_storage_configs"("user_id");

-- CreateIndex
CREATE INDEX "s3_storage_configs_user_id_status_idx" ON "s3_storage_configs"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "storage_accounts_connected_account_id_key" ON "storage_accounts"("connected_account_id");

-- CreateIndex
CREATE INDEX "files_user_id_idx" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "files_user_id_status_created_at_idx" ON "files"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "files_user_id_status_folder_id_created_at_idx" ON "files"("user_id", "status", "folder_id", "created_at");

-- CreateIndex
CREATE INDEX "files_connected_account_id_idx" ON "files"("connected_account_id");

-- CreateIndex
CREATE INDEX "files_folder_id_idx" ON "files"("folder_id");

-- CreateIndex
CREATE INDEX "files_provider_file_id_idx" ON "files"("provider_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_shares_token_key" ON "file_shares"("token");

-- CreateIndex
CREATE UNIQUE INDEX "file_shares_token_hash_key" ON "file_shares"("token_hash");

-- CreateIndex
CREATE INDEX "file_shares_file_id_idx" ON "file_shares"("file_id");

-- CreateIndex
CREATE INDEX "file_shares_user_id_idx" ON "file_shares"("user_id");

-- CreateIndex
CREATE INDEX "file_shares_user_id_enabled_created_at_idx" ON "file_shares"("user_id", "enabled", "created_at");

-- CreateIndex
CREATE INDEX "file_shares_file_id_user_id_enabled_created_at_idx" ON "file_shares"("file_id", "user_id", "enabled", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_preview_tokens_token_hash_key" ON "file_preview_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "file_preview_tokens_file_id_idx" ON "file_preview_tokens"("file_id");

-- CreateIndex
CREATE INDEX "file_preview_tokens_user_id_idx" ON "file_preview_tokens"("user_id");

-- CreateIndex
CREATE INDEX "folders_user_id_idx" ON "folders"("user_id");

-- CreateIndex
CREATE INDEX "folders_user_id_deleted_at_updated_at_idx" ON "folders"("user_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "folders_user_id_deleted_at_parent_id_updated_at_idx" ON "folders"("user_id", "deleted_at", "parent_id", "updated_at");

-- CreateIndex
CREATE INDEX "folders_parent_id_idx" ON "folders"("parent_id");

-- CreateIndex
CREATE INDEX "folders_connected_account_id_idx" ON "folders"("connected_account_id");

-- CreateIndex
CREATE INDEX "upload_sessions_user_id_idx" ON "upload_sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "workspace_invites_invitee_email_idx" ON "workspace_invites"("invitee_email");

-- CreateIndex
CREATE INDEX "workspace_invites_target_type_target_id_idx" ON "workspace_invites"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_target_unique" ON "workspace_invites"("inviter_id", "invitee_email", "target_type", "target_id");
