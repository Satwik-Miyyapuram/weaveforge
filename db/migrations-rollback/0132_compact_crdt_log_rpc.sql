-- Undo 0132 — drop the transactional compaction function.
--
-- Lossless: the function holds no data, and dropping it cannot lose any. What it
-- removes is the *atomic* path, so a client that still calls it falls back to the
-- two-call sequence in `CompactCrdtLogUseCase` — watermark, then sweep — which is
-- correct in ordering but has neither the rights check nor the single
-- transaction. Reverting this migration is therefore a real regression in
-- behaviour, not only in API surface; it is here so a bad deploy can be undone,
-- not because it is a safe place to stay.
--
-- Safe to run more than once, and a no-op if 0132 was never applied.

drop function if exists public.compact_crdt_log(text, uuid, bigint);
