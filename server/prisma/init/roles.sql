-- Creates the two login roles the app uses, once per database server.
-- Run as a superuser, with psql variables for the passwords:
--   psql -v app_password=... -v system_password=... -v db_name=sycamore -f roles.sql
--
-- sycamore_app     The API. Subject to row-level security, so it only ever
--                  sees the organisation set for the current transaction.
-- sycamore_system  Work that has to span organisations: the worker's claim
--                  query, the queue counts in GET /health, looking a user up
--                  by email at login, and the seed script. BYPASSRLS, but
--                  still can't change the schema.
--
-- Migrations run as the database owner, a third identity.

SELECT 'CREATE ROLE sycamore_app LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sycamore_app') \gexec
SELECT 'CREATE ROLE sycamore_system LOGIN BYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sycamore_system') \gexec

ALTER ROLE sycamore_app WITH LOGIN NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE sycamore_system WITH LOGIN BYPASSRLS PASSWORD :'system_password';

GRANT CONNECT ON DATABASE :"db_name" TO sycamore_app, sycamore_system;

\connect :"db_name"
GRANT USAGE ON SCHEMA public TO sycamore_app, sycamore_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sycamore_app, sycamore_system;
-- Tables created later by migrations get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sycamore_app, sycamore_system;
