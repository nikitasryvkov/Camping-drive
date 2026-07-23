#!/bin/sh
set -eu

umask 077

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # Keep container-internal paths intact while allowing temporary host paths
    # to be converted for the native Docker Desktop CLI.
    MSYS2_ARG_CONV_EXCL="/etc/caddy;/app;/data;/config;/var/lib/postgresql/data"
    export MSYS2_ARG_CONV_EXCL
    ;;
esac

work_dir=$(mktemp -d)
env_file="$work_dir/dr.env"
backup_root="$work_dir/backups"
project_name="camping-drive-dr-$$"
compose_file=${DR_COMPOSE_FILE:-compose.app-only.yaml}
image_tag=${DR_IMAGE_TAG:-scan}
operations_lock_root="$work_dir/operation-locks"
managed_edge=false
if [ "$compose_file" = compose.yaml ]; then
  compose_profiles=
  managed_edge=true
else
  compose_profiles=caddy-state-test
fi

cleanup() {
  COMPOSE_PROJECT_NAME="$project_name" \
    docker compose --env-file "$env_file" -f "$compose_file" down --volumes --remove-orphans \
    >/dev/null 2>&1 || true
  if [ "${DR_KEEP_WORKDIR:-}" = yes ]; then
    echo "DR diagnostic work directory retained: $work_dir" >&2
  else
    rm -rf "$work_dir"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cat > "$env_file" <<ENV
IMAGE_TAG=$image_tag
SITE_DOMAIN=dr.example.test
POSTGRES_DB=camping_drive_dr
POSTGRES_USER=camping_drive_owner
POSTGRES_PASSWORD=ci-owner-password-for-isolated-dr-only
APP_DB_USER=camping_drive_app
APP_DB_PASSWORD=ci-runtime-password-for-isolated-dr-only
PUBLIC_SITE_URL=https://dr.example.test
PUBLIC_ORIGINS=https://dr.example.test
VITE_SITE_URL=https://dr.example.test
PGPORT=15432
FRONTEND_PORT=18080
PUBLIC_HTTP_PORT=18081
PUBLIC_HTTPS_PORT=18443
ENV
chmod 600 "$env_file"

export COMPOSE_PROJECT_NAME="$project_name"
export ENV_FILE="$env_file"
export COMPOSE_FILE="$compose_file"
export COMPOSE_PROFILES="$compose_profiles"
export IMAGE_TAG="$image_tag"
export OPERATIONS_LOCK_ROOT="$operations_lock_root"

docker compose --env-file "$env_file" -f "$compose_file" run --rm -T --no-deps \
  --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file "$env_file" -f "$compose_file" up -d --wait
docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
    --command="CREATE ROLE dr_monitor LOGIN PASSWORD \$\$dr-monitor-password-for-isolated-test\$\$; GRANT CONNECT ON DATABASE camping_drive_dr TO dr_monitor; ALTER DATABASE camping_drive_dr CONNECTION LIMIT 5; INSERT INTO administrators(login, password_hash, role) VALUES ('"'"'dr-admin'"'"', '"'"'restore-test-placeholder'"'"', '"'"'administrator'"'"'); INSERT INTO administrator_sessions(administrator_id, token_hash, expires_at) SELECT id, repeat('"'"'a'"'"', 64), now() + interval '"'"'1 hour'"'"' FROM administrators WHERE login = '"'"'dr-admin'"'"'; INSERT INTO administrator_login_rate_limits(scope_hash, window_started_at, attempts) VALUES (repeat('"'"'b'"'"', 64), now(), 1);"'
docker compose --env-file "$env_file" -f "$compose_file" run --rm -T --no-deps \
  --entrypoint sh caddy -eu -c \
  'printf caddy-data-before-backup > /data/dr-sentinel; printf caddy-config-before-backup > /config/dr-sentinel'
mkdir -p "$backup_root"
mkdir -p "$operations_lock_root"
chmod 700 "$operations_lock_root"
live_lock="$operations_lock_root/camping-drive-$project_name.operations.lock"
exec 8>"$live_lock"
flock -n 8
if sh scripts/backup.sh "$work_dir/other-backup-root"; then
  echo "Concurrent backup unexpectedly acquired the project operations lock" >&2
  exit 1
fi
if sh scripts/compose-mutation.sh migrate; then
  echo "Concurrent migration unexpectedly acquired the project operations lock" >&2
  exit 1
fi
flock -u 8
exec 8>&-
BACKUP_TRAFFIC_DISABLED=yes sh scripts/backup.sh "$backup_root"
backup_dir=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d | head -n 1)
test -n "$backup_dir"
cp "$backup_dir/metadata.txt" "$work_dir/metadata.txt"
printf '\n' >> "$backup_dir/metadata.txt"
if sh scripts/verify-backup.sh "$backup_dir"; then
  echo "Backup verification unexpectedly accepted modified metadata" >&2
  exit 1
