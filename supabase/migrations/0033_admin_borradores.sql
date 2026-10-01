-- Borradores de pedidos dictados por el administrador por WhatsApp (texto o voz), en espera de datos o de confirmación.
create table if not exists public.admin_borradores (
  admin_telefono text primary key,
  crudo text not null,
  datos jsonb not null default '{}',
  estado text not null default 'preguntando' check (estado in ('preguntando', 'confirmar')),
  actualizado_en timestamptz not null default now()
);
alter table public.admin_borradores enable row level security;
drop policy if exists admin_all on public.admin_borradores;
create policy admin_all on public.admin_borradores for all to authenticated using (public.is_admin()) with check (public.is_admin());
