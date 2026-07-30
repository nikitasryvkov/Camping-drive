#!/bin/sh
set -eu

action=${1:?Usage: scripts/compose-mutation.sh build|deploy|migrate|admin-create|rotate-owner-password|rotate-runtime-password|start-traffic}
shift
test "$#" -eq 0 || {
  echo "compose-mutation.sh does not accept additional Compose arguments" >&2
  exit 2
}

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

resolved_environment=$(compose config --environment)
environment_value() {
  printf '%s\n' "$resolved_environment" | sed -n "s/^$1=//p" | tail -n 1
}
site_domain=$(environment_value SITE_DOMAIN)
public_site_url=$(environment_value PUBLIC_SITE_URL)
vite_site_url=$(environment_value VITE_SITE_URL)
public_origins=$(environment_value PUBLIC_ORIGINS)
postgres_password=$(environment_value POSTGRES_PASSWORD)
app_database_password=$(environment_value APP_DB_PASSWORD)
postgres_database=$(environment_value POSTGRES_DB)
postgres_user=$(environment_value POSTGRES_USER)
app_database_user=$(environment_value APP_DB_USER)
image_tag=$(environment_value IMAGE_TAG)
release_commit=$(environment_value RELEASE_COMMIT)
release_manifest_sha256=$(environment_value RELEASE_MANIFEST_SHA256)

case "$site_domain" in
  ""|.*|*..*|*.|*[!A-Za-z0-9.-]*) echo "SITE_DOMAIN must be a plain DNS hostname" >&2; exit 1 ;;
esac
expected_site_url="https://$site_domain"
test "$public_site_url" = "$expected_site_url" || {
  echo "PUBLIC_SITE_URL must equal https://SITE_DOMAIN" >&2
  exit 1
}
test "$vite_site_url" = "$expected_site_url" || {
  echo "VITE_SITE_URL must equal PUBLIC_SITE_URL" >&2
  exit 1
}
origin_present=false
previous_ifs=$IFS
IFS=,
for origin in $public_origins; do
  origin=$(printf '%s' "$origin" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  test "$origin" = "$public_site_url" && origin_present=true
done
IFS=$previous_ifs
test "$origin_present" = true || {
  echo "PUBLIC_ORIGINS must include PUBLIC_SITE_URL" >&2
  exit 1
}
for secret_name in POSTGRES_PASSWORD APP_DB_PASSWORD; do
  secret_value=$(environment_value "$secret_name")
  test "${#secret_value}" -ge 24 || {
    echo "$secret_name must contain at least 24 characters" >&2
    exit 1
  }
  normalized_secret=$(printf '%s' "$secret_value" | tr '[:upper:]' '[:lower:]')
  case "$normalized_secret" in
    *replace-with*|*changeme*|*example*password*|*placeholder*)
      echo "$secret_name contains a known placeholder" >&2
      exit 1
      ;;
  esac
done
test "$postgres_password" != "$app_database_password" || {
  echo "POSTGRES_PASSWORD and APP_DB_PASSWORD must be different" >&2
  exit 1
}
case "$postgres_database" in
  ""|-*|*[!A-Za-z0-9_-]*) echo "POSTGRES_DB contains unsupported characters" >&2; exit 1 ;;
esac
test "${#postgres_database}" -le 63 || {
  echo "POSTGRES_DB must contain at most 63 characters" >&2
  exit 1
}
normalized_database=$(printf '%s' "$postgres_database" | tr '[:upper:]' '[:lower:]')
case "$normalized_database" in
  postgres|template0|template1) echo "POSTGRES_DB must name a dedicated application database" >&2; exit 1 ;;
esac
for role_variable in POSTGRES_USER APP_DB_USER; do
  role_value=$(environment_value "$role_variable")
  case "$role_value" in
    ""|[0-9]*|*[!A-Za-z0-9_]*) echo "$role_variable must be a valid PostgreSQL role name" >&2; exit 1 ;;
  esac
  test "${#role_value}" -le 63 || {
    echo "$role_variable must contain at most 63 characters" >&2
    exit 1
  }
  normalized_role=$(printf '%s' "$role_value" | tr '[:upper:]' '[:lower:]')
  case "$normalized_role" in
    public|none|pg_*) echo "$role_variable must not use a reserved or predefined PostgreSQL role name" >&2; exit 1 ;;
  esac
done
test "$postgres_user" != "$app_database_user" || {
  echo "POSTGRES_USER and APP_DB_USER must be different" >&2
  exit 1
}
case "$image_tag" in
  ""|latest|*[!A-Za-z0-9._-]*) echo "IMAGE_TAG must be immutable and filesystem-safe" >&2; exit 1 ;;
