# Production operations runbook

## Release prerequisites

- Use unique 24+ character values for `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` in a regular non-symlink `.env.local` owned by the deployment user with mode `0600` (or `0400`); never commit it.
- Set an immutable `IMAGE_TAG` (commit SHA or release number), `SITE_DOMAIN`, `VITE_SITE_URL` and `PUBLIC_ORIGINS`.
- Set `RELEASE_COMMIT` to the full SHA of the exact clean checkout whose required CI jobs are green. The locked build uses an immutable `git archive` of that commit and writes a mode-`0600` manifest under `OPERATIONS_LOCK_ROOT` containing the commit, public site URL, selected Compose checksum and every topology image ID. Copy the SHA-256 printed by the build into protected release metadata as `RELEASE_MANIFEST_SHA256`; deploy and image-backed maintenance refuse a dirty/different checkout, URL/config drift, a changed manifest, a mismatched revision label or a different local image ID.
- Keep PostgreSQL and uploads backups encrypted off-host. Target RPO: 24 hours; target RTO: 2 hours.
- Install the util-linux `flock` command and export `OPERATIONS_LOCK_ROOT` as one stable host-global directory shared by every release checkout and restore bundle (for example `/var/lib/camping-drive/locks`). Provision it once with `sudo install -d -o <deploy-user> -g <deploy-group> -m 0700 /var/lib/camping-drive/locks`, then run every operation as that same deployment user. Backup, verification, restore, build, deploy and maintenance use one kernel lock per Compose project; a killed process releases it automatically.
- Use a dedicated PostgreSQL cluster for this application. Provisioning intentionally hardens only the configured application database and never mutates ACLs of unrelated databases; enforce cross-database isolation with separate clusters or `pg_hba.conf`.
- Test migrations and restore against a production clone before every schema-changing release.
- Keep the previous immutable frontend/backend images and the pre-release backup until the release is accepted.

## Deployment

1. Require green `verify` and `container-scan` jobs for the exact `RELEASE_COMMIT`. The release record must include that CI run URL/SHA and all final image IDs (four for managed edge, three for external edge). A manual fallback must run `npm ci`, lint/contracts/coverage/stage9, both root and `server` high-severity audits, container scans and both DR variants.
2. Create and verify a coordinated backup. Managed edge:
   `sh scripts/backup.sh /absolute/off-host-staging/backups`. External edge, only after the external proxy/writers are disabled:
   `COMPOSE_FILE=compose.app-only.yaml BACKUP_TRAFFIC_DISABLED=yes sh scripts/backup.sh /absolute/off-host-staging/backups`.
   Verify with the same exported `OPERATIONS_LOCK_ROOT`: `sh scripts/verify-backup.sh <backup>`.
3. From the clean `RELEASE_COMMIT` checkout, build immutable images together under the project lock: `sh scripts/compose-mutation.sh build`. Frontend and backend are targets of the same Dockerfile and share one content-hashed frontend build stage; never build or retag production image references outside this locked action. Record the printed manifest path/SHA-256, independently confirm that CI is green for the printed commit, and set the exact printed value as `RELEASE_MANIFEST_SHA256`.
4. Rehearse `sh scripts/compose-mutation.sh migrate` on a restored production clone. The migration service stops if preserved legacy site settings do not match the current schema; migrate them explicitly instead of accepting a reset.
5. Deploy with `sh scripts/compose-mutation.sh deploy`. This wrapper takes the same kernel lock as backup/restore and verifies the clean commit, approved manifest hash, Compose checksum, embedded OCI revision labels and local image IDs before it mutates the stack; do not run direct mutating Compose commands. The one-shot `migrate` service uses the owner account; the long-running backend receives only the restricted runtime account.
   The one-shot `caddy-volume-init` service idempotently migrates legacy root-owned Caddy volumes to UID/GID 10001 before the non-root proxy starts; Caddy's healthcheck then verifies that the proxy actually started with the migrated state.
6. Verify `/healthz`, `/api/health/ready`, `/`, `/news`, one published article, `/admin`, login/logout, an image upload/delete and raw HTML metadata with `curl`.
7. Monitor 4xx/5xx, latency, container restarts, disk space, PostgreSQL connections and pending `image_deletion_queue` rows for at least 30 minutes.

## Backup policy

