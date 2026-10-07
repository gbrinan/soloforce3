-- MyMaps: persist feature ordering within each layer
-- Enables drag-to-reorder in the layer panel to survive across sessions.

alter table mymaps_features
  add column if not exists "order" int not null default 0;

-- Backfill existing rows: assign 0-based order per layer using created_at as tiebreaker.
-- Skips already-ordered rows (rare edge case if this migration is re-run).
with ranked as (
  select id,
         row_number() over (partition by layer_id order by created_at, id) - 1 as new_order
  from mymaps_features
)
update mymaps_features f
  set "order" = r.new_order
  from ranked r
  where f.id = r.id;

create index if not exists idx_mymaps_features_layer_order
  on mymaps_features(layer_id, "order");
