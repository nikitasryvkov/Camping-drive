#!/bin/sh
set -eu

backup_dir=${1:?Usage: scripts/verify-backup.sh /absolute/path/to/backup}
verify_mode=${2:-full}
case "$verify_mode" in
  full|checksums-only) ;;
  *) echo "Verification mode must be full or checksums-only" >&2; exit 2 ;;
esac
case "$backup_dir" in
  /*) ;;
  *) echo "Backup directory must be absolute" >&2; exit 2 ;;
esac

for file in \
  COMPLETE \
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
  restore-bundle.tar.gz \
  uploads.tar.gz \
  uploads-manifest.sha256 \
  database-media-paths.txt \
  schema-migrations.txt \
  SHA256SUMS \
  metadata.txt
do
  test -f "$backup_dir/$file" || {
    echo "Missing backup file: $file" >&2
    exit 1
  }
done

(cd "$backup_dir" && sha256sum -c SHA256SUMS)
if [ "$verify_mode" = "checksums-only" ]; then
  echo "Backup checksums verified: $backup_dir"
  exit 0
fi
gzip -t "$backup_dir/images.tar.gz"
tar -tzf "$backup_dir/restore-bundle.tar.gz" >/dev/null
test -s "$backup_dir/images.txt" || {
  echo "images.txt must contain at least one immutable image" >&2
  exit 1
}
backup_image_tag=$(sed -n 's/^image_tag=//p' "$backup_dir/metadata.txt" | tail -n 1)
case "$backup_image_tag" in
  ""|latest|*[!A-Za-z0-9._-]*) echo "Backup metadata contains an invalid immutable image tag" >&2; exit 1 ;;
esac
while read -r image image_id extra; do
  test -n "$image" && test -n "$image_id" && test -z "${extra:-}" || {
    echo "Invalid images.txt entry" >&2
    exit 1
  }
  printf '%s\n' "$image_id" | grep -Eq '^sha256:[0-9a-f]{64}$' || {
    echo "Invalid image ID for $image" >&2
    exit 1
  }
  case "$image" in
    "camping-drive-backend:$backup_image_tag"|"camping-drive-frontend:$backup_image_tag"|"camping-drive-postgres:$backup_image_tag"|"camping-drive-caddy:$backup_image_tag") ;;
    *) echo "Backup contains an image reference outside the release allowlist: $image" >&2; exit 1 ;;
  esac
  test "$(awk -v reference="$image" '$1 == reference { count++ } END { print count + 0 }' "$backup_dir/images.txt")" = 1 || {
    echo "Backup contains a duplicate image reference: $image" >&2
    exit 1
  }
done < "$backup_dir/images.txt"
for required_image in backend frontend postgres; do
  grep -q "^camping-drive-$required_image:$backup_image_tag " "$backup_dir/images.txt" || {
    echo "Backup is missing required release image: camping-drive-$required_image:$backup_image_tag" >&2
    exit 1
  }
done

backup_project_name=$(sed -n 's/^project_name=//p' "$backup_dir/metadata.txt" | tail -n 1)
backup_docker_platform=$(sed -n 's/^docker_platform=//p' "$backup_dir/metadata.txt" | tail -n 1)
case "$backup_project_name" in
  ""|*[!A-Za-z0-9_-]*) echo "Backup metadata contains an invalid Compose project name" >&2; exit 1 ;;
esac
case "$backup_docker_platform" in
  ""|*[!A-Za-z0-9_./-]*) echo "Backup metadata contains an invalid Docker platform" >&2; exit 1 ;;
esac
verification_docker_platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
test "$verification_docker_platform" = "$backup_docker_platform" || {
  echo "Backup verification requires Docker platform '$backup_docker_platform', found '$verification_docker_platform'" >&2
  exit 1
}
operations_lock_held=false
operations_lock_root=${OPERATIONS_LOCK_ROOT:?Set OPERATIONS_LOCK_ROOT to the stable private host lock directory}
case "$operations_lock_root" in
  /*) ;;
  *) echo "OPERATIONS_LOCK_ROOT must be absolute" >&2; exit 2 ;;
esac
case "$operations_lock_root" in
  /|/tmp|/run|/run/lock)
    echo "OPERATIONS_LOCK_ROOT must be a dedicated private subdirectory" >&2
    exit 1
    ;;
esac
test ! -L "$operations_lock_root" && test -d "$operations_lock_root" || {
  echo "OPERATIONS_LOCK_ROOT must be an existing non-symlink directory" >&2
  exit 1
}
test "$(stat -c %u "$operations_lock_root")" = "$(id -u)" &&
  test "$(stat -c %a "$operations_lock_root")" = 700 || {
  echo "OPERATIONS_LOCK_ROOT must be owned by the deployment user with mode 0700" >&2
  exit 1
}
command -v flock >/dev/null 2>&1 || {
  echo "The util-linux flock command is required for backup verification" >&2
  exit 1
}
operations_lock="$operations_lock_root/camping-drive-$backup_project_name.operations.lock"
if [ "${VERIFY_OPERATIONS_LOCK_HELD:-}" = yes ]; then
  inherited_lock=$(readlink "/proc/$$/fd/9" 2>/dev/null || readlink /dev/fd/9 2>/dev/null || true)
  test "$inherited_lock" = "$operations_lock" || {
    echo "Backup verifier did not inherit the expected project operations lock on fd 9" >&2
    exit 1
  }
  flock -n 9 || {
    echo "Inherited operations lock is not held by the restore process" >&2
    exit 1
  }
else
  if [ -e "$operations_lock" ] && { [ -L "$operations_lock" ] || [ ! -f "$operations_lock" ]; }; then
    echo "The operations lock must be a regular non-symlink file" >&2
    exit 1
  fi
  exec 9>"$operations_lock"
  flock -n 9 || {
    echo "Another backup, restore, deployment or verification is running for Compose project $backup_project_name" >&2
    exit 1
  }
  operations_lock_held=true
fi

work_dir=$(mktemp -d)
verify_container="camping-drive-backup-verify-$$"
verify_volume="camping-drive-backup-verify-data-$$"
image_mappings="$work_dir/original-image-mappings.txt"
images_loaded=false
: > "$image_mappings"
while read -r image _image_id; do
  original_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)
  test -n "$original_id" || original_id=-
  printf '%s\t%s\n' "$image" "$original_id" >> "$image_mappings"
done < "$backup_dir/images.txt"
cleanup() {
  cleanup_status=$?
  trap - EXIT INT TERM
  docker rm -f "$verify_container" >/dev/null 2>&1 || true
  docker volume rm -f "$verify_volume" >/dev/null 2>&1 || true
  if [ "$images_loaded" = true ]; then
    while IFS="$(printf '\t')" read -r image original_id; do
      if [ "$original_id" = - ]; then
        if docker image inspect "$image" >/dev/null 2>&1; then
          docker image rm "$image" >/dev/null 2>&1 || cleanup_status=1
        fi
        if docker image inspect "$image" >/dev/null 2>&1; then
          echo "CRITICAL: backup verification left a newly-created image reference: $image" >&2
          cleanup_status=1
        fi
      else
        docker image tag "$original_id" "$image" >/dev/null 2>&1 || {
          echo "CRITICAL: could not restore original image mapping for $image" >&2
          cleanup_status=1
        }
        restored_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)
        if [ "$restored_id" != "$original_id" ]; then
          echo "CRITICAL: original image mapping was not restored for $image" >&2
          cleanup_status=1
        fi
      fi
    done < "$image_mappings"
  fi
  rm -rf "$work_dir"
  if [ "$operations_lock_held" = true ]; then
    flock -u 9 || cleanup_status=1
    exec 9>&-
    operations_lock_held=false
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

postgres_image=$(awk '$1 ~ /^camping-drive-postgres:/ { print $1; exit }' "$backup_dir/images.txt")
postgres_image_id=$(awk '$1 ~ /^camping-drive-postgres:/ { print $2; exit }' "$backup_dir/images.txt")
test -n "$postgres_image" && test -n "$postgres_image_id" || {
  echo "Backup does not contain its PostgreSQL verification image" >&2
  exit 1
}
load_images=false
while read -r image image_id; do
  if [ "$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)" != "$image_id" ]; then
    load_images=true
  fi
done < "$backup_dir/images.txt"
if [ "$load_images" = true ]; then
  images_loaded=true
  gzip -dc "$backup_dir/images.tar.gz" | docker image load >/dev/null
fi
test "$(docker image inspect --format '{{.Id}}' "$postgres_image")" = "$postgres_image_id" || {
  echo "PostgreSQL verification image digest does not match images.txt" >&2
  exit 1
}
while read -r image image_id; do
  test "$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)" = "$image_id" || {
    echo "Archived image digest does not match after load: $image" >&2
    exit 1
  }
done < "$backup_dir/images.txt"

database_owner=$(sed -n 's/^database_owner=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_name=$(sed -n 's/^database_name=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_size_bytes=$(sed -n 's/^database_size_bytes=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_encoding=$(sed -n 's/^database_encoding=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_collate=$(sed -n 's/^database_collate=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_ctype=$(sed -n 's/^database_ctype=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_locale_provider=$(sed -n 's/^database_locale_provider=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_tablespace=$(sed -n 's/^database_tablespace=//p' "$backup_dir/metadata.txt" | tail -n 1)
database_connection_limit=$(sed -n 's/^database_connection_limit=//p' "$backup_dir/metadata.txt" | tail -n 1)
uploads_size_bytes=$(sed -n 's/^uploads_size_bytes=//p' "$backup_dir/metadata.txt" | tail -n 1)
caddy_state_included=$(sed -n 's/^caddy_state_included=//p' "$backup_dir/metadata.txt" | tail -n 1)
caddy_data_size_bytes=$(sed -n 's/^caddy_data_size_bytes=//p' "$backup_dir/metadata.txt" | tail -n 1)
caddy_config_size_bytes=$(sed -n 's/^caddy_config_size_bytes=//p' "$backup_dir/metadata.txt" | tail -n 1)
case "$database_owner" in
  ""|[0-9]*|*[!A-Za-z0-9_]*) echo "Backup metadata contains an invalid database owner" >&2; exit 1 ;;
esac
test "${#database_owner}" -le 63 || {
  echo "Backup metadata database owner is too long" >&2
  exit 1
}
case "$database_name" in
  ""|-*|*[!A-Za-z0-9_-]*) echo "Backup metadata contains an invalid database name" >&2; exit 1 ;;
esac
test "${#database_name}" -le 63 || {
  echo "Backup metadata database name is too long" >&2
  exit 1
}
case "$database_size_bytes" in
  ""|*[!0-9]*) echo "Backup metadata contains an invalid database size" >&2; exit 1 ;;
esac
case "$database_encoding" in
  ""|*[!A-Za-z0-9_-]*) echo "Backup metadata contains an invalid database encoding" >&2; exit 1 ;;
esac
test "$database_locale_provider" = c && test "$database_tablespace" = pg_default || {
  echo "Backup metadata contains unsupported database locale-provider or tablespace settings" >&2
  exit 1
}
case "$database_connection_limit" in
  -1) ;;
  ""|*[!0-9]*) echo "Backup metadata contains an invalid database connection limit" >&2; exit 1 ;;
  *) ;;
esac
case "$uploads_size_bytes" in
  ""|*[!0-9]*) echo "Backup metadata contains an invalid uploads size" >&2; exit 1 ;;
esac
test -n "$database_collate" && test -n "$database_ctype" || {
  echo "Backup metadata does not contain database locale settings" >&2
  exit 1
}
case "$caddy_state_included" in
  yes|no) ;;
  *) echo "Backup metadata contains an invalid caddy_state_included value" >&2; exit 1 ;;
esac
case "$caddy_data_size_bytes:$caddy_config_size_bytes" in
  :|:*|*:) echo "Backup metadata contains invalid Caddy state sizes" >&2; exit 1 ;;
  *[!0-9:]*) echo "Backup metadata contains invalid Caddy state sizes" >&2; exit 1 ;;
esac
tar -tzf "$backup_dir/uploads.tar.gz" > "$work_dir/archive-paths.txt"
tar -tzf "$backup_dir/caddy-data.tar.gz" > "$work_dir/caddy-data-paths.txt"
tar -tzf "$backup_dir/caddy-config.tar.gz" > "$work_dir/caddy-config-paths.txt"
while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..|..) echo "Unsafe uploads archive path: $entry" >&2; exit 1 ;;
  esac
done < "$work_dir/archive-paths.txt"
for manifest in "$work_dir/caddy-data-paths.txt" "$work_dir/caddy-config-paths.txt"; do
  while IFS= read -r entry; do
    case "$entry" in
      /*|../*|*/../*|*/..|..) echo "Unsafe Caddy archive path: $entry" >&2; exit 1 ;;
    esac
  done < "$manifest"
