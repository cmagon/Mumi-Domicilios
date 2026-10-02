-- Categorías de producto (las crea el admin): galletas, bebidas, etc. Para ofrecer complementos en el futuro.
create table if not exists public.categorias_producto (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden integer not null default 0,
  creado_en timestamptz not null default now()
);
alter table public.categorias_producto enable row level security;
drop policy if exists admin_all on public.categorias_producto;
create policy admin_all on public.categorias_producto for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.productos add column if not exists categoria_id uuid references public.categorias_producto(id) on delete set null;

-- Todo lo que existe hoy queda en "Galletas"
insert into public.categorias_producto (nombre, orden) values ('Galletas', 0) on conflict (nombre) do nothing;
update public.productos set categoria_id = (select id from public.categorias_producto where nombre = 'Galletas') where categoria_id is null;