Run backup daily and before every release inside the declared maintenance window. The coordinated snapshot first removes public traffic (managed Caddy, or an externally confirmed maintenance state), gracefully drains/stops the backend for the complete database/uploads/Caddy snapshot, restarts the healthy backend, and starts managed traffic last. It refuses concurrent writers and acquires the project operations lock. The backup records the exact managed/external topology and Docker OS/architecture and refuses a mismatched manifest or restore host. It contains a custom-format PostgreSQL dump, matching uploads, roles/ACLs, locale/encoding, Caddy state, immutable images, cold-host bundle, manifests, sizes, fingerprints and SHA-256 checksums. Retain daily backups for 14 days, weekly backups for 8 weeks and monthly backups for 12 months. Copy backups to encrypted, access-controlled and immutable off-host storage and alert on a missed or failed job; checksums detect corruption but are not a cryptographic signature against a malicious rewrite.

For every release/backup, escrow the protected environment/config separately in an encrypted, versioned secrets manager or off-host vault with tested break-glass access. Never put plaintext secrets inside the backup archive. A cold-host drill must start from the backup plus an independently retrieved escrow version; losing the original credentials makes the image/data bundle alone insufficient.

At least monthly, restore the newest backup onto an empty isolated VM with the same Docker OS/architecture, retrieve its independently escrowed config, run `sh scripts/verify-backup.sh`, start the application, and verify record counts, administrator login, public pages and several original/variant images. The same-daemon cold-tag simulation in CI is useful but is not this empty-VM drill.

## Restore

Only restore during an approved maintenance window. Confirm the exact backup path and target project, then run:

```sh
RESTORE_CONFIRM=restore-production \
RESTORE_TRAFFIC_DISABLED=yes \
RESTORE_MODE=exact \
sh scripts/restore.sh /absolute/path/to/backup
```

`exact` automatically selects the immutable image tag recorded in the backup, verifies the Docker/proxy bundle fingerprint and never applies newer migrations. Missing exact images are loaded from the backup archive. Cold recovery requires the bundle, independently escrowed `.env.local`, a same-OS/architecture Docker host, util-linux `flock`, and a deployment-user-owned `OPERATIONS_LOCK_ROOT`. Use `RESTORE_MODE=forward IMAGE_TAG=<target-release>` only for an explicit forward-recovery operation. Before destructive changes, the script verifies backup, topology, platform and target identity, acquires the same project lock, confirms image digests and free-space headroom. It stops all writers, creates the replacement database with connection limit zero and no PUBLIC CONNECT, restores roles/data/media, clears restored admin sessions/throttles, and returns exact ACL/connection limits only immediately before application startup. Caddy remains stopped for validation. Compose-project, database-name and owner remapping are intentionally unsupported. `RESTORE_TARGET_OVERRIDE=restore-backup-to-different-target` can only acknowledge an explicitly reviewed configuration/fingerprint difference inside the same project and identities.

After the smoke checks pass, resume managed traffic with `sh scripts/compose-mutation.sh start-traffic`; it holds the operations lock and waits for the Caddy healthcheck. In the app-only topology, resume the external proxy through its own mutually exclusive maintenance runbook.

After the restore has passed smoke checks and the retention window has elapsed, remove the
specific retained `/app/uploads/previous-<timestamp>` directory during a separate approved
maintenance action. Never delete it before application and media validation.

## Rollback

- Application-only regression: set `IMAGE_TAG`, `RELEASE_COMMIT` and `RELEASE_MANIFEST_SHA256` to the previous approved immutable release and run `sh scripts/compose-mutation.sh deploy`. Do not use `latest`.
- Schema/data regression: stop public traffic and application writers, restore the coordinated pre-release backup, then start the previous image tag. Forward-only migrations are not reversed in place.
- Keep an incident timeline, preserve logs and the failed release images, and rotate credentials if compromise is suspected.

## Incident checks

- `/healthz` is aggregate readiness: it must fail when PostgreSQL, uploads or the backend is unavailable.
- A growing `image_deletion_queue` or high `attempts` means file cleanup is failing; fix storage permissions/capacity and let the 30-second worker retry with backoff.
- Repeated `429` responses on login indicate edge or database-backed authentication throttling. Investigate before relaxing limits.
- Restore service only after free disk space, PostgreSQL readiness, uploads write access and raw server-rendered metadata have been confirmed.
