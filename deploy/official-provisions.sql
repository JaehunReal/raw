-- Append the stored official API structure without modifying collection records.
CREATE OR REPLACE VIEW public.rulecraft_official_documents AS
SELECT source, law_id, version_id, title,
       NULLIF(effective_date, '')::date AS effective_date,
       NULLIF(publication_date, '')::date AS publication_date,
       source_url, raw_sha256, text AS raw_text,
       fetched_at::timestamptz AS stored_at, provisions_json
FROM documents
WHERE source = ANY (ARRAY['law', 'administrative', 'ordinance']);
