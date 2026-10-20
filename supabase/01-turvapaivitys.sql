-- Pelipaja – tietokannan turvapäivitys
-- Aja kerran: Supabase → SQL Editor → New query → liitä tämä → Run.
-- Voi ajaa uudelleen turvallisesti.
--
-- 1) Käyttäjänimellä kirjautuminen (login_email) lukitaan 15 minuutiksi viiden väärän
--    salasanan jälkeen. Ilman tätä joku voisi kokeilla salasanoja loputtomasti.
-- 2) Peliaikoja ei voi väärentää: yhdellä kerralla voi lisätä enintään 24 h peliaikaa
--    ja 50 käynnistystä, eikä lukuja voi pienentää tai muuttaa negatiivisiksi.

-- ---------- 1. Kirjautumisyritysten rajoitus ----------
create table if not exists public.login_attempts (
  login        text primary key,
  fails        integer not null default 0,
  locked_until timestamptz
);
alter table public.login_attempts enable row level security;
-- ei yhtään policya: taulua ei voi lukea eikä muokata sovelluksesta, vain alla oleva funktio käyttää sitä
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.login_email(p_login text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  k       text := lower(trim(coalesce(p_login, '')));
  a       public.login_attempts%rowtype;
  v_email text;
  v_hash  text;
begin
  if k = '' or length(k) > 254 or p_password is null or length(p_password) > 200 then
    return null;
  end if;

  select * into a from public.login_attempts where login = k;
  if found and a.locked_until is not null and a.locked_until > now() then
    raise exception 'Too many login attempts' using errcode = 'P0001';
  end if;

  select u.email, u.encrypted_password into v_email, v_hash
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = k or lower(u.email) = k
  limit 1;

  if v_hash is not null and v_hash = extensions.crypt(p_password, v_hash) then
    delete from public.login_attempts where login = k;
    return v_email;
  end if;

  insert into public.login_attempts as la (login, fails, locked_until)
  values (k, 1, null)
  on conflict (login) do update set
    fails = case when la.locked_until is not null then 1 else la.fails + 1 end,
    locked_until = case when la.locked_until is null and la.fails + 1 >= 5
                        then now() + interval '15 minutes' else null end;
  return null;
end;
$$;

revoke all on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- ---------- 2. Peliaikojen suojaus ----------
create or replace function public.game_stats_guard()
returns trigger
language plpgsql
as $$
begin
  if new.game_id is null or new.game_id !~ '^[a-z0-9][a-z0-9_-]{0,47}$' then
    raise exception 'Virheellinen pelin tunnus';
  end if;
  if tg_op = 'INSERT' then
    new.playtime_ms := least(greatest(coalesce(new.playtime_ms, 0), 0), 86400000);
    new.launches    := least(greatest(coalesce(new.launches, 0), 0), 50);
  else
    new.game_id     := old.game_id;
    new.playtime_ms := old.playtime_ms + least(greatest(coalesce(new.playtime_ms, 0) - old.playtime_ms, 0), 86400000);
    new.launches    := old.launches + least(greatest(coalesce(new.launches, 0) - old.launches, 0), 50);
  end if;
  return new;
end;
$$;

drop trigger if exists game_stats_guard on public.game_stats;
create trigger game_stats_guard
  before insert or update on public.game_stats
  for each row execute function public.game_stats_guard();