done

uploads_free_kb=$(df -Pk "$work_dir" | awk 'NR == 2 { print $4 }')
case "$uploads_free_kb" in
  ""|*[!0-9]*) echo "Backup verification could not determine free temporary storage" >&2; exit 1 ;;
esac
required_uploads_kb=$(((uploads_size_bytes + caddy_data_size_bytes + caddy_config_size_bytes + 1023) / 1024 + 65536))
test "$uploads_free_kb" -ge "$required_uploads_kb" || {
  echo "Backup verification storage has ${uploads_free_kb} KiB free; ${required_uploads_kb} KiB is required for uploads" >&2
  exit 1
}

mkdir "$work_dir/uploads"
tar -xzf "$backup_dir/uploads.tar.gz" -C "$work_dir/uploads"
if find "$work_dir/uploads" -type l | grep -q .; then
  echo "Uploads archive must not contain symbolic links" >&2
  exit 1
fi
if [ -s "$backup_dir/uploads-manifest.sha256" ]; then
  (cd "$work_dir/uploads" && sha256sum -c "$backup_dir/uploads-manifest.sha256")
elif find "$work_dir/uploads" -type f | grep -q .; then
  echo "Uploads checksum manifest is empty but the archive contains files" >&2
  exit 1
fi
restored_uploads_size_bytes=$(find "$work_dir/uploads" -type f -exec stat -c %s {} \; | awk '{ total += $1 } END { print total + 0 }')
test "$restored_uploads_size_bytes" = "$uploads_size_bytes" || {
  echo "Uploads archive size does not match backup metadata" >&2
  exit 1
}

