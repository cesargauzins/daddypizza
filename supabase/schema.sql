-- Daddy Pizz'IMT — schéma Supabase
-- À coller tel quel dans Supabase → SQL Editor → Run (ré-exécutable sans risque).
--
-- Les tables ne sont pas accessibles depuis le navigateur (RLS activé, aucune
-- policy, droits retirés). Tout passe par les fonctions ci-dessous, exécutées
-- avec les droits du propriétaire (security definer).
--
-- Public :
--   pizza_current_sale  → vente en cours (pizzas, stock, créneaux), sans aucun nom
--   pizza_place_order   → commande, avec contrôle du stock et des places sous verrou
-- Admin :
--   pizza_door          → vérifie le code secret de l'adresse admin
--   pizza_login         → code secret + mot de passe → jeton de session
--   pizza_admin_*       → tout le reste, protégé par le jeton
--
-- Le mot de passe et le code secret ne sont PAS dans ce fichier : ils sont
-- stockés hachés (bcrypt) dans pizza_admin, à renseigner une fois à la main :
--   insert into pizza_admin (password_hash, door_hash)
--   values (extensions.crypt('<mot de passe>', extensions.gen_salt('bf', 10)),
--           extensions.crypt('<code secret>',  extensions.gen_salt('bf', 10)))
--   on conflict (id) do update set password_hash = excluded.password_hash, door_hash = excluded.door_hash;

create extension if not exists pgcrypto with schema extensions;

create table if not exists pizza_pizzas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  recipe      text not null default '' check (char_length(recipe) <= 500),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists pizza_sales (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 1 and 80),
  sale_date      date,
  start_time     time not null,
  end_time       time not null,
  slot_count     int  not null check (slot_count between 1 and 96),
  slot_capacity  int  not null check (slot_capacity between 1 and 500),
  status         text not null default 'open' check (status in ('open', 'paused', 'closed')),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  check (end_time > start_time)
);

create table if not exists pizza_sale_items (
  sale_id   uuid not null references pizza_sales(id) on delete cascade,
  pizza_id  uuid not null references pizza_pizzas(id),
  quantity  int  not null check (quantity between 1 and 10000),
  position  int  not null default 0,
  primary key (sale_id, pizza_id)
);