esac

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
  echo "The util-linux flock command is required for deployment and maintenance locking" >&2
  exit 1
}
operations_lock="$operations_lock_root/camping-drive-$project_name.operations.lock"
if [ -e "$operations_lock" ] && { [ -L "$operations_lock" ] || [ ! -f "$operations_lock" ]; }; then
  echo "The operations lock must be a regular non-symlink file" >&2
  exit 1
fi
exec 9>"$operations_lock"
flock -n 9 || {
  echo "Another backup, restore, deployment or maintenance mutation is running for Compose project $project_name" >&2
  exit 1
}

release_manifests_root="$operations_lock_root/releases"
release_manifest_directory="$release_manifests_root/$project_name"
release_manifest_file="$release_manifest_directory/$image_tag.manifest"

require_clean_release_checkout() {
  command -v git >/dev/null 2>&1 || {
    echo "Git is required to bind a release to its reviewed commit" >&2
    exit 1
  }
  printf '%s\n' "$release_commit" | grep -Eq '^[0-9a-f]{40}$' || {
    echo "RELEASE_COMMIT must be the full 40-character commit SHA that passed CI" >&2
    exit 1
  }
  repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "Release actions must run inside the reviewed Git checkout" >&2
    exit 1
  }
  repository_root=$(CDPATH= cd -- "$repository_root" && pwd -P)
  test "$(pwd -P)" = "$repository_root" || {
    echo "Release actions must run from the reviewed repository root" >&2
    exit 1
  }
  current_commit=$(git rev-parse --verify HEAD^{commit})
  test "$current_commit" = "$release_commit" || {
    echo "Release refused: HEAD does not match RELEASE_COMMIT" >&2
    exit 1
  }
  test -z "$(git status --porcelain --untracked-files=normal --ignore-submodules=none)" || {
    echo "Release refused: the Git checkout contains tracked or untracked changes" >&2
    exit 1
  }
}

release_images() {
  compose config --images | LC_ALL=C sort -u
}

require_coordinated_image_set() {
  images=$1
  expected_image_count=3
  expected_image_names="backend frontend postgres"
  if printf '%s\n' "$images" | grep -Fxq "camping-drive-caddy:$image_tag"; then
    expected_image_count=4
    expected_image_names="$expected_image_names caddy"
  fi
  test "$(printf '%s\n' "$images" | grep -c .)" = "$expected_image_count" || {
    echo "Release contains an unexpected image set for the selected topology" >&2
    exit 1
  }
  for image_name in $expected_image_names; do
    printf '%s\n' "$images" | grep -Fxq "camping-drive-$image_name:$image_tag" || {
      echo "Release image set is missing camping-drive-$image_name:$image_tag" >&2
      exit 1
    }
  done
}

write_release_manifest() {
  require_clean_release_checkout
  images=$(release_images)
  require_coordinated_image_set "$images"
  test ! -e "$release_manifest_file" || {
    echo "Build refused: immutable release manifest already exists: $release_manifest_file" >&2
    exit 1
  }
  if [ ! -e "$release_manifests_root" ]; then
    (umask 077 && mkdir "$release_manifests_root")
  fi
  test ! -L "$release_manifests_root" &&
    test -d "$release_manifests_root" &&
    test "$(stat -c %u "$release_manifests_root")" = "$(id -u)" &&
    test "$(stat -c %a "$release_manifests_root")" = 700 || {
      echo "Release manifests root must be owned by the deployment user with mode 0700" >&2
      exit 1
    }
  if [ ! -e "$release_manifest_directory" ]; then
    (umask 077 && mkdir "$release_manifest_directory")
  fi
  test ! -L "$release_manifest_directory" &&
    test -d "$release_manifest_directory" &&
    test "$(stat -c %u "$release_manifest_directory")" = "$(id -u)" &&
    test "$(stat -c %a "$release_manifest_directory")" = 700 || {
      echo "Release manifest directory must be owned by the deployment user with mode 0700" >&2
      exit 1
    }
  manifest_temporary="$release_manifest_file.$$.partial"
  test ! -e "$manifest_temporary" || {
    echo "Temporary release manifest already exists: $manifest_temporary" >&2
    exit 1
  }
  compose_file_sha256=$(sha256sum "$compose_file" | awk '{print $1}')
  if ! (
    umask 077
    {
      printf 'format=1\n'
      printf 'commit=%s\n' "$release_commit"
      printf 'image_tag=%s\n' "$image_tag"
      printf 'public_site_url=%s\n' "$public_site_url"
      printf 'compose_file_sha256=%s\n' "$compose_file_sha256"
      for image in $images; do
        image_id=$(docker image inspect --format '{{.Id}}' "$image")
        image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
        test "$image_revision" = "$release_commit" || {
          echo "Image revision label does not match RELEASE_COMMIT: $image" >&2
          exit 1
        }
        printf 'image=%s|%s\n' "$image" "$image_id"
      done
    } > "$manifest_temporary"
  ); then
    rm -f "$manifest_temporary"
    exit 1
  fi
  chmod 600 "$manifest_temporary"
  mv "$manifest_temporary" "$release_manifest_file"
  manifest_sha256=$(sha256sum "$release_manifest_file" | awk '{print $1}')
  echo "Release manifest created: $release_manifest_file"
  echo "After green CI for commit $release_commit, set RELEASE_MANIFEST_SHA256=$manifest_sha256 for deploy and maintenance."
}

