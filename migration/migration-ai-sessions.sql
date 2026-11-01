-- AI chat sessions: Studio panel transcripts saved with the account.
-- Run once against the Supabase project (qgcydphkaujomxyzwcht).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ai_sessions jsonb NOT NULL DEFAULT '[]'::jsonb;
