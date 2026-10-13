-- Recomp Tracker : à coller dans Supabase > SQL Editor > New query, puis "Run".
-- Crée la table des données, les règles de sécurité et active la synchro en temps réel.

create table if not exists public.docs (
  user_id    uuid        not null references auth.users (id) on delete cascade default auth.uid(),
  path       text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- Sécurité : chaque utilisateur ne voit et ne modifie que ses propres données.
alter table public.docs enable row level security;

drop policy if exists "docs_select_own" on public.docs;
drop policy if exists "docs_insert_own" on public.docs;
drop policy if exists "docs_update_own" on public.docs;
drop policy if exists "docs_delete_own" on public.docs;

create policy "docs_select_own" on public.docs for select to authenticated using ((select auth.uid()) = user_id);
create policy "docs_insert_own" on public.docs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "docs_update_own" on public.docs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "docs_delete_own" on public.docs for delete to authenticated using ((select auth.uid()) = user_id);

-- Temps réel : une modification sur le PC apparaît tout de suite sur le téléphone.
alter table public.docs replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