fi
mv "$work_dir/metadata.txt" "$backup_dir/metadata.txt"
sh scripts/verify-backup.sh "$backup_dir"

docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
    --command="GRANT pg_read_all_data TO dr_monitor; CREATE TABLE dr_restore_marker(id integer PRIMARY KEY);"'
if RESTORE_CONFIRM=restore-production RESTORE_TRAFFIC_DISABLED=yes sh scripts/restore.sh "$backup_dir"; then
  echo "Exact restore unexpectedly accepted a post-backup built-in role grant" >&2
  exit 1
fi
test "$(docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
    --command="SELECT to_regclass('"'"'public.dr_restore_marker'"'"') IS NOT NULL"')" = t
docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
    --command="REVOKE pg_read_all_data FROM dr_monitor;"'
RESTORE_CONFIRM=restore-production \
RESTORE_TRAFFIC_DISABLED=yes \
RESTORE_MODE=exact \
sh scripts/restore.sh "$backup_dir"
test "$(docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
    --command="SELECT to_regclass('"'"'public.dr_restore_marker'"'"') IS NULL"')" = t

docker compose --env-file "$env_file" -f "$compose_file" down --volumes --remove-orphans
while read -r archived_image _image_id; do
  docker image rm "$archived_image" >/dev/null
done < "$backup_dir/images.txt"

mkdir "$work_dir/cold-host"
tar -xzf "$backup_dir/restore-bundle.tar.gz" -C "$work_dir/cold-host"

RESTORE_CONFIRM=restore-production \
RESTORE_TRAFFIC_DISABLED=yes \
RESTORE_MODE=exact \
COMPOSE_FILE="$work_dir/cold-host/compose.yaml" \
sh "$work_dir/cold-host/scripts/restore.sh" "$backup_dir"

test "$(docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
    --command="SELECT to_regclass('"'"'public.dr_restore_marker'"'"') IS NULL"')" = t
test "$(docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
    --command="SELECT has_database_privilege('"'"'dr_monitor'"'"', current_database(), '"'"'CONNECT'"'"') AND datconnlimit = 5 FROM pg_database WHERE datname = current_database()"')" = t
test "$(docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
    --command="SELECT (SELECT count(*) FROM administrator_sessions) = 0 AND (SELECT count(*) FROM administrator_login_rate_limits) = 0"')" = t
docker compose --env-file "$env_file" -f "$compose_file" exec -T \
  -e PGPASSWORD=dr-monitor-password-for-isolated-test db \
  psql --host=127.0.0.1 --username=dr_monitor --dbname=camping_drive_dr \
  --tuples-only --no-align --command="SELECT current_user" | grep -qx dr_monitor
curl --fail --silent --show-error http://127.0.0.1:18080/healthz | grep -q '"status":"ready"'
docker compose --env-file "$env_file" -f "$compose_file" run --rm -T --no-deps \
  --entrypoint sh caddy -eu -c \
  'test "$(cat /data/dr-sentinel)" = caddy-data-before-backup; test "$(cat /config/dr-sentinel)" = caddy-config-before-backup; test "$(stat -c "%u:%g" /data/dr-sentinel)" = 10001:10001; test "$(stat -c "%u:%g" /config/dr-sentinel)" = 10001:10001'

if [ "$managed_edge" = true ]; then
  sh scripts/compose-mutation.sh start-traffic
  caddy_container=$(docker compose --env-file "$env_file" -f "$compose_file" ps -q caddy)
  test -n "$caddy_container"
  test "$(docker inspect --format '{{.Config.User}}|{{.State.Health.Status}}' "$caddy_container")" = "10001:10001|healthy"
fi

echo "Disaster-recovery smoke test passed"
