# 내 지도 (MyMaps)

구글 내 지도 클론. 마커·선·면 레이어 편집 + KML 내보내기.

## 환경변수

`.env` 파일 생성:
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_MAPTILER_KEY=<maptiler-api-key>   # 없으면 OSM 자동 사용
```

## 실행

```bash
cd apps/mymaps
npm install
npm run dev      # 개발 서버 (http://127.0.0.1:3211)
npm run build    # 프로덕션 빌드
npm run start    # 빌드 프리뷰
```

## Supabase 스키마

Linus가 생성하는 테이블:
```sql
create table mymaps_maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null default '새 지도',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table mymaps_layers (
  id uuid primary key default gen_random_uuid(),
  map_id uuid references mymaps_maps on delete cascade not null,
  name text not null default '레이어 1',
  visible boolean default true,
  "order" int default 0
);

create table mymaps_features (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid references mymaps_layers on delete cascade not null,
  type text check (type in ('marker','line','polygon')) not null,
  geometry jsonb not null,
  properties jsonb default '{}'
);

-- Storage bucket
insert into storage.buckets (id, name, public) values ('mymaps-photos', 'mymaps-photos', true);

-- RLS
alter table mymaps_maps enable row level security;
alter table mymaps_layers enable row level security;
alter table mymaps_features enable row level security;

create policy "owner" on mymaps_maps for all using (user_id = auth.uid());
create policy "owner via map" on mymaps_layers for all using (
  map_id in (select id from mymaps_maps where user_id = auth.uid())
);
create policy "owner via layer" on mymaps_features for all using (
  layer_id in (select id from mymaps_layers where map_id in (
    select id from mymaps_maps where user_id = auth.uid()
  ))
);

-- Tile usage RPC (optional — for MapTiler free-tier guard)
create or replace function get_monthly_tile_usage()
returns int language sql as $$
  select coalesce((select usage::int from tile_usage where month = date_trunc('month', now())), 0);
$$;
```

## Phase 2 계획

- GPS 현재 위치 표시 + 마커 이동 (드래그)
- 클러스터링 (많은 마커)
- EXIF 위치 태그로 사진 자동 마커
- 협업 공유 링크
- 히트맵 레이어