mkdir "$work_dir/caddy-data" "$work_dir/caddy-config"
tar -xzf "$backup_dir/caddy-data.tar.gz" -C "$work_dir/caddy-data"
tar -xzf "$backup_dir/caddy-config.tar.gz" -C "$work_dir/caddy-config"
if find "$work_dir/caddy-data" "$work_dir/caddy-config" -type l | grep -q .; then
  echo "Caddy state archives must not contain symbolic links" >&2
  exit 1
fi
if [ -s "$backup_dir/caddy-data-manifest.sha256" ]; then
  (cd "$work_dir/caddy-data" && sha256sum -c "$backup_dir/caddy-data-manifest.sha256")
elif find "$work_dir/caddy-data" -type f | grep -q .; then
  echo "Caddy data manifest is empty but the archive contains files" >&2
  exit 1
fi
if [ -s "$backup_dir/caddy-config-manifest.sha256" ]; then
  (cd "$work_dir/caddy-config" && sha256sum -c "$backup_dir/caddy-config-manifest.sha256")
elif find "$work_dir/caddy-config" -type f | grep -q .; then
  echo "Caddy config manifest is empty but the archive contains files" >&2
  exit 1
fi
restored_caddy_data_size_bytes=$(find "$work_dir/caddy-data" -type f -exec stat -c %s {} \; | awk '{ total += $1 } END { print total + 0 }')
restored_caddy_config_size_bytes=$(find "$work_dir/caddy-config" -type f -exec stat -c %s {} \; | awk '{ total += $1 } END { print total + 0 }')
test "$restored_caddy_data_size_bytes:$restored_caddy_config_size_bytes" = "$caddy_data_size_bytes:$caddy_config_size_bytes" || {
  echo "Caddy state archive sizes do not match backup metadata" >&2
  exit 1
}

