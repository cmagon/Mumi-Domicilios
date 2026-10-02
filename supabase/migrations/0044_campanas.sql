-- Campañas: mensaje promocional (imagen + texto + hasta 2 botones) que se envía por WhatsApp a clientes con la ventana de 24 h abierta.
create table if not exists public.campanas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  texto text not null,
  imagen_url text,
  boton1 text,
  boton2 text,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada')),
  creado_en timestamptz not null default now(),
  enviada_en timestamptz
);
create table if not exists public.campana_envios (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.campanas(id) on delete cascade,
  telefono text not null,
  estado text not null check (estado in ('enviado', 'fallido')),
  error text,
  wa_id text,
  boton_tocado integer,
  respondio_en timestamptz,
  enviado_en timestamptz not null default now(),
  unique (campana_id, telefono)
);
alter table public.campanas enable row level security;
alter table public.campana_envios enable row level security;
drop policy if exists admin_all on public.campanas;
drop policy if exists admin_all on public.campana_envios;
create policy admin_all on public.campanas for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.campana_envios for all to authenticated using (public.is_admin()) with check (public.is_admin());