verify_release_manifest() {
  require_clean_release_checkout
  printf '%s\n' "$release_manifest_sha256" | grep -Eq '^[0-9a-f]{64}$' || {
    echo "RELEASE_MANIFEST_SHA256 must be the approved SHA-256 printed by the locked build" >&2
    exit 1
  }
  test ! -L "$release_manifest_file" && test -f "$release_manifest_file" || {
    echo "Approved release manifest is missing or unsafe: $release_manifest_file" >&2
    exit 1
  }
  test "$(stat -c %u "$release_manifest_file")" = "$(id -u)" &&
    test "$(stat -c %a "$release_manifest_file")" = 600 || {
      echo "Release manifest must be owned by the deployment user with mode 0600" >&2
      exit 1
    }
  actual_manifest_sha256=$(sha256sum "$release_manifest_file" | awk '{print $1}')
  test "$actual_manifest_sha256" = "$release_manifest_sha256" || {
    echo "Release refused: manifest SHA-256 does not match the approved value" >&2
    exit 1
  }
  test "$(grep -c '^format=' "$release_manifest_file")" = 1 &&
    test "$(sed -n 's/^format=//p' "$release_manifest_file")" = 1 &&
    test "$(grep -c '^commit=' "$release_manifest_file")" = 1 &&
    test "$(sed -n 's/^commit=//p' "$release_manifest_file")" = "$release_commit" &&
    test "$(grep -c '^image_tag=' "$release_manifest_file")" = 1 &&
    test "$(sed -n 's/^image_tag=//p' "$release_manifest_file")" = "$image_tag" &&
    test "$(grep -c '^public_site_url=' "$release_manifest_file")" = 1 &&
    test "$(sed -n 's/^public_site_url=//p' "$release_manifest_file")" = "$public_site_url" || {
      echo "Release refused: manifest metadata does not match the requested release" >&2
      exit 1
    }
  compose_file_sha256=$(sha256sum "$compose_file" | awk '{print $1}')
  test "$(grep -c '^compose_file_sha256=' "$release_manifest_file")" = 1 &&
    test "$(sed -n 's/^compose_file_sha256=//p' "$release_manifest_file")" = "$compose_file_sha256" || {
      echo "Release refused: Compose file differs from the approved manifest" >&2
      exit 1
    }
  images=$(release_images)
  require_coordinated_image_set "$images"
  expected_image_count=$(printf '%s\n' "$images" | grep -c .)
  test "$(grep -c '^image=' "$release_manifest_file")" = "$expected_image_count" || {
    echo "Release refused: manifest image count does not match the selected topology" >&2
    exit 1
  }
  for image in $images; do
    image_id=$(docker image inspect --format '{{.Id}}' "$image")
    image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
    test "$image_revision" = "$release_commit" || {
      echo "Release refused: image revision label does not match RELEASE_COMMIT: $image" >&2
      exit 1
    }
    test "$(grep -Fxc "image=$image|$image_id" "$release_manifest_file")" = 1 || {
      echo "Release refused: local image ID is not approved by the release manifest: $image" >&2
      exit 1
    }
  done
}

require_release_images() {
  missing_release_images=false
  for image in $(release_images); do
    docker image inspect "$image" >/dev/null 2>&1 || {
      echo "Immutable release image is missing locally: $image" >&2
      missing_release_images=true
    }
  done
  test "$missing_release_images" = false || return 1
  verify_release_manifest
}

database_password_authenticates() {
  database_role=$1
  candidate_password=$2
  PGPASSWORD=$candidate_password compose exec -T -e PGPASSWORD db \
    psql --host=127.0.0.1 --username="$database_role" --dbname="$postgres_database" \
    --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="SELECT current_user" \
    >/dev/null 2>&1
}

