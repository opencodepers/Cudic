-- Messages survive account deletion: keep the message (display_name is stored),
-- just null out the author. Lobbies can be created by the message-save fallback
-- without a creator (created_by nullable; kind required).
alter table public.messages drop constraint if exists messages_user_id_fkey;
alter table public.messages add constraint messages_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;
alter table public.lobbies alter column created_by drop not null;
