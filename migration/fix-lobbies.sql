CREATE TABLE IF NOT EXISTS public.lobbies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  persistent boolean DEFAULT false,
  server_id uuid,
  topic text NOT NULL DEFAULT '',
  is_private boolean NOT NULL DEFAULT false,
  kind text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS lobbies_name_key ON public.lobbies(name);
CREATE INDEX IF NOT EXISTS lobbies_server_id_idx ON public.lobbies(server_id);
