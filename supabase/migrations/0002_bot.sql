-- Soporte del bot de WhatsApp: conversaciones, historial, demanda insatisfecha y reservas de stock atómicas

alter table public.pedidos drop constraint if exists pedidos_estado_check;
alter table public.pedidos add constraint pedidos_estado_check check (estado in
  ('recibido','pago_verificado','pendiente_cobro','impreso','empacado','listo','en_ruta','entregado','cancelado'));
alter table public.pedidos add column if not exists referencia_pago text;
create index if not exists pedidos_ref_idx on public.pedidos (referencia_pago) where referencia_pago is not null;

create table public.conversaciones (
  telefono text primary key,
  humano boolean not null default false,
  ultimo_comprobante text,
  actualizado_en timestamptz not null default now()
);

create table public.mensajes (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique,
  telefono text not null,
  rol text not null check (rol in ('user','assistant')),
  contenido text not null,
  creado_en timestamptz not null default now()
);
create index mensajes_tel_idx on public.mensajes (telefono, creado_en desc);

create table public.demanda_insatisfecha (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  producto_id uuid references public.productos(id),
  cantidad integer not null default 1,
  telefono text,
  creado_en timestamptz not null default now()
);

alter table public.conversaciones enable row level security;
alter table public.mensajes enable row level security;
alter table public.demanda_insatisfecha enable row level security;
create policy admin_all on public.conversaciones for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_read on public.mensajes for select to authenticated using (public.is_admin());
create policy admin_read on public.demanda_insatisfecha for select to authenticated using (public.is_admin());

-- Reserva: mueve unidades de excedente a agendado (el total del día no cambia).
create or replace function public.reservar_stock(p_fecha date, p_producto uuid, p_cantidad int, p_forzar boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (auth.role() = 'service_role' or public.is_admin()) then raise exception 'no autorizado'; end if;
  insert into public.stock_dia (fecha, producto_id) values (p_fecha, p_producto) on conflict do nothing;
  update public.stock_dia
     set cantidad_agendada = cantidad_agendada + p_cantidad,
         cantidad_excedente = greatest(0, cantidad_excedente - p_cantidad)
   where fecha = p_fecha and producto_id = p_producto
     and (p_forzar or cantidad_excedente >= p_cantidad);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

create or replace function public.liberar_stock(p_fecha date, p_producto uuid, p_cantidad int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (auth.role() = 'service_role' or public.is_admin()) then raise exception 'no autorizado'; end if;
  update public.stock_dia
     set cantidad_agendada = greatest(0, cantidad_agendada - p_cantidad),
         cantidad_excedente = cantidad_excedente + p_cantidad
   where fecha = p_fecha and producto_id = p_producto;
end $$;

insert into public.config (clave, valor) values ('domiciliario_numero', ''), ('modelo_ia', '')
  on conflict (clave) do nothing;
