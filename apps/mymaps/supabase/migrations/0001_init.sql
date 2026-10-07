-- MyMaps Phase 1 schema
-- Tables: mymaps_maps, mymaps_layers, mymaps_features
-- Storage bucket: mymaps-photos
-- Tile usage tracking + RPC helpers

-- ============================================================
-- Core tables
-- ============================================================

create table if not exists mymaps_maps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists mymaps_layers (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references mymaps_maps(id) on delete cascade,
  name       text not null,
  visible    boolean default true,
  "order"    int default 0,
  created_at timestamptz default now()
);

create table if not exists mymaps_features (
  id         uuid primary key default gen_random_uuid(),
  layer_id   uuid not null references mymaps_layers(id) on delete cascade,
  type       text not null check (type in ('marker', 'line', 'polygon')),
  geometry   jsonb not null,
  properties jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_mymaps_maps_user_id     on mymaps_maps(user_id);
create index if not exists idx_mymaps_layers_map_id    on mymaps_layers(map_id);
create index if not exists idx_mymaps_features_layer_id on mymaps_features(layer_id);

-- ============================================================
-- Row-level security
-- ============================================================

alter table mymaps_maps     enable row level security;
alter table mymaps_layers   enable row level security;
alter table mymaps_features enable row level security;

-- mymaps_maps: direct ownership check
create policy "owner select maps"
  on mymaps_maps for select
  using (user_id = auth.uid());

create policy "owner insert maps"
  on mymaps_maps for insert
  with check (user_id = auth.uid());

create policy "owner update maps"
  on mymaps_maps for update
  using (user_id = auth.uid());

create policy "owner delete maps"
  on mymaps_maps for delete
  using (user_id = auth.uid());

-- mymaps_layers: join through mymaps_maps to verify ownership
create policy "owner select layers"
  on mymaps_layers for select
  using (
    exists (
      select 1 from mymaps_maps m
      where m.id = mymaps_layers.map_id
        and m.user_id = auth.uid()
    )
  );

create policy "owner insert layers"
  on mymaps_layers for insert
  with check (
    exists (
      select 1 from mymaps_maps m
      where m.id = mymaps_layers.map_id
        and m.user_id = auth.uid()
    )
  );

create policy "owner update layers"
  on mymaps_layers for update
  using (
    exists (
      select 1 from mymaps_maps m
      where m.id = mymaps_layers.map_id
        and m.user_id = auth.uid()
    )
  );

create policy "owner delete layers"
  on mymaps_layers for delete
  using (
    exists (
      select 1 from mymaps_maps m
      where m.id = mymaps_layers.map_id
        and m.user_id = auth.uid()
    )
  );

-- mymaps_features: join through mymaps_layers → mymaps_maps to verify ownership
create policy "owner select features"
  on mymaps_features for select
  using (
    exists (
      select 1
      from mymaps_layers l
      join mymaps_maps m on m.id = l.map_id
      where l.id = mymaps_features.layer_id
        and m.user_id = auth.uid()
    )
  );

create policy "owner insert features"
  on mymaps_features for insert
  with check (
    exists (
      select 1
      from mymaps_layers l
      join mymaps_maps m on m.id = l.map_id
      where l.id = mymaps_features.layer_id
        and m.user_id = auth.uid()
    )
  );

create policy "owner update features"
  on mymaps_features for update
  using (
    exists (
      select 1
      from mymaps_layers l
      join mymaps_maps m on m.id = l.map_id
      where l.id = mymaps_features.layer_id
        and m.user_id = auth.uid()
    )
  );

create policy "owner delete features"
  on mymaps_features for delete
  using (
    exists (
      select 1
      from mymaps_layers l
      join mymaps_maps m on m.id = l.map_id
      where l.id = mymaps_features.layer_id
        and m.user_id = auth.uid()
    )
  );

-- ============================================================
-- Storage bucket: mymaps-photos (private)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('mymaps-photos', 'mymaps-photos', false)
on conflict (id) do nothing;

create policy "owner select photos"
  on storage.objects for select
  using (
    bucket_id = 'mymaps-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner insert photos"
  on storage.objects for insert
  with check (
    bucket_id = 'mymaps-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner update photos"
  on storage.objects for update
  using (
    bucket_id = 'mymaps-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner delete photos"
  on storage.objects for delete
  using (
    bucket_id = 'mymaps-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Free-tier tile usage tracking
-- ============================================================

create table if not exists mymaps_tile_usage (
  user_id    uuid    not null,
  year_month text    not null,  -- 'YYYY-MM'
  count      bigint  not null default 0,
  primary key (user_id, year_month)
);

alter table mymaps_tile_usage enable row level security;

create policy "owner tile usage"
  on mymaps_tile_usage for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Returns total tile requests for the current user in the current calendar month.
create or replace function get_monthly_tile_usage()
returns bigint
language sql
security definer
stable
as $$
  select coalesce(
    (select count from mymaps_tile_usage
     where user_id    = auth.uid()
       and year_month = to_char(now(), 'YYYY-MM')),
    0
  );
$$;

-- Increments the tile counter for the current user + month by n.
create or replace function increment_tile_usage(n int default 1)
returns void
language sql
security definer
as $$
  insert into mymaps_tile_usage (user_id, year_month, count)
  values (auth.uid(), to_char(now(), 'YYYY-MM'), n)
  on conflict (user_id, year_month)
  do update set count = mymaps_tile_usage.count + excluded.count;
$$;
