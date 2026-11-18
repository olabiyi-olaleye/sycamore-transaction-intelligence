#!/bin/sh
# Run once by the postgres image on first start (docker-entrypoint-initdb.d).
set -e
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_password="${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}" \
  -v system_password="${SYSTEM_DB_PASSWORD:?SYSTEM_DB_PASSWORD is required}" \
  -v db_name="$POSTGRES_DB" \
  -f /sycamore-init/roles.sql