while IFS= read -r media_path; do
  test -z "$media_path" && continue
  case "$media_path" in
    /*|../*|*/../*|*/..|..) echo "Unsafe database media path: $media_path" >&2; exit 1 ;;
  esac
  test -f "$work_dir/uploads/$media_path" || {
    echo "Database references a missing upload: $media_path" >&2
    exit 1
  }
done < "$backup_dir/database-media-paths.txt"

docker volume create "$verify_volume" >/dev/null
docker run -d --rm --name "$verify_container" \
  --memory 768m --cpus 1 --pids-limit 256 \
  -v "$verify_volume:/var/lib/postgresql/data" \
  -e POSTGRES_USER="$database_owner" \
  -e POSTGRES_DB="$database_name" \
  -e POSTGRES_PASSWORD=backup-verification-only \
  "$postgres_image" >/dev/null

ready=false
for _attempt in $(seq 1 30); do
  if docker logs "$verify_container" 2>&1 |
    grep -q 'PostgreSQL init process complete; ready for start up' &&
    docker exec "$verify_container" pg_isready -U "$database_owner" -d "$database_name" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true || {
  echo "Temporary PostgreSQL did not become ready" >&2
  exit 1
}
docker exec -i "$verify_container" \
  psql -U "$database_owner" -d postgres --set=ON_ERROR_STOP=1 \
  --set=target_database="$database_name" \
  --set=connection_limit="$database_connection_limit" <<'SQL'
