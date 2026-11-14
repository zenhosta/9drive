# Backup and Recovery

Backups use `mysqldump --single-transaction --routines --events` and are downloaded as SQL files. The endpoint is administrator-only and writes the dump to a temporary directory that is removed after download.

Restore is administrator-only and requires the request header:

```text
x-restore-confirm: RESTORE-9DRIVE
```

The uploaded file must contain a MySQL dump header. Restore is destructive: stop active application traffic, verify the target database and backup provenance, and take a fresh backup before restoring.

For host-level recovery, prefer the MySQL client directly:

```bash
mysqldump --single-transaction --routines --events -h HOST -u USER -p DATABASE > backup.sql
mysql -h HOST -u USER -p DATABASE < backup.sql
```

After recovery, run the deployed Prisma migrations and verify login, connected-account metadata, file metadata, and application health. Provider objects are not included in the database backup.