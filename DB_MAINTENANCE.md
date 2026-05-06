# LeadHunt Database Maintenance

This project currently keeps the application code on the local Windows machine and runs PostgreSQL / Redis on the remote development server.

The maintenance entry point is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/db-maintenance.ps1 -Mode status
```

## Safe Checks

Check Prisma migration status against the remote PostgreSQL database:

```powershell
pnpm db:status
```

Apply pending migrations and regenerate Prisma Client:

```powershell
pnpm db:migrate
```

## Backup

Create a SQL backup from the remote PostgreSQL container:

```powershell
pnpm db:backup
```

By default, backups are written to `runtime/backups/leadhunt-YYYYMMDD-HHMMSS.sql`.

To choose a path:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/db-maintenance.ps1 -Mode backup -BackupPath runtime/backups/manual.sql
```

## Restore

Restore is destructive and requires `-Force`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/db-maintenance.ps1 -Mode restore -BackupPath runtime/backups/manual.sql -Force
```

After restore, the script runs `prisma migrate status` so the schema state is visible.

## Rebuild

Rebuild drops and recreates the remote PostgreSQL `public` schema, then runs Prisma migrations and generates Prisma Client.

The script requires `-Force` and creates a backup first unless `-SkipBackup` is passed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/db-maintenance.ps1 -Mode rebuild -Force
```

Use `-SkipBackup` only for disposable development data:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/db-maintenance.ps1 -Mode rebuild -Force -SkipBackup
```

## Remote Host

The default remote target is the current development server. To override it:

```powershell
$env:LEADHUNT_DB_REMOTE = "root@your-server"
pnpm db:status
```

This document intentionally does not include database passwords, Redis passwords, API keys, or OAuth secrets.