rotate_database_password() {
  database_role=$1
  previous_password=$2
  replacement_password=$3
  affected_service=$4
  test "$previous_password" != "$replacement_password" || {
    echo "Replacement password must differ from the current database password" >&2
    exit 1
  }
  database_password_authenticates "$database_role" "$previous_password" || {
    echo "Rotation refused: the supplied previous password does not authenticate" >&2
    exit 1
  }
  ROTATION_ROLE=$database_role ROTATION_PASSWORD=$replacement_password \
    compose exec -T -e ROTATION_ROLE -e ROTATION_PASSWORD db sh -eu -c \
      'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
        --set=target_role="$ROTATION_ROLE" --set=replacement_password="$ROTATION_PASSWORD"' <<'SQL'
SELECT format(
  'ALTER ROLE %I PASSWORD %L',
  :'target_role',
  :'replacement_password'
)
\gexec
SQL
  database_password_authenticates "$database_role" "$replacement_password" || {
    echo "Rotation failed: replacement password does not authenticate" >&2
    exit 1
  }
  if database_password_authenticates "$database_role" "$previous_password"; then
    echo "Rotation failed: previous password still authenticates" >&2
    exit 1
  fi
  case "$affected_service" in
    db)
      backend_was_running=false
      compose ps --services --status running | grep -qx backend && backend_was_running=true
      compose up -d --wait --no-deps --force-recreate --no-build --pull never db
      if [ "$backend_was_running" = true ]; then
        backend_recovered=false
        for _attempt in $(seq 1 60); do
          backend_container=$(compose ps -q backend)
          if [ -n "$backend_container" ] &&
            [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$backend_container")" = healthy ]; then
            backend_recovered=true
            break
          fi
          sleep 1
        done
        test "$backend_recovered" = true || {
          echo "Rotation failed: the previously running backend did not recover after the database restart" >&2
          exit 1
        }
      fi
      ;;
    backend)
      if compose ps --services --status running | grep -qx backend; then
        compose up -d --wait --no-deps --force-recreate --no-build --pull never backend
      fi
      ;;
    *) echo "Internal error: unsupported password consumer '$affected_service'" >&2; exit 1 ;;
  esac
}

