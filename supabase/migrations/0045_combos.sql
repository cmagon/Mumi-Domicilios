-- Combos y promociones: paquetes de productos a un precio especial, con vigencia opcional.
create table if not exists public.combos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text not null default '',
  precio integer not null check (precio >= 0),
  imagen_url text,
  desde date,
  hasta date,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create table if not exists public.combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.combos(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  cantidad integer not null check (cantidad >= 1)
);
create index if not exists combo_items_combo_idx on public.combo_items (combo_id);
alter table public.combos enable row level security;
alter table public.combo_items enable row level security;
drop policy if exists admin_all on public.combos;
drop policy if exists admin_all on public.combo_items;
create policy admin_all on public.combos for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.combo_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
