-- Reviewed PostgreSQL mapping example, NOT an automatic data migration.
-- This file only applies when the selected official-only source table has the
-- same columns as RuleCraft's LawStore documents table after a separate import.
-- Inspect your real PostgreSQL schema and adapt the SELECT before execution.
-- Run with psql -v ON_ERROR_STOP=1 -v confirmed_official_source=true
--   -v source_schema=YOUR_SCHEMA -v source_table=YOUR_TABLE -f this_file.sql
-- Connect as a trusted schema owner; do not pass passwords on the command line.

\set ON_ERROR_STOP on
\if :{?confirmed_official_source}
  \if :confirmed_official_source
  \else
    \echo 'Inspect and confirm an official-only source table before running this template.'
    \quit 2
  \endif
\else
  \echo 'Missing confirmed_official_source=true; this template has not been applied.'
  \quit 2
\endif
\if :{?source_schema}
\else
  \echo 'Set source_schema to the inspected PostgreSQL source schema.'
  \quit 2
\endif
\if :{?source_table}
\else
  \echo 'Set source_table to the inspected official-only PostgreSQL source table.'
  \quit 2
\endif

BEGIN;

-- Stop instead of replacing an existing role or a reviewed view.
DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rulecraft_vercel_reader') THEN
        RAISE EXCEPTION 'The reader role already exists; review its privileges separately.';
    END IF;
    IF to_regclass('public.rulecraft_official_documents') IS NOT NULL THEN
        RAISE EXCEPTION 'The official view already exists; review its definition separately.';
    END IF;
END
$guard$;

CREATE ROLE rulecraft_vercel_reader
    LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- raw_text is extracted legal body text, not original XML/JSON file bytes.
-- raw_sha256 is the hash of the original stored response, never the text hash.
-- Every stored version is exposed; this does not assert current legal effect.
-- Internal paths, OC, metadata, institutions and editable documents are excluded.
CREATE VIEW public.rulecraft_official_documents
    WITH (security_barrier = true)
AS
SELECT
    source::text AS source,
    law_id::text AS law_id,
    version_id::text AS version_id,
    title::text AS title,
    NULLIF(effective_date::text, '')::date AS effective_date,
    NULLIF(publication_date::text, '')::date AS publication_date,
    source_url::text AS source_url,
    raw_sha256::text AS raw_sha256,
    text::text AS raw_text,
    fetched_at::timestamptz AS stored_at
FROM :"source_schema".:"source_table"
WHERE source IN ('law', 'administrative', 'ordinance');

REVOKE ALL ON public.rulecraft_official_documents FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO rulecraft_vercel_reader;
GRANT USAGE ON SCHEMA public TO rulecraft_vercel_reader;
GRANT SELECT ON public.rulecraft_official_documents TO rulecraft_vercel_reader;

ALTER ROLE rulecraft_vercel_reader SET default_transaction_read_only = on;
ALTER ROLE rulecraft_vercel_reader SET statement_timeout = '5s';
ALTER ROLE rulecraft_vercel_reader SET lock_timeout = '1s';
ALTER ROLE rulecraft_vercel_reader SET idle_in_transaction_session_timeout = '5s';

-- A new role still inherits privileges granted to PUBLIC. Fail safely if that
-- would expose other user tables/views or give write permission anywhere.
-- This check does not change any existing shared role/schema/table privileges.
DO $privileges$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND n.nspname <> 'information_schema'
          AND n.nspname !~ '^pg_'
          AND c.oid <> 'public.rulecraft_official_documents'::regclass
          AND (
              has_table_privilege('rulecraft_vercel_reader', c.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_any_column_privilege('rulecraft_vercel_reader', c.oid,
                  'SELECT,INSERT,UPDATE,REFERENCES')
          )
    ) THEN
        RAISE EXCEPTION 'PUBLIC grants expose other relations; review existing privileges before creating the reader.';
    END IF;
    IF has_schema_privilege('rulecraft_vercel_reader', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'PUBLIC permits schema creation; review schema privileges before creating the reader.';
    END IF;
END
$privileges$;

COMMIT;

-- psql prompts without echoing the password and sends a hashed password.
-- Enter a strong unique password. This file contains no password value.
\password rulecraft_vercel_reader
