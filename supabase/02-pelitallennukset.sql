-- Pelipaja – pelien tallennukset pilveen
-- Aja kerran: Supabase → SQL Editor → New query → liitä tämä → Run.
-- Voi ajaa uudelleen turvallisesti.
--
-- Launcher kopioi pelien tallennukset (localStorage ja IndexedDB) tähän tauluun, jotta samalla
-- käyttäjällä on samat tallennukset kaikilla koneilla. Jokainen käyttäjä näkee ja muokkaa vain
-- omia rivejään (Row Level Security).

create table if not exists public.game_saves (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null check (length(key) between 1 and 1000),
  value      text        not null check (length(value) <= 12000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists game_saves_user_updated on public.game_saves (user_id, updated_at);

alter table public.game_saves enable row level security;

drop policy if exists "game_saves: read own"   on public.game_saves;
drop policy if exists "game_saves: insert own" on public.game_saves;
drop policy if exists "game_saves: update own" on public.game_saves;
drop policy if exists "game_saves: delete own" on public.game_saves;

create policy "game_saves: read own"   on public.game_saves for select to authenticated using (auth.uid() = user_id);
create policy "game_saves: insert own" on public.game_saves for insert to authenticated with check (auth.uid() = user_id);
create policy "game_saves: update own" on public.game_saves for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "game_saves: delete own" on public.game_saves for delete to authenticated using (auth.uid() = user_id);

revoke all on public.game_saves from anon;
grant select, insert, update, delete on public.game_saves to authenticated;

-- Yhden käyttäjän tallennukset saavat viedä yhteensä enintään noin 200 Mt
create or replace function public.game_saves_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  select coalesce(sum(length(value)), 0) into total
  from public.game_saves
  where user_id = new.user_id and key <> new.key;
  if total + length(new.value) > 200000000 then
    raise exception 'Save storage is full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists game_saves_quota on public.game_saves;
create trigger game_saves_quota before insert or update on public.game_saves
  for each row execute function public.game_saves_quota();
