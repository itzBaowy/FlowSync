# Backup and restore operations

The repository includes a local PostgreSQL backup tool for the Compose development stack. Run from the repository root with PostgreSQL running and `.env` configured:

```powershell
npm run backup:database
npm run verify:backup -- .local/backups/<backup-id>
# With no directory, create and verify a fresh backup:
npm run verify:backup
```

It streams a [PostgreSQL custom archive](https://www.postgresql.org/docs/17/app-pgdump.html) directly to `.local/backups/<random-id>/database.dump`, avoiding PowerShell text redirection of binary data. An exported repeatable-read snapshot is shared by pg_dump and the verification manifest, so concurrent writes do not make the expected table contents inconsistent. The manifest records archive SHA-256, byte length, row counts and deterministic table fingerprints. No row values or credentials are printed.

The tool accepts only the local loopback PostgreSQL connection matching Compose's database/port and PostgreSQL 17. Verification is bounded to 100 public tables and 100,000 rows/table; large production datasets should use managed backup/PITR and dedicated restore infrastructure. Credentials are read inside the PostgreSQL container rather than added to command arguments. Failed/incomplete backups have no completed manifest and must not be used.

Restore verification rejects paths outside the backup directory, unexpected manifests and mismatched hashes before touching PostgreSQL. It restores with [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) into a newly generated `flowsync_restore_<random>` database, checks every public table's row count/content fingerprint, validated constraints and applied migration history, then drops only that temporary database. The live application database is never a restore target. A JSON report is written after successful cleanup. Restores require database-create privileges. Only restore trusted archives: PostgreSQL backups can contain executable SQL; a checksum detects accidental corruption, not malicious replacement of both archive and manifest.

CI runs a fresh backup/restore rehearsal after HTTP integration tests. Its database/object fixtures are disposable and backup files are not uploaded as artifacts. Local rehearsal on 06/10/2026 verified all 31 tables including migration history. This verifies PostgreSQL recovery; storage object recovery is a separate operation.

Backups contain sensitive user data, password hashes and pending encrypted invitations. The folder is ignored by Git. POSIX modes request owner-only access; on Windows, restrict NTFS permissions separately. Move completed archives to access-controlled encrypted off-host storage. Do not upload backups as public CI artifacts. This database dump excludes S3 object bodies, Redis state, role definitions and server secrets; it is not a complete disaster recovery solution by itself.

For production, establish measured RPO/RTO, daily encrypted database backups plus PITR where available, object versioning/retention, off-host key storage and scheduled restore rehearsals. Preserve encryption/signing configuration securely; restoring a database without the invitation encryption key cannot recover pending encrypted delivery payloads. Isolate restored instances from SMTP/provider workers until reconciliation is complete to prevent duplicate delivery.