create table if not exists pizza_orders (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references pizza_sales(id) on delete cascade,
  first_name  text not null check (char_length(first_name) between 1 and 60),
  last_name   text not null check (char_length(last_name) between 1 and 60),
  slot        int  not null check (slot >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists pizza_order_items (
  order_id  uuid not null references pizza_orders(id) on delete cascade,
  pizza_id  uuid not null references pizza_pizzas(id),
  quantity  int  not null check (quantity > 0),
  primary key (order_id, pizza_id)
);

-- Une seule ligne : mot de passe et code secret de l'admin, hachés.
create table if not exists pizza_admin (
  id             int primary key default 1 check (id = 1),
  password_hash  text not null,
  door_hash      text not null
);

-- Seul le hash SHA-256 du jeton est stocké.
create table if not exists pizza_sessions (
  token_hash  text primary key,
  expires_at  timestamptz not null
);

create table if not exists pizza_login_failures (
  at timestamptz not null default now()
);

create index if not exists pizza_orders_sale_idx on pizza_orders(sale_id);
create index if not exists pizza_order_items_pizza_idx on pizza_order_items(pizza_id);

alter table pizza_pizzas         enable row level security;
alter table pizza_sales          enable row level security;
alter table pizza_sale_items     enable row level security;
alter table pizza_orders         enable row level security;
alter table pizza_order_items    enable row level security;
alter table pizza_admin          enable row level security;
alter table pizza_sessions       enable row level security;
alter table pizza_login_failures enable row level security;

revoke all on pizza_pizzas, pizza_sales, pizza_sale_items, pizza_orders, pizza_order_items,
  pizza_admin, pizza_sessions, pizza_login_failures from anon, authenticated;


-- ---------- Vue d'une vente (interne) ----------

create or replace function pizza_sale_json(p_id uuid) returns json
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select json_build_object(
    'id',           s.id,
    'title',        s.title,
    'date',         coalesce(to_char(s.sale_date, 'YYYY-MM-DD'), ''),
    'startTime',    to_char(s.start_time, 'HH24:MI'),
    'endTime',      to_char(s.end_time, 'HH24:MI'),
    'slotCount',    s.slot_count,
    'slotCapacity', s.slot_capacity,
    'status',       s.status,
    'createdAt',    (extract(epoch from s.created_at) * 1000)::bigint,
    'orderCount',   (select count(*) from pizza_orders o where o.sale_id = s.id),
    'items', coalesce((
      select json_agg(json_build_object(
        'pizzaId',   i.pizza_id,
        'name',      p.name,
        'recipe',    p.recipe,
        'quantity',  i.quantity,
        'ordered',   x.ordered,
        'remaining', greatest(0, i.quantity - x.ordered)
      ) order by i.position)
      from pizza_sale_items i
      join pizza_pizzas p on p.id = i.pizza_id
      cross join lateral (
        select coalesce(sum(oi.quantity), 0)::int as ordered
        from pizza_order_items oi join pizza_orders o on o.id = oi.order_id
        where o.sale_id = s.id and oi.pizza_id = i.pizza_id
      ) x
      where i.sale_id = s.id
    ), '[]'::json),
    -- Découpage régulier de la plage, arrondi à la minute.
    'slots', (
      select json_agg(json_build_object(
        'index',     g.i,
        'label',     to_char(s.start_time + make_interval(mins => round(g.i * t.total / s.slot_count)::int), 'HH24:MI')
                     || ' – ' ||
                     to_char(s.start_time + make_interval(mins => round((g.i + 1) * t.total / s.slot_count)::int), 'HH24:MI'),
        'capacity',  s.slot_capacity,
        'taken',     c.taken,
        'remaining', greatest(0, s.slot_capacity - c.taken)
      ) order by g.i)
      from generate_series(0, s.slot_count - 1) g(i)
      cross join lateral (select extract(epoch from (s.end_time - s.start_time))::numeric / 60 as total) t
      cross join lateral (select count(*)::int as taken from pizza_orders o where o.sale_id = s.id and o.slot = g.i) c
    )
  )
  from pizza_sales s
  where s.id = p_id
$$;


-- ---------- Public ----------

create or replace function pizza_current_sale() returns json
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select pizza_sale_json(s.id)
  from pizza_sales s
  where s.status in ('open', 'paused')
  order by s.created_at desc
  limit 1
$$;


create or replace function pizza_place_order(
  p_sale_id uuid,
  p_first_name text,
  p_last_name text,
  p_slot int,
  p_items json
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_sale   pizza_sales;
  v_first  text := btrim(p_first_name);
  v_last   text := btrim(p_last_name);
  v_order  uuid;
  v_total  int := 0;
  v_qty    int;
  v_left   int;
  v_name   text;
  r        record;
begin
  if coalesce(v_first, '') = '' or coalesce(v_last, '') = '' then
    raise exception 'Nom et prénom obligatoires.';
  end if;
  if char_length(v_first) > 60 or char_length(v_last) > 60 then
    raise exception 'Nom ou prénom trop long.';
  end if;

  -- Verrou sur la vente : les commandes passent une par une, donc ni le stock
  -- ni les places d'un créneau ne peuvent être dépassés.
  select * into v_sale from pizza_sales where id = p_sale_id for update;
  if not found or v_sale.status <> 'open' then
    raise exception 'La vente est en pause ou fermée, réessaie plus tard.';
  end if;
  if p_slot is null or p_slot < 0 or p_slot >= v_sale.slot_count then
    raise exception 'Choisis un créneau.';
  end if;
  if (select count(*) from pizza_orders where sale_id = v_sale.id and slot = p_slot) >= v_sale.slot_capacity then
    raise exception 'Ce créneau vient d’être complet, choisis-en un autre.';
  end if;
  if p_items is null or json_typeof(p_items) <> 'object' then
    raise exception 'Ton panier est vide.';
  end if;

  for r in select key, value from json_each_text(p_items) loop
    if r.value !~ '^\d{1,4}$' or r.key !~ '^[0-9a-f-]{36}$' then
      raise exception 'Panier invalide.';
    end if;
    v_qty := r.value::int;
    continue when v_qty = 0;
    select p.name, i.quantity - coalesce((
      select sum(oi.quantity) from pizza_order_items oi join pizza_orders o on o.id = oi.order_id
      where o.sale_id = v_sale.id and oi.pizza_id = i.pizza_id), 0)
    into v_name, v_left
    from pizza_sale_items i join pizza_pizzas p on p.id = i.pizza_id
    where i.sale_id = v_sale.id and i.pizza_id = r.key::uuid;
    if not found then
      raise exception 'Pizza inconnue.';
    end if;
    if v_qty > v_left then
      raise exception 'Plus que % « % » disponible(s).', greatest(v_left, 0), v_name;
    end if;
    v_total := v_total + v_qty;
  end loop;
  if v_total = 0 then
    raise exception 'Ton panier est vide.';
  end if;

  insert into pizza_orders (sale_id, first_name, last_name, slot)
  values (v_sale.id, v_first, v_last, p_slot)
  returning id into v_order;

  insert into pizza_order_items (order_id, pizza_id, quantity)
  select v_order, key::uuid, value::int from json_each_text(p_items) where value::int > 0;

  return json_build_object('id', v_order, 'slotLabel', pizza_sale_json(v_sale.id) -> 'slots' -> p_slot ->> 'label');
end;
$$;


-- ---------- Accès admin ----------

create or replace function pizza_door(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from pizza_admin where door_hash = crypt(coalesce(p_code, ''), door_hash))
$$;


-- Renvoie { token } ou { error } (pas d'exception : l'échec doit rester enregistré).
create or replace function pizza_login(p_code text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_admin pizza_admin;
  v_token text;
begin
  select * into v_admin from pizza_admin where id = 1;
  -- Sans le bon code secret, rien n'est compté : impossible de bloquer l'admin de l'extérieur.
  if not found or v_admin.door_hash <> crypt(coalesce(p_code, ''), v_admin.door_hash) then
    return json_build_object('error', 'Mot de passe incorrect.');
  end if;
  if (select count(*) from pizza_login_failures where at > now() - interval '15 minutes') >= 10 then
    return json_build_object('error', 'Trop de tentatives, réessaie dans 15 minutes.');
  end if;
  if v_admin.password_hash <> crypt(coalesce(p_password, ''), v_admin.password_hash) then
    insert into pizza_login_failures default values;
    delete from pizza_login_failures where at < now() - interval '1 day';
    return json_build_object('error', 'Mot de passe incorrect.');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into pizza_sessions (token_hash, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');
  delete from pizza_sessions where expires_at < now();
  return json_build_object('token', v_token);
end;
$$;


create or replace function pizza_admin_check(p_token text) returns void
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_token is null or not exists (
    select 1 from pizza_sessions
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()
  ) then
    raise exception 'UNAUTHORIZED';
  end if;
end;
$$;


create or replace function pizza_admin_logout(p_token text) returns void
language sql volatile security definer set search_path = public, extensions, pg_temp as $$
  delete from pizza_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;


-- Tout le tableau de bord en un appel : pizzas, ventes, et détail des commandes
-- de p_sale_id (ou de la vente en cours si null).
create or replace function pizza_admin_state(p_token text, p_sale_id uuid) returns json
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid;
begin
  perform pizza_admin_check(p_token);

  select id into v_id from pizza_sales where id = p_sale_id;
  if v_id is null then
    select id into v_id from pizza_sales where status in ('open', 'paused') order by created_at desc limit 1;
  end if;

  return json_build_object(
    'pizzas', coalesce((
      select json_agg(json_build_object('id', id, 'name', name, 'recipe', recipe) order by created_at)
      from pizza_pizzas where deleted_at is null
    ), '[]'::json),
    'sales', coalesce((
      select json_agg(pizza_sale_json(id) order by created_at desc) from pizza_sales
    ), '[]'::json),
    'detail', case when v_id is null then null else json_build_object(
      'sale', pizza_sale_json(v_id),
      'orders', coalesce((
        select json_agg(json_build_object(
          'id',        o.id,
          'firstName', o.first_name,
          'lastName',  o.last_name,
          'slot',      o.slot,
          'createdAt', (extract(epoch from o.created_at) * 1000)::bigint,
          'items',     (select json_object_agg(oi.pizza_id, oi.quantity) from pizza_order_items oi where oi.order_id = o.id)
        ) order by o.created_at desc)
        from pizza_orders o where o.sale_id = v_id
      ), '[]'::json)
    ) end
  );
end;
$$;


create or replace function pizza_admin_save_pizza(p_token text, p_id uuid, p_name text, p_recipe text) returns json
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_name   text := btrim(p_name);
  v_recipe text := coalesce(btrim(p_recipe), '');
  v_id     uuid;
begin
  perform pizza_admin_check(p_token);
  if coalesce(v_name, '') = '' then raise exception 'Donne un nom à ta pizza.'; end if;
  if char_length(v_name) > 60 then raise exception 'Nom trop long (60 caractères max).'; end if;
  if char_length(v_recipe) > 500 then raise exception 'Recette trop longue (500 caractères max).'; end if;

  if p_id is null then
    insert into pizza_pizzas (name, recipe) values (v_name, v_recipe) returning id into v_id;
  else
    update pizza_pizzas set name = v_name, recipe = v_recipe
    where id = p_id and deleted_at is null returning id into v_id;
    if v_id is null then raise exception 'Pizza introuvable.'; end if;
  end if;
  return json_build_object('id', v_id);
end;
$$;


-- Suppression douce : les anciennes ventes gardent le nom de la pizza.
create or replace function pizza_admin_delete_pizza(p_token text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
begin
  perform pizza_admin_check(p_token);
  if exists (
    select 1 from pizza_sale_items i join pizza_sales s on s.id = i.sale_id
    where i.pizza_id = p_id and s.status in ('open', 'paused')
  ) then
    raise exception 'Cette pizza est dans la vente en cours.';
  end if;
  update pizza_pizzas set deleted_at = now() where id = p_id;
end;
$$;


create or replace function pizza_admin_create_sale(
  p_token text,
  p_title text,
  p_date date,
  p_start time,
  p_end time,
  p_slot_count int,
  p_slot_capacity int,
  p_items json
) returns json
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Vente de pizzas');
  v_id    uuid;
  v_count int;
begin
  perform pizza_admin_check(p_token);
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'La plage horaire est invalide (l''heure de fin doit être après le début).';
  end if;
  if p_slot_count is null or p_slot_count < 1 or p_slot_count > 96 then
    raise exception 'Nombre de créneaux invalide.';
  end if;
  if p_slot_capacity is null or p_slot_capacity < 1 or p_slot_capacity > 500 then
    raise exception 'Nombre de personnes par créneau invalide.';
  end if;
  if char_length(v_title) > 80 then raise exception 'Nom de la vente trop long.'; end if;

  -- Une seule vente en cours à la fois : la précédente est terminée.
  update pizza_sales set status = 'closed', closed_at = now() where status in ('open', 'paused');

  insert into pizza_sales (title, sale_date, start_time, end_time, slot_count, slot_capacity)
  values (v_title, p_date, p_start, p_end, p_slot_count, p_slot_capacity)
  returning id into v_id;

  insert into pizza_sale_items (sale_id, pizza_id, quantity, position)
  select v_id, p.id, (e.value ->> 'quantity')::int, e.n
  from json_array_elements(coalesce(p_items, '[]'::json)) with ordinality e(value, n)
  join pizza_pizzas p on p.id::text = e.value ->> 'pizzaId' and p.deleted_at is null
  where (e.value ->> 'quantity') ~ '^\d{1,5}$' and (e.value ->> 'quantity')::int > 0;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Ajoute au moins une pizza avec une quantité.';
  end if;
  return json_build_object('id', v_id);
end;
$$;


create or replace function pizza_admin_set_status(p_token text, p_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_sale pizza_sales;
begin
  perform pizza_admin_check(p_token);
  if p_status not in ('open', 'paused', 'closed') then raise exception 'Statut invalide.'; end if;
  select * into v_sale from pizza_sales where id = p_id for update;
  if not found then raise exception 'Vente introuvable.'; end if;
  if v_sale.status = 'closed' then
    raise exception 'Cette vente est terminée, elle ne peut plus être rouverte.';
  end if;
  update pizza_sales
  set status = p_status, closed_at = case when p_status = 'closed' then now() end
  where id = p_id;
end;
$$;


create or replace function pizza_admin_delete_sale(p_token text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
begin
  perform pizza_admin_check(p_token);
  delete from pizza_sales where id = p_id;
end;
$$;


create or replace function pizza_admin_delete_order(p_token text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
begin
  perform pizza_admin_check(p_token);
  delete from pizza_orders where id = p_id;
end;
$$;


-- ---------- Droits ----------

revoke execute on function pizza_sale_json(uuid)    from public, anon, authenticated;
revoke execute on function pizza_admin_check(text)  from public, anon, authenticated;

revoke execute on function pizza_current_sale() from public;
revoke execute on function pizza_place_order(uuid, text, text, int, json) from public;
revoke execute on function pizza_door(text) from public;
revoke execute on function pizza_login(text, text) from public;
revoke execute on function pizza_admin_logout(text) from public;
revoke execute on function pizza_admin_state(text, uuid) from public;
revoke execute on function pizza_admin_save_pizza(text, uuid, text, text) from public;
revoke execute on function pizza_admin_delete_pizza(text, uuid) from public;
revoke execute on function pizza_admin_create_sale(text, text, date, time, time, int, int, json) from public;
revoke execute on function pizza_admin_set_status(text, uuid, text) from public;
revoke execute on function pizza_admin_delete_sale(text, uuid) from public;
revoke execute on function pizza_admin_delete_order(text, uuid) from public;

grant execute on function
  pizza_current_sale(),
  pizza_place_order(uuid, text, text, int, json),
  pizza_door(text),
  pizza_login(text, text),
  pizza_admin_logout(text),
  pizza_admin_state(text, uuid),
  pizza_admin_save_pizza(text, uuid, text, text),
  pizza_admin_delete_pizza(text, uuid),
  pizza_admin_create_sale(text, text, date, time, time, int, int, json),
  pizza_admin_set_status(text, uuid, text),
  pizza_admin_delete_sale(text, uuid),
  pizza_admin_delete_order(text, uuid)
to anon, authenticated;