case "$action" in
  build)
    require_clean_release_checkout
    test ! -e "$release_manifest_file" || {
      echo "Build refused: immutable release manifest already exists: $release_manifest_file" >&2
      exit 1
    }
    build_services="backend frontend db"
    build_image_names="backend frontend postgres"
    if compose config --services | grep -qx caddy; then
      build_services="$build_services caddy"
      build_image_names="$build_image_names caddy"
    fi
    compose_file_relative=${compose_file#./}
    case "$compose_file_relative" in
      ""|/*|../*|*/../*|*/..)
        echo "Build requires a tracked Compose file inside the reviewed repository" >&2
        exit 1
        ;;
    esac
    git ls-files --error-unmatch "$compose_file_relative" >/dev/null 2>&1 || {
      echo "Build requires the selected Compose file to be tracked by Git" >&2
      exit 1
    }
    build_contexts_root="$operations_lock_root/build-contexts"
    immutable_build_context=
    for image_name in $build_image_names; do
      final_reference="camping-drive-$image_name:$image_tag"
      if docker image inspect "$final_reference" >/dev/null 2>&1; then
        echo "Build refused: immutable release image already exists: $final_reference" >&2
        exit 1
      fi
    done

    temporary_tag="$image_tag.build.$$"
    temporary_references=""
    published_references=""
    build_published=false
    for image_name in $build_image_names; do
      temporary_reference="camping-drive-$image_name:$temporary_tag"
      if docker image inspect "$temporary_reference" >/dev/null 2>&1; then
        echo "Build refused: temporary image reference already exists: $temporary_reference" >&2
        exit 1
      fi
      temporary_references="$temporary_references $temporary_reference"
    done
    cleanup_build_references() {
      for reference in $temporary_references; do
        docker image rm "$reference" >/dev/null 2>&1 || true
      done
      if [ "$build_published" = false ]; then
        for reference in $published_references; do
          docker image rm "$reference" >/dev/null 2>&1 || true
        done
      fi
      if [ -n "$immutable_build_context" ] &&
        [ "$(dirname "$immutable_build_context")" = "$build_contexts_root" ]; then
        rm -rf "$immutable_build_context"
      fi
    }
    trap cleanup_build_references EXIT
    trap 'exit 130' INT TERM

    if [ ! -e "$build_contexts_root" ]; then
      (umask 077 && mkdir "$build_contexts_root")
    fi
    test ! -L "$build_contexts_root" &&
      test -d "$build_contexts_root" &&
      test "$(stat -c %u "$build_contexts_root")" = "$(id -u)" &&
      test "$(stat -c %a "$build_contexts_root")" = 700 || {
        echo "Immutable build-context root must be owned by the deployment user with mode 0700" >&2
        exit 1
      }
    immutable_build_context="$build_contexts_root/$project_name-$image_tag.$$"
    test ! -e "$immutable_build_context" || {
      echo "Immutable build context already exists: $immutable_build_context" >&2
      exit 1
    }
    (umask 077 && mkdir "$immutable_build_context")
    git archive --format=tar --output="$immutable_build_context/source.tar" "$release_commit"
    tar -xf "$immutable_build_context/source.tar" -C "$immutable_build_context"
    rm "$immutable_build_context/source.tar"
    test -f "$immutable_build_context/$compose_file_relative" || {
      echo "Reviewed commit does not contain the selected Compose file" >&2
      exit 1
    }
    immutable_compose() {
      RELEASE_COMMIT=$release_commit IMAGE_TAG=$temporary_tag \
      docker compose --env-file "$env_file" \
        -f "$immutable_build_context/$compose_file_relative" "$@"
    }
    immutable_compose build --pull $build_services
    for image_name in $build_image_names; do
      temporary_reference="camping-drive-$image_name:$temporary_tag"
      docker image inspect "$temporary_reference" >/dev/null 2>&1 || {
        echo "Build failed to produce expected image: $temporary_reference" >&2
        exit 1
      }
    done
    for image_name in $build_image_names; do
      temporary_reference="camping-drive-$image_name:$temporary_tag"
      final_reference="camping-drive-$image_name:$image_tag"
      docker image tag "$temporary_reference" "$final_reference"
      published_references="$published_references $final_reference"
    done
    write_release_manifest
    build_published=true
    cleanup_build_references
    trap - EXIT INT TERM
    ;;
  deploy)
    require_release_images || {
      echo "Deploy refused because the coordinated release image set is incomplete" >&2
      exit 1
    }
    compose up -d --wait --remove-orphans --no-build --pull never
    ;;
  migrate)
    require_release_images || exit 1
    compose up -d --wait --no-build --pull never db
    compose run --rm --no-deps --pull never migrate
    ;;
  admin-create)
    test -n "${ADMIN_LOGIN:-}" && test -n "${ADMIN_PASSWORD:-}" || {
      echo "ADMIN_LOGIN and ADMIN_PASSWORD are required for admin-create" >&2
      exit 2
    }
    require_release_images || exit 1
    compose --profile maintenance run --rm --no-deps --pull never \
      -e ADMIN_LOGIN -e ADMIN_PASSWORD admin-create
    ;;
  rotate-owner-password)
    test "${ROTATE_CONFIRM:-}" = rotate-owner-password || {
      echo "Set ROTATE_CONFIRM=rotate-owner-password after updating POSTGRES_PASSWORD in the protected environment file" >&2
      exit 2
    }
    previous_password=${PREVIOUS_POSTGRES_PASSWORD:?Set PREVIOUS_POSTGRES_PASSWORD only in the process environment}
    require_release_images || exit 1
    rotate_database_password "$postgres_user" "$previous_password" "$postgres_password" db
    echo "Owner password rotated and services are healthy. Create and verify a new coordinated backup."
    ;;
  rotate-runtime-password)
    test "${ROTATE_CONFIRM:-}" = rotate-runtime-password || {
      echo "Set ROTATE_CONFIRM=rotate-runtime-password after updating APP_DB_PASSWORD in the protected environment file" >&2
      exit 2
    }
    previous_password=${PREVIOUS_APP_DB_PASSWORD:?Set PREVIOUS_APP_DB_PASSWORD only in the process environment}
    require_release_images || exit 1
    rotate_database_password "$app_database_user" "$previous_password" "$app_database_password" backend
    echo "Runtime password rotated and services are healthy. Create and verify a new coordinated backup."
    ;;
  start-traffic)
    compose config --services | grep -qx caddy || {
      echo "This Compose target has no managed Caddy service; resume the external proxy through its own locked runbook" >&2
      exit 1
    }
    require_release_images || exit 1
    compose up -d --wait --no-build --pull never caddy
    ;;
  *)
    echo "Unknown action '$action'; use build, deploy, migrate, admin-create, rotate-owner-password, rotate-runtime-password or start-traffic" >&2
    exit 2
    ;;
esac
