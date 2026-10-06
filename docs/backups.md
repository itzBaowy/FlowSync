# Backup and restore operations

The repository includes a local PostgreSQL backup tool for the Compose development stack. Run from the repository root with PostgreSQL running and `.env` configured:

```powershell
npm run backup:database
```

It streams a [PostgreSQL custom archive](https://www.postgresql.org/docs/17/app-pgdump.html) directly to `.local/backups/<random-id>/database.dump`, avoiding PowerShell text redirection of binary data. An exported repeatable-read snapshot is shared by pg_dump and the verification manifest, so concurrent writes do not make the expected table contents inconsistent. The manifest records archive SHA-256, byte length, row counts and deterministic table fingerprints. No row values or credentials are printed.

The tool accepts only the local loopback PostgreSQL connection matching Compose's database/port and PostgreSQL 17. Verification is bounded to 100 public tables and 100,000 rows/table; large production datasets should use managed backup/PITR and dedicated restore infrastructure. Credentials are read inside the PostgreSQL container rather than added to command arguments. Failed/incomplete backups have no completed manifest and must not be used.

Backups contain sensitive user data, password hashes and pending encrypted invitations. The folder is ignored by Git. POSIX modes request owner-only access; on Windows, restrict NTFS permissions separately. Move completed archives to access-controlled encrypted off-host storage. Do not upload backups as public CI artifacts. This database dump excludes S3 object bodies, Redis state, role definitions and server secrets; it is not a complete disaster recovery solution by itself.

For production, establish measured RPO/RTO, daily encrypted database backups plus PITR where available, object versioning/retention, off-host key storage and scheduled restore rehearsals. Preserve encryption/signing configuration securely; restoring a database without the invitation encryption key cannot recover pending encrypted delivery payloads. Isolate restored instances from SMTP/provider workers until reconciliation is complete to prevent duplicate delivery.
