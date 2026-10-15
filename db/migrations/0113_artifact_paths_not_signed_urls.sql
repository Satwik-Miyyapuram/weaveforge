-- Replace expired presigned URLs in experiments.artifacts with storage paths.
--
-- /api/sdk/artifacts used to sign each upload for ten years and hand the URL
-- back, and the SDK stored it in `experiments.artifacts` as though it were a
-- permanent address. SigV4 caps a presigned URL at seven days and R2 enforces
-- that silently: the ten-year request was clamped, not refused. Every artifact
-- link died a week after upload, and the row still pointed at it — so the
-- figure rendered R2's `<Code>ExpiredRequest</Code>` XML with nothing in the
-- app to explain why.
--
-- The route now stores the path and the reader signs on demand. This repairs
-- rows written under the old behaviour, so those figures come back rather than
-- staying broken forever.
--
-- Only entries that are presigned URLs into our own artifact bucket are
-- touched. `log_artifact(url)` exists so a run can point at something hosted
-- elsewhere — a wandb run, an S3 object — and those are left exactly as they
-- are, expired-looking or not, because they are not ours to rewrite.

update experiments
   set artifacts = coalesce(
     (
       select jsonb_agg(
         case
           -- A presigned URL for this bucket: keep the object key only. The
           -- path is everything after `/experiment-artifacts/`, before the
           -- query string that carries the signature.
           when entry like '%X-Amz-Signature%' and entry like '%/experiment-artifacts/%'
             then split_part(
                    split_part(entry, '/experiment-artifacts/', 2),
                    '?', 1
                  )
           else entry
         end
         order by idx
       )
       from jsonb_array_elements_text(artifacts) with ordinality as t(entry, idx)
     ),
     '[]'::jsonb
   )
 where artifacts::text like '%X-Amz-Signature%'
   and artifacts::text like '%/experiment-artifacts/%';

-- URL-encoded path segments would otherwise stay encoded in the key and fail
-- to match the stored object. Only the characters an object key can legally
-- contain are decoded; a stray `%` that is not an escape is left alone.
update experiments
   set artifacts = coalesce(
     (
       select jsonb_agg(replace(replace(entry, '%2F', '/'), '%20', ' ') order by idx)
       from jsonb_array_elements_text(artifacts) with ordinality as t(entry, idx)
     ),
     '[]'::jsonb
   )
 where artifacts::text like '%\%2F%' escape '\'
    or artifacts::text like '%\%20%' escape '\';
