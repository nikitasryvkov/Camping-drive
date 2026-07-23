#!/bin/sh
set -eu

backup_dir=${1:?Usage: RESTORE_CONFIRM=restore-production RESTORE_TRAFFIC_DISABLED=yes scripts/restore.sh /absolute/path/to/backup}
case "$backup_dir" in
  /*) ;;
  *) echo "Backup directory must be absolute" >&2; exit 2 ;;
esac

if [ "${RESTORE_CONFIRM:-}" != "restore-production" ]; then
  echo "Set RESTORE_CONFIRM=restore-production to authorize destructive restore" >&2
  exit 2
fi
if [ "${RESTORE_TRAFFIC_DISABLED:-}" != "yes" ]; then
  echo "Set RESTORE_TRAFFIC_DISABLED=yes only after public traffic and all external writers are disabled" >&2
  exit 2
fi

restore_mode=${RESTORE_MODE:-exact}
case "$restore_mode" in
  exact|forward) ;;
  *) echo "RESTORE_MODE must be exact or forward" >&2; exit 2 ;;
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

sh "$(dirname "$0")/verify-backup.sh" "$backup_dir" checksums-only

metadata_value() {
  sed -n "s/^$1=//p" "$backup_dir/metadata.txt" | tail -n 1
}

backup_image_tag=$(metadata_value image_tag)
backup_project_name=$(metadata_value project_name)
backup_deployment_topology=$(metadata_value deployment_topology)
backup_docker_platform=$(metadata_value docker_platform)
backup_database_name=$(metadata_value database_name)
backup_database_owner=$(metadata_value database_owner)
backup_compose_sha256=$(metadata_value compose_config_sha256)
backup_ops_bundle_sha256=$(metadata_value ops_bundle_sha256)
backup_effective_compose_sha256=$(metadata_value effective_compose_sha256)
backup_database_size_bytes=$(metadata_value database_size_bytes)
backup_database_encoding=$(metadata_value database_encoding)
backup_database_collate=$(metadata_value database_collate)
backup_database_ctype=$(metadata_value database_ctype)
backup_database_locale_provider=$(metadata_value database_locale_provider)
backup_database_tablespace=$(metadata_value database_tablespace)
backup_database_connection_limit=$(metadata_value database_connection_limit)
backup_uploads_size_bytes=$(metadata_value uploads_size_bytes)
backup_caddy_state_included=$(metadata_value caddy_state_included)
backup_caddy_data_size_bytes=$(metadata_value caddy_data_size_bytes)
backup_caddy_config_size_bytes=$(metadata_value caddy_config_size_bytes)
case "$backup_image_tag" in
  ""|latest) echo "Backup metadata does not contain an immutable image_tag" >&2; exit 1 ;;
esac

if [ "$restore_mode" = exact ]; then
  IMAGE_TAG=$backup_image_tag
  export IMAGE_TAG
elif [ -z "${IMAGE_TAG:-}" ] || [ "${IMAGE_TAG:-}" = latest ]; then
  echo "Forward recovery requires the target immutable IMAGE_TAG in the environment" >&2
  exit 2
fi
if [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ -n "$backup_project_name" ]; then
  COMPOSE_PROJECT_NAME=$backup_project_name
  export COMPOSE_PROJECT_NAME
fi

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

target_deployment_topology=$(compose config | sed -n 's/^[[:space:]]*DEPLOYMENT_TOPOLOGY: //p' | LC_ALL=C sort -u)
case "$backup_deployment_topology:$target_deployment_topology" in
  managed-edge:managed-edge|external-edge:external-edge) ;;
  *)
    echo "Restore refused: backup topology '$backup_deployment_topology' does not match target topology '$target_deployment_topology'" >&2
    exit 1
    ;;
esac
target_docker_platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
test "$target_docker_platform" = "$backup_docker_platform" || {
  echo "Restore refused: backup images target '$backup_docker_platform', but Docker targets '$target_docker_platform'" >&2
  exit 1
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

target_project_name=$(compose config | sed -n 's/^name: //p' | head -n 1)
case "$target_project_name" in
  ""|*[!A-Za-z0-9_-]*) echo "Cannot determine a safe Compose project name" >&2; exit 1 ;;
esac
configured_services=$(compose config --services)
for project_container in $(docker ps -q --filter "label=com.docker.compose.project=$target_project_name"); do
  project_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$project_container")
  printf '%s\n' "$configured_services" | grep -qx "$project_service" || {
    echo "Restore refused: running orphan service '$project_service' belongs to Compose project $target_project_name" >&2
    exit 1
  }
done
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
operations_lock="$operations_lock_root/camping-drive-$target_project_name.operations.lock"
if [ -e "$operations_lock" ] && { [ -L "$operations_lock" ] || [ ! -f "$operations_lock" ]; }; then
  echo "The operations lock must be a regular non-symlink file" >&2
  exit 1
fi
operations_lock_held=false
acquire_operations_lock() {
  exec 9>"$operations_lock"
  if ! flock -n 9; then
    echo "Another backup or restore is running for Compose project $target_project_name" >&2
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

target_compose_sha256=$(sha256sum "$compose_file" | awk '{print $1}')
target_ops_bundle_sha256=$(calculate_ops_bundle_sha256)
target_effective_compose_sha256=$(compose config --no-path-resolution | sha256sum | awk '{print $1}')
target_override=${RESTORE_TARGET_OVERRIDE:-}
if [ "$target_project_name" != "$backup_project_name" ]; then
  echo "Restore refused: Compose project remapping is unsupported ('$backup_project_name' != '$target_project_name')" >&2
  exit 1
fi
if [ "$restore_mode" = exact ] && [ "$target_compose_sha256" != "$backup_compose_sha256" ]; then
  test "$target_override" = "restore-backup-to-different-target" || {
    echo "Exact restore refused: target Compose file does not match the backup bundle" >&2
    exit 1
  }
fi
if [ "$restore_mode" = exact ] && [ "$target_ops_bundle_sha256" != "$backup_ops_bundle_sha256" ]; then
  test "$target_override" = "restore-backup-to-different-target" || {
    echo "Exact restore refused: target Docker/Proxy operations bundle does not match the backup" >&2
    exit 1
  }
fi
if [ "$restore_mode" = exact ] && [ "$target_effective_compose_sha256" != "$backup_effective_compose_sha256" ]; then
  test "$target_override" = "restore-backup-to-different-target" || {
    echo "Exact restore refused: effective Compose environment does not match the backup" >&2
    exit 1
  }
fi
case "$backup_database_size_bytes" in
  ""|*[!0-9]*) echo "Backup metadata contains an invalid database_size_bytes" >&2; exit 1 ;;
esac
case "$backup_uploads_size_bytes" in
  ""|*[!0-9]*) echo "Backup metadata contains an invalid uploads_size_bytes" >&2; exit 1 ;;
esac
case "$backup_database_encoding" in
  ""|*[!A-Za-z0-9_-]*) echo "Backup metadata contains an invalid database encoding" >&2; exit 1 ;;
esac
test "$backup_database_locale_provider" = c || {
  echo "Restore supports exact recovery only for libc-locale databases" >&2
  exit 1
}
test "$backup_database_tablespace" = pg_default || {
  echo "Restore supports exact recovery only for the pg_default database tablespace" >&2
  exit 1
}
case "$backup_database_connection_limit" in
  -1) ;;
  ""|*[!0-9]*) echo "Backup metadata contains an invalid database connection limit" >&2; exit 1 ;;
  *) ;;
esac
test -n "$backup_database_collate" && test -n "$backup_database_ctype" || {
  echo "Backup metadata does not contain database locale settings" >&2
  exit 1
}
case "$backup_caddy_state_included" in
  yes|no) ;;
  *) echo "Backup metadata contains an invalid caddy_state_included value" >&2; exit 1 ;;
esac
case "$backup_caddy_data_size_bytes:$backup_caddy_config_size_bytes" in
  :|:*|*:) echo "Backup metadata contains invalid Caddy state sizes" >&2; exit 1 ;;
  *[!0-9:]*) echo "Backup metadata contains invalid Caddy state sizes" >&2; exit 1 ;;
esac
if [ "$backup_caddy_state_included" = yes ] && ! compose config --services | grep -qx caddy; then
  echo "Restore target does not define the Caddy volumes contained in the backup" >&2
  exit 1
fi

VERIFY_OPERATIONS_LOCK_HELD=yes sh "$(dirname "$0")/verify-backup.sh" "$backup_dir"

load_backup_images=false
if [ "$restore_mode" = exact ]; then
  for image in $(compose config --images | LC_ALL=C sort -u); do
    expected_id=$(awk -v reference="$image" '$1 == reference { print $2 }' "$backup_dir/images.txt")
    test -n "$expected_id" || {
      echo "Restore preflight failed: backup has no immutable digest for $image" >&2
      exit 1
    }
    actual_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)
    if [ "$actual_id" != "$expected_id" ]; then
      load_backup_images=true
    fi
  done
fi
if [ "$load_backup_images" = true ]; then
  gzip -dc "$backup_dir/images.tar.gz" | docker image load >/dev/null
fi

invalid_images=false
for image in $(compose config --images | LC_ALL=C sort -u); do
  actual_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)
  if [ "$restore_mode" = exact ]; then
    expected_id=$(awk -v reference="$image" '$1 == reference { print $2 }' "$backup_dir/images.txt")
  else
    expected_id=$actual_id
  fi
  if [ -z "$actual_id" ] || [ "$actual_id" != "$expected_id" ]; then
    echo "Restore preflight failed: required immutable image is missing or has the wrong digest: $image" >&2
    invalid_images=true
  fi
done
test "$invalid_images" = false || {
  echo "Load the target forward images or repair the exact backup archive before retrying; no services or data were changed." >&2
  exit 1
}

required_kb=$(((backup_uploads_size_bytes + 1023) / 1024 + 65536))
uploads_free_kb=$(compose run --rm -T --no-deps --pull never --entrypoint sh backend -eu -c \
  "df -Pk /app/uploads | awk 'NR == 2 { print \$4 }'")
case "$uploads_free_kb" in
  ""|*[!0-9]*) echo "Restore preflight could not determine free uploads storage" >&2; exit 1 ;;
esac
if [ "$uploads_free_kb" -lt "$required_kb" ]; then
  echo "Restore preflight failed: uploads storage has ${uploads_free_kb} KiB free; at least ${required_kb} KiB is required" >&2
  exit 1
fi
if [ "$backup_caddy_state_included" = yes ]; then
  caddy_storage_free=$(compose run --rm -T --no-deps --pull never --entrypoint sh caddy -eu -c \
    "df -Pk /data | awk 'NR == 2 { print \$4 }'; df -Pk /config | awk 'NR == 2 { print \$4 }'")
  caddy_data_free_kb=$(printf '%s\n' "$caddy_storage_free" | sed -n '1p')
  caddy_config_free_kb=$(printf '%s\n' "$caddy_storage_free" | sed -n '2p')
  case "$caddy_data_free_kb:$caddy_config_free_kb" in
    :|:*|*:|*[!0-9:]*) echo "Restore preflight could not determine free Caddy storage" >&2; exit 1 ;;
  esac
  required_caddy_data_kb=$(((backup_caddy_data_size_bytes + 1023) / 1024 + 32768))
  required_caddy_config_kb=$(((backup_caddy_config_size_bytes + 1023) / 1024 + 32768))
  if [ "$caddy_data_free_kb" -lt "$required_caddy_data_kb" ]; then
    echo "Restore preflight failed: Caddy data storage has ${caddy_data_free_kb} KiB free; at least ${required_caddy_data_kb} KiB is required" >&2
    exit 1
  fi
  if [ "$caddy_config_free_kb" -lt "$required_caddy_config_kb" ]; then
    echo "Restore preflight failed: Caddy config storage has ${caddy_config_free_kb} KiB free; at least ${required_caddy_config_kb} KiB is required" >&2
    exit 1
  fi
fi

compose up -d --wait --no-build --pull never db
target_database_name=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT current_database()"')
target_database_owner=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()"')
target_database_login=$(compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT current_user"')
if [ "$target_database_name" != "$backup_database_name" ]; then
  echo "Restore refused: database identity remapping is unsupported ('$backup_database_name' != '$target_database_name')" >&2
  exit 1
fi
if [ "$target_database_owner" != "$backup_database_owner" ]; then
  echo "Restore refused: database-owner remapping is unsupported ('$backup_database_owner' != '$target_database_owner')" >&2
  exit 1
fi
test "$target_database_owner" = "$target_database_login" || {
  echo "Restore refused: migration login '$target_database_login' must own target database '$target_database_name'" >&2
  exit 1
}
case "$target_database_name" in
  ""|-*|*[!A-Za-z0-9_-]*) echo "Restore target database name is not safe" >&2; exit 1 ;;
esac
test "${#target_database_name}" -le 63 || {
  echo "Restore target database name is too long" >&2
  exit 1
}
case "$target_database_owner" in
  ""|[0-9]*|*[!A-Za-z0-9_]*) echo "Restore target database owner is not safe" >&2; exit 1 ;;
esac
test "${#target_database_owner}" -le 63 || {
  echo "Restore target database owner is too long" >&2
  exit 1
}
case "$target_database_name" in
  postgres|template0|template1) echo "Restore target must be a dedicated application database" >&2; exit 1 ;;
esac
database_free_kb=$(compose exec -T db sh -eu -c \
  'df -Pk "$PGDATA" | awk "NR == 2 { print \$4 }"')
case "$database_free_kb" in
  ""|*[!0-9]*) echo "Restore preflight could not determine free PostgreSQL storage" >&2; exit 1 ;;
esac
source_database_kb=$(((backup_database_size_bytes + 1023) / 1024))
required_database_kb=$((source_database_kb * 2 + 524288))
if [ "$database_free_kb" -lt "$required_database_kb" ]; then
  echo "Restore preflight failed: PostgreSQL storage has ${database_free_kb} KiB free; at least ${required_database_kb} KiB is required" >&2
  exit 1
fi

expected_cluster_relationships=$(mktemp)
actual_cluster_relationships=$(mktemp)
awk -F '\t' '
  $1 == "ROLE" { print "ROLE_NAME\t" $2 }
  $1 == "MEMBER" { print }
' "$backup_dir/cluster-roles.txt" > "$expected_cluster_relationships"
compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT '"'"'ROLE_NAME'"'"' || chr(9) || rolname FROM pg_authid WHERE rolname !~ '"'"'^pg_'"'"' UNION ALL SELECT '"'"'MEMBER'"'"' || chr(9) || parent.rolname || chr(9) || member.rolname || chr(9) || membership.admin_option FROM pg_auth_members AS membership JOIN pg_roles AS parent ON parent.oid = membership.roleid JOIN pg_roles AS member ON member.oid = membership.member WHERE parent.rolname !~ '"'"'^pg_'"'"' OR member.rolname !~ '"'"'^pg_'"'"' ORDER BY 1"' \
  > "$actual_cluster_relationships"
unexpected_cluster_relationships=$(grep -Fvx -f "$expected_cluster_relationships" "$actual_cluster_relationships" || true)
rm -f "$expected_cluster_relationships" "$actual_cluster_relationships"
test -z "$unexpected_cluster_relationships" || {
  echo "Restore refused: target cluster contains roles or memberships absent from the exact backup" >&2
  printf '%s\n' "$unexpected_cluster_relationships" >&2
  exit 1
}

for service in caddy caddy-volume-init frontend backend migrate admin-create; do
  if printf '%s\n' "$configured_services" | grep -qx "$service"; then
    compose stop "$service" >/dev/null
  fi
done

running_writers=$(compose ps --services --status running | grep -E '^(caddy|caddy-volume-init|frontend|backend|migrate|admin-create)$' || true)
test -z "$running_writers" || {
  echo "Restore refused because application services are still running: $running_writers" >&2
  exit 1
}

actual_migrations=""
actual_database_privileges=""
cleanup_restore() {
  test -z "$actual_migrations" || rm -f "$actual_migrations"
  test -z "$actual_database_privileges" || rm -f "$actual_database_privileges"
  release_operations_lock
}
trap cleanup_restore EXIT
trap 'exit 130' INT TERM

compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1' \
  < "$backup_dir/cluster-globals.sql"
if [ "$restore_mode" = forward ]; then
  compose exec -T db sh -eu -c \
    'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
      --set=target_password="$POSTGRES_PASSWORD"' <<'SQL'
SELECT format(
  'ALTER ROLE %I PASSWORD %L',
  current_user,
  :'target_password'
)
\gexec
SQL
fi
actual_cluster_roles=$(mktemp)
compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT '"'"'ROLE'"'"' || chr(9) || rolname || chr(9) || rolsuper || chr(9) || rolinherit || chr(9) || rolcreaterole || chr(9) || rolcreatedb || chr(9) || rolcanlogin || chr(9) || rolreplication || chr(9) || rolconnlimit || chr(9) || rolbypassrls || chr(9) || COALESCE(rolpassword, '"'"''"'"') FROM pg_authid WHERE rolname !~ '"'"'^pg_'"'"' UNION ALL SELECT '"'"'MEMBER'"'"' || chr(9) || parent.rolname || chr(9) || member.rolname || chr(9) || membership.admin_option FROM pg_auth_members AS membership JOIN pg_roles AS parent ON parent.oid = membership.roleid JOIN pg_roles AS member ON member.oid = membership.member WHERE parent.rolname !~ '"'"'^pg_'"'"' OR member.rolname !~ '"'"'^pg_'"'"' ORDER BY 1"' \
  > "$actual_cluster_roles"
if [ "$restore_mode" = exact ]; then
  diff -u "$backup_dir/cluster-roles.txt" "$actual_cluster_roles"
else
  expected_cluster_roles_normalized=$(mktemp)
  actual_cluster_roles_normalized=$(mktemp)
  awk -F '\t' -v owner="$target_database_owner" 'BEGIN { OFS = "\t" } $1 == "ROLE" && $2 == owner { $11 = "<target-password>" } { print }' \
    "$backup_dir/cluster-roles.txt" > "$expected_cluster_roles_normalized"
  awk -F '\t' -v owner="$target_database_owner" 'BEGIN { OFS = "\t" } $1 == "ROLE" && $2 == owner { $11 = "<target-password>" } { print }' \
    "$actual_cluster_roles" > "$actual_cluster_roles_normalized"
  missing_cluster_roles=$(grep -Fvx -f "$actual_cluster_roles_normalized" "$expected_cluster_roles_normalized" || true)
  rm -f "$expected_cluster_roles_normalized" "$actual_cluster_roles_normalized"
  test -z "$missing_cluster_roles" || {
    echo "Restore failed: database roles or memberships required by the backup are missing" >&2
    printf '%s\n' "$missing_cluster_roles" >&2
    exit 1
  }
fi
rm -f "$actual_cluster_roles"

compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 \
    --set=target_database="$POSTGRES_DB" --set=target_owner="$POSTGRES_USER"' <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_database'
  AND pid <> pg_backend_pid();
SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS false', :'target_database')
\gexec
SELECT format('DROP DATABASE %I WITH (FORCE)', :'target_database')
\gexec
SQL

RESTORE_TARGET_DATABASE=$target_database_name \
RESTORE_TARGET_OWNER=$target_database_owner \
RESTORE_TARGET_ENCODING=$backup_database_encoding \
RESTORE_TARGET_COLLATE=$backup_database_collate \
RESTORE_TARGET_CTYPE=$backup_database_ctype \
RESTORE_TARGET_TABLESPACE=$backup_database_tablespace \
compose exec -T \
  -e RESTORE_TARGET_DATABASE \
  -e RESTORE_TARGET_OWNER \
  -e RESTORE_TARGET_ENCODING \
  -e RESTORE_TARGET_COLLATE \
  -e RESTORE_TARGET_CTYPE \
  -e RESTORE_TARGET_TABLESPACE \
  db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 \
    --set=target_database="$RESTORE_TARGET_DATABASE" \
    --set=target_owner="$RESTORE_TARGET_OWNER" \
    --set=target_encoding="$RESTORE_TARGET_ENCODING" \
    --set=target_collate="$RESTORE_TARGET_COLLATE" \
    --set=target_ctype="$RESTORE_TARGET_CTYPE" \
    --set=target_tablespace="$RESTORE_TARGET_TABLESPACE"' <<'SQL'
SELECT format(
  'CREATE DATABASE %I WITH TEMPLATE template0 OWNER %I ENCODING %L LOCALE_PROVIDER libc LC_COLLATE %L LC_CTYPE %L TABLESPACE %I CONNECTION LIMIT 0',
  :'target_database',
  :'target_owner',
  :'target_encoding',
  :'target_collate',
  :'target_ctype',
  :'target_tablespace'
)
\gexec
SQL

# Keep the fresh database isolated from every non-superuser until the database,
# uploads and proxy state have all been restored and provisioned.
compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 \
    --set=target_database="$POSTGRES_DB"' <<'SQL'
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'target_database')
\gexec
SQL
restore_isolation_state=$(compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname=postgres --tuples-only --no-align --field-separator="|" --set=ON_ERROR_STOP=1 \
    --set=target_database="$POSTGRES_DB"' <<'SQL'
SELECT database.datconnlimit,
       EXISTS (
         SELECT 1
         FROM aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS privilege
         WHERE privilege.grantee = 0
           AND privilege.privilege_type = 'CONNECT'
       ),
       (SELECT count(*) FROM pg_stat_activity WHERE datname = :'target_database')
FROM pg_database AS database
WHERE database.datname = :'target_database';
SQL
)
test "$restore_isolation_state" = "0|f|0" || {
  echo "Restore refused: the replacement database is not isolated from runtime connections" >&2
  exit 1
}

compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1' \
  < "$backup_dir/cluster-globals.sql"
if [ "$restore_mode" = forward ]; then
  compose exec -T db sh -eu -c \
    'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
      --set=target_password="$POSTGRES_PASSWORD"' <<'SQL'
SELECT format(
  'ALTER ROLE %I PASSWORD %L',
  current_user,
  :'target_password'
)
\gexec
SQL
fi

compose exec -T db sh -eu -c \
  'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-owner --exit-on-error' \
  < "$backup_dir/database.dump"

compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1' <<'SQL'
SELECT 'TRUNCATE TABLE administrator_sessions;'
WHERE to_regclass('public.administrator_sessions') IS NOT NULL
\gexec
SELECT 'TRUNCATE TABLE administrator_login_rate_limits;'
WHERE to_regclass('public.administrator_login_rate_limits') IS NOT NULL
\gexec
SQL

restore_timestamp=$(date -u +%Y%m%dT%H%M%SZ)
compose run --rm -T --no-deps --pull never --entrypoint sh backend -eu -c '
  storage=/app/uploads
  stage="$storage/.restore-staging-'"$restore_timestamp"'"
  previous="$storage/previous-'"$restore_timestamp"'"
  test ! -e "$stage"
  mkdir -p "$stage"
  cleanup() {
    rm -rf "$stage"
    if [ ! -d "$storage/current" ] && [ -d "$previous" ]; then
      mv "$previous" "$storage/current"
    fi
  }
  trap cleanup EXIT
  trap "exit 130" INT TERM
  tar -xzf - -C "$stage"
  if find "$stage" -type l | grep -q .; then
    echo "Restored uploads must not contain symbolic links" >&2
    exit 1
  fi
  test -d "$storage/current" || mkdir -p "$storage/current"
  mv "$storage/current" "$previous"
  mv "$stage" "$storage/current"
  trap - EXIT INT TERM
' < "$backup_dir/uploads.tar.gz"

if [ "$backup_caddy_state_included" = yes ]; then
  tar -C "$backup_dir" -cf - caddy-data.tar.gz caddy-config.tar.gz |
  compose run --rm -T --no-deps --pull never --user 0 \
    --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
    --entrypoint sh caddy -eu -c '
    input=/data/.restore-input
    data_stage=/data/.restore-staging
    data_previous=/data/.restore-previous
    config_stage=/config/.restore-staging
    config_previous=/config/.restore-previous
    data_phase=staging
    config_phase=staging
    test ! -e "$input"
    test ! -e "$data_stage" && test ! -e "$data_previous"
    test ! -e "$config_stage" && test ! -e "$config_previous"
    mkdir "$input" "$data_stage" "$config_stage"

    restore_previous() {
      root=$1
      stage=$2
      previous=$3
      phase=$4
      if [ "$phase" = new-active ]; then
        for entry in "$root"/* "$root"/.[!.]* "$root"/..?*; do
          test -e "$entry" || continue
          test "$entry" = "$stage" && continue
          test "$entry" = "$previous" && continue
          rm -rf "$entry"
        done
      fi
      if [ "$phase" = old-moving ] || [ "$phase" = new-active ]; then
        for entry in "$previous"/* "$previous"/.[!.]* "$previous"/..?*; do
          test -e "$entry" || continue
          mv "$entry" "$root/"
        done
      fi
      rm -rf "$stage" "$previous"
    }
    cleanup() {
      restore_previous /config "$config_stage" "$config_previous" "$config_phase"
      restore_previous /data "$data_stage" "$data_previous" "$data_phase"
      rm -rf "$input"
    }
    trap cleanup EXIT
    trap "exit 130" INT TERM

    tar -xf - -C "$input"
    test -f "$input/caddy-data.tar.gz"
    test -f "$input/caddy-config.tar.gz"
    tar -xzf "$input/caddy-data.tar.gz" -C "$data_stage"
    tar -xzf "$input/caddy-config.tar.gz" -C "$config_stage"
    rm -rf "$input"
    if find "$data_stage" "$config_stage" -type l | grep -q .; then
      echo "Restored Caddy state must not contain symbolic links" >&2
      exit 1
    fi
    chown -R 10001:10001 "$data_stage" "$config_stage"

    mkdir "$data_previous"
    data_phase=old-moving
    for entry in /data/* /data/.[!.]* /data/..?*; do
      test -e "$entry" || continue
      test "$entry" = "$data_stage" && continue
      test "$entry" = "$data_previous" && continue
      mv "$entry" "$data_previous/"
    done
    data_phase=new-active
    for entry in "$data_stage"/* "$data_stage"/.[!.]* "$data_stage"/..?*; do
      test -e "$entry" || continue
      mv "$entry" /data/
    done
    rmdir "$data_stage"

    mkdir "$config_previous"
    config_phase=old-moving
    for entry in /config/* /config/.[!.]* /config/..?*; do
      test -e "$entry" || continue
      test "$entry" = "$config_stage" && continue
      test "$entry" = "$config_previous" && continue
      mv "$entry" "$config_previous/"
    done
    config_phase=new-active
    for entry in "$config_stage"/* "$config_stage"/.[!.]* "$config_stage"/..?*; do
      test -e "$entry" || continue
      mv "$entry" /config/
    done
    rmdir "$config_stage"

    rm -rf "$data_previous" "$config_previous"
    data_phase=done
    config_phase=done
    trap - EXIT INT TERM
  '
fi

if [ "$restore_mode" = forward ]; then
  compose run --rm -T --no-deps --pull never migrate
else
  compose run --rm -T --no-deps --pull never admin-create node server/dist/provision-runtime.js
fi

# Database CONNECT grants and the original connection limit are deliberately
# restored last, immediately before application services are allowed to start.
compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
    --set=target_database="$POSTGRES_DB"' \
  < "$backup_dir/database-privileges.sql"
compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 \
    --set=target_database="$POSTGRES_DB" --set=connection_limit="'"$backup_database_connection_limit"'"' <<'SQL'
SELECT format(
  'ALTER DATABASE %I CONNECTION LIMIT %s',
  :'target_database',
  :'connection_limit'
)
\gexec
SQL

actual_database_privileges=$(mktemp)
compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1' \
  > "$actual_database_privileges" <<'SQL'
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
diff -u "$backup_dir/database-privileges.sql" "$actual_database_privileges"
rm -f "$actual_database_privileges"
actual_database_privileges=""
actual_connection_limit=$(compose exec -T db sh -eu -c \
  'exec psql --username="$POSTGRES_USER" --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --set=target_database="$POSTGRES_DB"' <<'SQL'
SELECT datconnlimit
FROM pg_database
WHERE datname = :'target_database';
SQL
)
test "$actual_connection_limit" = "$backup_database_connection_limit" || {
  echo "Restore failed: database connection limit was not restored exactly" >&2
  exit 1
}

compose up -d --wait --no-build --pull never backend frontend

actual_migrations=$(mktemp)
compose exec -T db sh -eu -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT name || '"'"' '"'"' || checksum FROM schema_migrations ORDER BY name"' \
  > "$actual_migrations"
if [ "$restore_mode" = exact ]; then
  diff -u "$backup_dir/schema-migrations.txt" "$actual_migrations"
fi
rm -f "$actual_migrations"
actual_migrations=""
release_operations_lock
trap - EXIT INT TERM

echo "Restore completed in $restore_mode mode with IMAGE_TAG=$IMAGE_TAG."
echo "The previous uploads directory is retained as /app/uploads/previous-$restore_timestamp."
echo "Validate admin, public pages, images and /healthz before starting public traffic."
