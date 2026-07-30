#!/bin/sh
set -eu

umask 077

backup_root=${1:?Usage: scripts/backup.sh /absolute/backup/directory}
case "$backup_root" in
  /*) ;;
  *) echo "Backup directory must be absolute" >&2; exit 2 ;;
esac

env_file=${ENV_FILE:-.env.local}
compose_file=${COMPOSE_FILE:-compose.yaml}

case "$env_file" in
  /*) env_file_candidate=$env_file ;;
  *) env_file_candidate="$(pwd -P)/$env_file" ;;
esac
test -e "$env_file_candidate" || {
  echo "Environment file does not exist: $env_file_candidate" >&2
  exit 2
}
test ! -L "$env_file_candidate" && test -f "$env_file_candidate" || {
  echo "Environment file must be a regular non-symlink file" >&2
  exit 1
}
env_file_directory=$(CDPATH= cd -- "$(dirname "$env_file_candidate")" && pwd -P)
env_file="$env_file_directory/$(basename "$env_file_candidate")"
env_file_mode=$(stat -c %a "$env_file")
test "$(stat -c %u "$env_file")" = "$(id -u)" || {
  echo "Environment file must be owned by the deployment user" >&2
  exit 1
}
case "$env_file_mode" in
  400|600) ;;
  *) echo "Environment file mode must be 0600 (or stricter 0400)" >&2; exit 1 ;;
esac

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

calculate_ops_bundle_sha256() {
  compose_directory=$(CDPATH= cd -- "$(dirname "$compose_file")" && pwd)
  compose_filename=$(basename "$compose_file")
  {
    sha256sum "$compose_directory/$compose_filename" | awk '{print $1 "  compose.yaml"}'
    sha256sum "$compose_directory/Dockerfile" | awk '{print $1 "  Dockerfile"}'
    find "$compose_directory/docker" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
      relative=${file#"$compose_directory/"}
      sha256sum "$file" | awk -v relative="$relative" '{print $1 "  " relative}'
    done
    for script in compose-mutation.sh restore.sh verify-backup.sh; do
      sha256sum "$compose_directory/scripts/$script" | awk -v relative="scripts/$script" '{print $1 "  " relative}'
    done
  } | sha256sum | awk '{print $1}'
}

project_name=$(compose config | sed -n 's/^name: //p' | head -n 1)
case "$project_name" in
  ""|*[!A-Za-z0-9_-]*) echo "Cannot determine a safe Compose project name" >&2; exit 1 ;;
esac
lock_base_directory=$(CDPATH= cd -- "$(dirname "$compose_file")" && pwd)
operations_lock_root=${OPERATIONS_LOCK_ROOT:?Set OPERATIONS_LOCK_ROOT to one stable private host directory shared by every release checkout}
case "$operations_lock_root" in
  /*) ;;
  *) echo "OPERATIONS_LOCK_ROOT must be absolute" >&2; exit 2 ;;
esac
case "$operations_lock_root" in
  /|/tmp|/run|/run/lock|"$lock_base_directory")
    echo "OPERATIONS_LOCK_ROOT must be a dedicated private subdirectory" >&2
    exit 1
    ;;
esac
test ! -L "$operations_lock_root" || {
  echo "OPERATIONS_LOCK_ROOT must not be a symbolic link" >&2
  exit 1
}
if [ ! -e "$operations_lock_root" ]; then
  (umask 077 && mkdir "$operations_lock_root")
fi
test "$(stat -c %u "$operations_lock_root")" = "$(id -u)" &&
  test "$(stat -c %a "$operations_lock_root")" = 700 || {
    echo "OPERATIONS_LOCK_ROOT must be owned by the deployment user with mode 0700" >&2
    exit 1
  }
command -v flock >/dev/null 2>&1 || {
  echo "The util-linux flock command is required for safe backup/restore locking" >&2
  exit 1
}
operations_lock="$operations_lock_root/camping-drive-$project_name.operations.lock"
if [ -e "$operations_lock" ] && { [ -L "$operations_lock" ] || [ ! -f "$operations_lock" ]; }; then
  echo "The operations lock must be a regular non-symlink file" >&2
  exit 1
fi
operations_lock_held=false
acquire_operations_lock() {
  exec 9>"$operations_lock"
  if ! flock -n 9; then
    echo "Another backup or restore is running for Compose project $project_name" >&2
    exec 9>&-
    return 1
  fi
  operations_lock_held=true
}
release_operations_lock() {
  if [ "$operations_lock_held" = true ]; then
    flock -u 9
    exec 9>&-
    operations_lock_held=false
  fi
}
acquire_operations_lock
trap release_operations_lock EXIT
trap 'exit 130' INT TERM

mkdir -p "$backup_root"
resolved_backup_root=$(CDPATH= cd -- "$backup_root" && pwd -P)
resolved_compose_directory=$(CDPATH= cd -- "$lock_base_directory" && pwd -P)
case "$resolved_backup_root/" in
  "$resolved_compose_directory/"*)
    echo "Backup directory must be outside the Compose/build-context directory" >&2
    exit 1
    ;;
esac
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$backup_root/$timestamp.partial"
final_backup_dir="$backup_root/$timestamp"
test ! -e "$backup_dir" && test ! -e "$final_backup_dir" || {
  echo "Backup target already exists for timestamp $timestamp" >&2
  exit 1
}
mkdir "$backup_dir"

backend_image=$(compose config --images | grep '^camping-drive-backend:' | head -n 1)
test -n "$backend_image" || {
  echo "Cannot determine the immutable backend image from Compose" >&2
  exit 1
}
image_tag=${backend_image#camping-drive-backend:}
case "$image_tag" in
  ""|latest) echo "Backup requires an immutable IMAGE_TAG, not '$image_tag'" >&2; exit 1 ;;
esac

backend_stopped=false
caddy_stopped=false
caddy_was_running=false
backup_images=$(compose config --images | LC_ALL=C sort -u)
docker_platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
case "$docker_platform" in
  ""|*[!A-Za-z0-9_./-]*) echo "Cannot determine a safe Docker OS/architecture" >&2; exit 1 ;;
esac
for image in $backup_images; do
  image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)
  test "$image_platform" = "$docker_platform" || {
    echo "Backup refused: image $image targets '$image_platform', but Docker targets '$docker_platform'" >&2
    exit 1
  }
done
configured_services=$(compose config --services)
for project_container in $(docker ps -q --filter "label=com.docker.compose.project=$project_name"); do
  project_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$project_container")
  printf '%s\n' "$configured_services" | grep -qx "$project_service" || {
    echo "Backup refused: running orphan service '$project_service' belongs to Compose project $project_name" >&2
    exit 1
  }
done
service_is_ready() {
  service=$1
  service_container=$(compose ps -q "$service")
  test -n "$service_container" || return 1
  service_state=$(docker inspect --format \
    '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$service_container" 2>/dev/null || true)
  case "$service_state" in
    true\|healthy|true\|none) return 0 ;;
    *) return 1 ;;
  esac
}
wait_for_service() {
  service=$1
  for _attempt in $(seq 1 60); do
    service_is_ready "$service" && return 0
    sleep 1
  done
  return 1
}
backend_is_writable() {
  backend_container=$(compose ps -q backend)
  test -n "$backend_container" || return 1
  test "$(docker inspect --format '{{.State.Running}} {{.State.Paused}}' "$backend_container")" = "true false"
}
resume_backend_best_effort() {
  if [ "$backend_stopped" = true ]; then
    if compose start backend >/dev/null 2>&1 && wait_for_service backend && backend_is_writable; then
      backend_stopped=false
    else
      echo "CRITICAL: backup cleanup could not confirm that backend restarted healthy" >&2
    fi
  fi
}
resume_caddy_best_effort() {
  if [ "$caddy_stopped" = true ] && [ "$caddy_was_running" = true ]; then
    if compose start caddy >/dev/null 2>&1 && wait_for_service caddy; then
      caddy_stopped=false
    else
      echo "CRITICAL: backup cleanup could not confirm that Caddy restarted healthy" >&2
    fi
  fi
}
cleanup_backup() {
  resume_backend_best_effort
  resume_caddy_best_effort
  release_operations_lock
}
trap cleanup_backup EXIT
trap 'exit 130' INT TERM

compose ps --services --status running | grep -qx backend || {
  echo "The backend service must be running before backup" >&2
  exit 1
}
running_maintenance=$(compose ps --services --status running | grep -E '^(migrate|admin-create|caddy-volume-init)$' || true)
test -z "$running_maintenance" || {
  echo "Backup refused while maintenance writers are running: $running_maintenance" >&2
  exit 1
}
backend_container=$(compose ps -q backend)
container_project_name=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$backend_container")
test "$container_project_name" = "$project_name" || {
  echo "Running backend belongs to project '$container_project_name', expected '$project_name'" >&2
  exit 1
}
configured_deployment_topology=$(compose config | sed -n 's/^[[:space:]]*DEPLOYMENT_TOPOLOGY: //p' | LC_ALL=C sort -u)
case "$configured_deployment_topology" in
  managed-edge|external-edge) ;;
  *) echo "Backup cannot determine one safe deployment topology from Compose" >&2; exit 1 ;;
esac
running_deployment_topology=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$backend_container" |
  sed -n 's/^DEPLOYMENT_TOPOLOGY=//p')
test "$running_deployment_topology" = "$configured_deployment_topology" || {
  echo "Backup refused: running topology '$running_deployment_topology' does not match Compose topology '$configured_deployment_topology'" >&2
  exit 1
}
for service in db backend frontend caddy; do
  printf '%s\n' "$configured_services" | grep -qx "$service" || continue
  compose ps --services --status running | grep -qx "$service" || continue
  case "$service" in
    db) expected_image="camping-drive-postgres:$image_tag" ;;
    backend) expected_image="camping-drive-backend:$image_tag" ;;
    frontend) expected_image="camping-drive-frontend:$image_tag" ;;
    caddy) expected_image="camping-drive-caddy:$image_tag" ;;
  esac
  service_container=$(compose ps -q "$service")
  test -n "$service_container" || {
    echo "Backup cannot identify the running $service container" >&2
    exit 1
  }
  service_identity=$(docker inspect --format \
    '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{.Config.Image}}|{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$service_container")
  expected_image_id=$(docker image inspect --format '{{.Id}}' "$expected_image" 2>/dev/null || true)
  expected_identity="$project_name|$service|$expected_image|$expected_image_id|true|"
  case "$service_identity" in
    "$expected_identity"healthy|"$expected_identity"none) ;;
    *)
      echo "Backup refused: running $service does not match the configured immutable image or is unhealthy" >&2
      exit 1
      ;;
  esac
done
database_name=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT current_database()"')
database_owner=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()"')
case "$database_name" in
  ""|-*|*[!A-Za-z0-9_-]*) echo "Database name is not safe for exact recovery" >&2; exit 1 ;;
esac
test "${#database_name}" -le 63 || {
  echo "Database name exceeds the exact-recovery limit" >&2
  exit 1
}
normalized_database=$(printf '%s' "$database_name" | tr '[:upper:]' '[:lower:]')
case "$normalized_database" in
  postgres|template0|template1) echo "Backup requires a dedicated application database" >&2; exit 1 ;;
esac
case "$database_owner" in
  ""|[0-9]*|*[!A-Za-z0-9_]*) echo "Database owner is not safe for exact recovery" >&2; exit 1 ;;
esac
test "${#database_owner}" -le 63 || {
  echo "Database owner exceeds the PostgreSQL role-name limit" >&2
  exit 1
}
normalized_owner=$(printf '%s' "$database_owner" | tr '[:upper:]' '[:lower:]')
case "$normalized_owner" in
  public|none|pg_*) echo "Database owner uses a reserved PostgreSQL role name" >&2; exit 1 ;;
esac
database_size_bytes=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT pg_database_size(current_database())"')
database_definition=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --field-separator="|" --set=ON_ERROR_STOP=1 \
    --command="SELECT pg_encoding_to_char(database.encoding), database.datcollate, database.datctype, database.datlocprovider, tablespace.spcname, database.datconnlimit FROM pg_database AS database JOIN pg_tablespace AS tablespace ON tablespace.oid = database.dattablespace WHERE database.datname = current_database()"')
IFS='|' read -r database_encoding database_collate database_ctype database_locale_provider database_tablespace database_connection_limit <<EOF
$database_definition
EOF
test "$database_locale_provider" = c || {
  echo "Backup supports exact recovery only for libc-locale databases" >&2
  exit 1
}
test "$database_tablespace" = pg_default || {
  echo "Backup supports exact recovery only for the pg_default database tablespace" >&2
  exit 1
}
case "$database_connection_limit" in
  -1) ;;
  ""|*[!0-9]*) echo "Cannot determine a safe database connection limit" >&2; exit 1 ;;
  *) ;;
esac
compose_config_sha256=$(sha256sum "$compose_file" | awk '{print $1}')
ops_bundle_sha256=$(calculate_ops_bundle_sha256)
effective_compose_sha256=$(compose config --no-path-resolution | sha256sum | awk '{print $1}')

if [ "$configured_deployment_topology" = external-edge ] &&
  [ "${BACKUP_TRAFFIC_DISABLED:-}" != yes ]; then
  echo "External-edge backup requires BACKUP_TRAFFIC_DISABLED=yes after external traffic and writers are disabled" >&2
  exit 2
fi
if printf '%s\n' "$configured_services" | grep -qx caddy; then
  if compose ps --services --status running | grep -qx caddy; then
    caddy_was_running=true
    caddy_stopped=true
    compose stop caddy >/dev/null
    if compose ps --services --status running | grep -qx caddy; then
      echo "Backup refused: managed public traffic could not be stopped" >&2
      exit 1
    fi
  fi
fi

# A graceful stop drains in-flight requests and prevents database or upload
# writers for the complete coordinated snapshot window.
backend_stopped=true
compose stop backend >/dev/null
if compose ps --services --status running | grep -qx backend; then
  echo "Backup refused: backend writers could not be stopped" >&2
  exit 1
fi

compose exec -T db sh -eu -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=9 --no-owner' \
  > "$backup_dir/database.dump"

compose exec -T db sh -eu -c \
  'pg_dumpall --username="$POSTGRES_USER" --globals-only' \
  > "$backup_dir/cluster-globals.raw.sql"
role_values=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT string_agg(format('"'"'(%L)'"'"', rolname), '"'"','"'"' ORDER BY rolname) FROM pg_authid WHERE rolname !~ '"'"'^pg_'"'"'"')
test -n "$role_values" || {
  echo "Cannot create the idempotent database-role restore preamble" >&2
  exit 1
}
{
  printf "SELECT format('CREATE ROLE %%I', role_name) FROM (VALUES %s) AS roles(role_name) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name);\n" "$role_values"
  printf '\\gexec\n'
  sed '/^CREATE ROLE /d' "$backup_dir/cluster-globals.raw.sql"
} > "$backup_dir/cluster-globals.sql"
rm "$backup_dir/cluster-globals.raw.sql"

compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1' \
  > "$backup_dir/cluster-roles.txt" <<'SQL'
SELECT 'ROLE' || chr(9) || rolname || chr(9)
       || rolsuper || chr(9) || rolinherit || chr(9) || rolcreaterole || chr(9)
       || rolcreatedb || chr(9) || rolcanlogin || chr(9) || rolreplication || chr(9)
       || rolconnlimit || chr(9) || rolbypassrls || chr(9) || COALESCE(rolpassword, '')
FROM pg_authid
WHERE rolname !~ '^pg_'
UNION ALL
SELECT 'MEMBER' || chr(9) || parent.rolname || chr(9) || member.rolname || chr(9)
       || membership.admin_option
FROM pg_auth_members AS membership
JOIN pg_roles AS parent ON parent.oid = membership.roleid
JOIN pg_roles AS member ON member.oid = membership.member
WHERE parent.rolname !~ '^pg_' OR member.rolname !~ '^pg_'
ORDER BY 1;
SQL

compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1' \
  > "$backup_dir/database-privileges.sql" <<'SQL'
WITH database_identity AS (
  SELECT oid, datname, datdba, COALESCE(datacl, acldefault('d', datdba)) AS privileges
  FROM pg_database
  WHERE datname = current_database()
),
expanded AS (
  SELECT database_identity.datdba,
         privilege.grantee,
         privilege.privilege_type,
         privilege.is_grantable,
         role.rolname
  FROM database_identity
  CROSS JOIN LATERAL aclexplode(database_identity.privileges) AS privilege
  LEFT JOIN pg_roles AS role ON role.oid = privilege.grantee
  WHERE privilege.grantee <> database_identity.datdba
),
statements AS (
  SELECT 0 AS priority, 'REVOKE ALL PRIVILEGES ON DATABASE :"target_database" FROM PUBLIC;' AS statement
  UNION ALL
  SELECT 1, format('REVOKE ALL PRIVILEGES ON DATABASE :"target_database" FROM %I;', rolname)
  FROM expanded
  WHERE grantee <> 0
  GROUP BY rolname
  UNION ALL
  SELECT 2, format(
    'GRANT %s ON DATABASE :"target_database" TO %s%s;',
    privilege_type,
    CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE format('%I', rolname) END,
    CASE WHEN is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
  )
  FROM expanded
)
SELECT statement
FROM statements
ORDER BY priority, statement;
SQL

compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1' \
  > "$backup_dir/schema-migrations.txt" <<'SQL'
SELECT name || ' ' || checksum
FROM schema_migrations
ORDER BY name;
SQL

compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1' \
  > "$backup_dir/database-media-paths.txt" <<'SQL'
SELECT storage_path
FROM images
UNION
SELECT variant.value->>'storagePath'
FROM images
CROSS JOIN LATERAL jsonb_each(images.variants) AS variant
WHERE jsonb_typeof(variant.value) = 'object'
  AND variant.value->>'storagePath' IS NOT NULL
ORDER BY 1;
SQL

compose run --rm -T --no-deps --pull never --entrypoint sh backend -eu -c \
  'tar -C /app/uploads/current -czf - .' \
  > "$backup_dir/uploads.tar.gz"

compose run --rm -T --no-deps --pull never --entrypoint sh backend -eu -c \
  'cd /app/uploads/current; find . -type f -print | LC_ALL=C sort | xargs -r sha256sum' \
  > "$backup_dir/uploads-manifest.sha256"
uploads_size_bytes=$(compose run --rm -T --no-deps --pull never --entrypoint sh backend -eu -c \
  'find /app/uploads/current -type f -exec stat -c %s {} \; | awk "{ total += \$1 } END { print total + 0 }"')
case "$uploads_size_bytes" in
  ""|*[!0-9]*) echo "Cannot determine the uncompressed uploads size" >&2; exit 1 ;;
esac

caddy_state_included=no
if printf '%s\n' "$configured_services" | grep -qx caddy; then
  compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    'tar -C /data -czf - .' > "$backup_dir/caddy-data.tar.gz"
  compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    'tar -C /config -czf - .' > "$backup_dir/caddy-config.tar.gz"
  compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    'cd /data; find . -type f -print | LC_ALL=C sort | xargs -r sha256sum' \
    > "$backup_dir/caddy-data-manifest.sha256"
  compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    'cd /config; find . -type f -print | LC_ALL=C sort | xargs -r sha256sum' \
    > "$backup_dir/caddy-config-manifest.sha256"
  caddy_data_size_bytes=$(compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    'find /data -type f -exec stat -c %s {} \; | awk "{ total += \$1 } END { print total + 0 }"')
  caddy_config_size_bytes=$(compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    'find /config -type f -exec stat -c %s {} \; | awk "{ total += \$1 } END { print total + 0 }"')
  caddy_state_included=yes
else
  tar -czf "$backup_dir/caddy-data.tar.gz" --files-from=/dev/null
  tar -czf "$backup_dir/caddy-config.tar.gz" --files-from=/dev/null
  : > "$backup_dir/caddy-data-manifest.sha256"
  : > "$backup_dir/caddy-config-manifest.sha256"
  caddy_data_size_bytes=0
  caddy_config_size_bytes=0
fi
case "$caddy_data_size_bytes:$caddy_config_size_bytes" in
  :|:*|*:) echo "Cannot determine the uncompressed Caddy state size" >&2; exit 1 ;;
  *[!0-9:]*) echo "Cannot determine the uncompressed Caddy state size" >&2; exit 1 ;;
esac

resume_backend_best_effort
test "$backend_stopped" = false || {
  echo "Backup failed: backend did not restart healthy" >&2
  exit 1
}
resume_caddy_best_effort
test "$caddy_stopped" = false || {
  echo "Backup failed: managed public traffic did not restart healthy" >&2
  exit 1
}

for image in $backup_images; do
  image_id=$(docker image inspect --format '{{.Id}}' "$image")
  printf '%s %s\n' "$image" "$image_id"
done > "$backup_dir/images.txt"
docker image save --output "$backup_dir/images.tar" $backup_images
gzip -9 "$backup_dir/images.tar"

bundle_dir="$backup_dir/restore-bundle"
mkdir -p "$bundle_dir/scripts" "$bundle_dir/docker"
cp "$compose_file" "$bundle_dir/compose.yaml"
cp scripts/compose-mutation.sh scripts/restore.sh scripts/verify-backup.sh "$bundle_dir/scripts/"
cp Dockerfile .env.example OPERATIONS.md "$bundle_dir/"
cp -R docker/. "$bundle_dir/docker/"
  printf '%s\n' \
  'Cold-host restore:' \
  '1. Extract this archive into an empty directory.' \
  '2. Create a protected .env.local with the original credentials.' \
  '3. Create a stable private host lock: mkdir -p /var/lib/camping-drive/locks && chmod 700 /var/lib/camping-drive/locks.' \
  '4. Export OPERATIONS_LOCK_ROOT=/var/lib/camping-drive/locks.' \
  '5. Run RESTORE_CONFIRM=restore-production RESTORE_TRAFFIC_DISABLED=yes sh scripts/restore.sh /absolute/backup.' \
  > "$bundle_dir/README.txt"
tar -C "$bundle_dir" -czf "$backup_dir/restore-bundle.tar.gz" .
rm -rf "$bundle_dir"

(
  cd "$backup_dir"
  printf 'created_at=%s\ncompose_file=%s\ncompose_config_sha256=%s\nops_bundle_sha256=%s\neffective_compose_sha256=%s\nproject_name=%s\ndeployment_topology=%s\ndocker_platform=%s\ndatabase_name=%s\ndatabase_owner=%s\ndatabase_size_bytes=%s\ndatabase_encoding=%s\ndatabase_collate=%s\ndatabase_ctype=%s\ndatabase_locale_provider=%s\ndatabase_tablespace=%s\ndatabase_connection_limit=%s\nuploads_size_bytes=%s\ncaddy_state_included=%s\ncaddy_data_size_bytes=%s\ncaddy_config_size_bytes=%s\nimage_tag=%s\nbackend_image=%s\nimages_archive=%s\nrestore_bundle=%s\n' \
    "$timestamp" "$compose_file" "$compose_config_sha256" "$ops_bundle_sha256" "$effective_compose_sha256" "$project_name" "$configured_deployment_topology" "$docker_platform" "$database_name" "$database_owner" "$database_size_bytes" \
    "$database_encoding" "$database_collate" "$database_ctype" "$database_locale_provider" "$database_tablespace" "$database_connection_limit" "$uploads_size_bytes" "$caddy_state_included" \
    "$caddy_data_size_bytes" "$caddy_config_size_bytes" \
    "$image_tag" "$backend_image" "images.tar.gz" "restore-bundle.tar.gz" > metadata.txt
  sha256sum \
    caddy-config-manifest.sha256 \
    caddy-config.tar.gz \
    caddy-data-manifest.sha256 \
    caddy-data.tar.gz \
    cluster-globals.sql \
    cluster-roles.txt \
    database.dump \
    database-privileges.sql \
    images.tar.gz \
    images.txt \
    metadata.txt \
    restore-bundle.tar.gz \
    uploads.tar.gz \
    uploads-manifest.sha256 \
    database-media-paths.txt \
    schema-migrations.txt \
    > SHA256SUMS
)

touch "$backup_dir/COMPLETE"
mv "$backup_dir" "$final_backup_dir"
backup_dir="$final_backup_dir"
release_operations_lock
trap - EXIT INT TERM

echo "Backup created: $backup_dir"
echo "Run: sh scripts/verify-backup.sh '$backup_dir'"
