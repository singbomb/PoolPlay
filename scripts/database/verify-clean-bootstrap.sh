#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repository_root="$(cd "${script_dir}/../.." && pwd)"
readonly expected_catalog="${script_dir}/expected-production-catalog.txt"
readonly container_name="poolplay-db-bootstrap-${PPID}-$$"
readonly postgres_image="postgres:17-alpine"

cleanup() {
  docker rm --force "${container_name}" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker or Colima is required to verify a clean database bootstrap." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "The Docker engine is not running. Start Docker or run: colima start" >&2
  exit 1
fi

docker run \
  --detach \
  --name "${container_name}" \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --publish 127.0.0.1::5432 \
  --mount "type=bind,source=${repository_root},target=/workspace,readonly" \
  "${postgres_image}" \
  -c wal_level=logical >/dev/null

for attempt in {1..30}; do
  if docker exec "${container_name}" pg_isready --username postgres \
    >/dev/null 2>&1; then
    break
  fi

  if [[ "${attempt}" -eq 30 ]]; then
    echo "The disposable PostgreSQL database did not become ready." >&2
    exit 1
  fi

  sleep 1
done

docker exec "${container_name}" \
  psql --username postgres --dbname postgres --file \
  /workspace/scripts/database/supabase-compat.sql

while IFS= read -r migration_file; do
  echo "Applying $(basename "${migration_file}")"
  docker exec "${container_name}" \
    psql --username postgres --dbname postgres \
    --set ON_ERROR_STOP=1 --file "${migration_file}"
done < <(
  find "${repository_root}/supabase/migrations" \
    -maxdepth 1 -type f -name '*.sql' -print | sort |
    sed "s#${repository_root}#/workspace#"
)

docker exec "${container_name}" \
  psql --username postgres --dbname postgres --file \
  /workspace/scripts/database/verify-catalog.sql

docker exec "${container_name}" \
  psql --username postgres --dbname postgres --file \
  /workspace/scripts/database/verify-rls.sql

echo "Catalog fingerprint:"
catalog_fingerprint="$(docker exec "${container_name}" \
  psql --username postgres --dbname postgres \
  --tuples-only --no-align --field-separator='|' \
  --file /workspace/scripts/database/catalog-fingerprint.sql)"
printf '%s\n' "${catalog_fingerprint}"

if ! diff --unified "${expected_catalog}" <(
  printf '%s\n' "${catalog_fingerprint}"
); then
  echo "The rebuilt catalog differs from the reviewed production snapshot." >&2
  exit 1
fi

port_binding="$(docker port "${container_name}" 5432/tcp)"
readonly port="${port_binding##*:}"

cd "${repository_root}"
POOLPLAY_BOOTSTRAP_DATABASE_URL="postgresql://postgres@127.0.0.1:${port}/postgres" \
  node --import tsx scripts/database/verify-schema.ts

POOLPLAY_BOOTSTRAP_DATABASE_URL="postgresql://postgres@127.0.0.1:${port}/postgres" \
  node --import tsx scripts/database/verify-operation-concurrency.ts

POOLPLAY_BOOTSTRAP_DATABASE_URL="postgresql://postgres@127.0.0.1:${port}/postgres" \
  node --import tsx scripts/database/verify-registration-roster-concurrency.ts

echo "Clean database bootstrap verified."
