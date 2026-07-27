-- Match rows are the committed invalidation signal for score and lifecycle
-- changes. Sets stay out of Realtime because they cannot be filtered directly
-- by tournament.
-- Production ledger version: 20260727120220.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
  END IF;
END
$migration$;