SELECT format(
  'ALTER DATABASE %I CONNECTION LIMIT %s',
  :'target_database',
  :'connection_limit'
)
\gexec
SQL
actual_database_definition=$(docker exec "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --tuples-only --no-align --field-separator='|' --set=ON_ERROR_STOP=1 \
  --command="SELECT pg_encoding_to_char(database.encoding), database.datcollate, database.datctype, database.datlocprovider, tablespace.spcname, database.datconnlimit FROM pg_database AS database JOIN pg_tablespace AS tablespace ON tablespace.oid = database.dattablespace WHERE database.datname = current_database()")
expected_database_definition="$database_encoding|$database_collate|$database_ctype|$database_locale_provider|$database_tablespace|$database_connection_limit"
test "$actual_database_definition" = "$expected_database_definition" || {
  echo "Temporary PostgreSQL cannot reproduce the backed-up database definition" >&2
  echo "Expected: $expected_database_definition" >&2
  echo "Actual:   $actual_database_definition" >&2
  exit 1
}
database_free_kb=$(docker exec "$verify_container" sh -eu -c \
  'df -Pk "$PGDATA" | awk "NR == 2 { print \$4 }"')
case "$database_free_kb" in
  ""|*[!0-9]*) echo "Backup verification could not determine free PostgreSQL storage" >&2; exit 1 ;;
esac
source_database_kb=$(((database_size_bytes + 1023) / 1024))
required_database_kb=$((source_database_kb * 2 + 524288))
test "$database_free_kb" -ge "$required_database_kb" || {
  echo "Backup verification storage has ${database_free_kb} KiB free; ${required_database_kb} KiB is required" >&2
  exit 1
}

docker exec -i "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --set=ON_ERROR_STOP=1 \
  < "$backup_dir/cluster-globals.sql"

docker exec -i "$verify_container" \
  pg_restore -U "$database_owner" -d "$database_name" --no-owner --exit-on-error \
  < "$backup_dir/database.dump"

docker exec -i "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --set=ON_ERROR_STOP=1 \
  --set=target_database="$database_name" \
  < "$backup_dir/database-privileges.sql"

docker exec -i "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  > "$work_dir/restored-database-privileges.sql" <<'SQL'
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
diff -u "$backup_dir/database-privileges.sql" "$work_dir/restored-database-privileges.sql"

docker exec "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT name || ' ' || checksum FROM schema_migrations ORDER BY name" \
  > "$work_dir/restored-schema-migrations.txt"
diff -u "$backup_dir/schema-migrations.txt" "$work_dir/restored-schema-migrations.txt"

docker exec "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT storage_path FROM images UNION SELECT variant.value->>'storagePath' FROM images CROSS JOIN LATERAL jsonb_each(images.variants) AS variant WHERE jsonb_typeof(variant.value) = 'object' AND variant.value->>'storagePath' IS NOT NULL ORDER BY 1" \
  > "$work_dir/restored-media-paths.txt"
diff -u "$backup_dir/database-media-paths.txt" "$work_dir/restored-media-paths.txt"

docker exec "$verify_container" \
  psql -U "$database_owner" -d "$database_name" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT 'ROLE' || chr(9) || rolname || chr(9) || rolsuper || chr(9) || rolinherit || chr(9) || rolcreaterole || chr(9) || rolcreatedb || chr(9) || rolcanlogin || chr(9) || rolreplication || chr(9) || rolconnlimit || chr(9) || rolbypassrls || chr(9) || COALESCE(rolpassword, '') FROM pg_authid WHERE rolname !~ '^pg_' UNION ALL SELECT 'MEMBER' || chr(9) || parent.rolname || chr(9) || member.rolname || chr(9) || membership.admin_option FROM pg_auth_members AS membership JOIN pg_roles AS parent ON parent.oid = membership.roleid JOIN pg_roles AS member ON member.oid = membership.member WHERE parent.rolname !~ '^pg_' OR member.rolname !~ '^pg_' ORDER BY 1" \
  > "$work_dir/restored-cluster-roles.txt"
diff -u "$backup_dir/cluster-roles.txt" "$work_dir/restored-cluster-roles.txt"

echo "Backup restore and media integrity verified: $backup_dir"
