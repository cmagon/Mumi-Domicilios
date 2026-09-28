-- Mumi Delivery — esquema inicial (secciones 4, 10, 11 y 12 del diseño técnico)

create extension if not exists "pgcrypto";

-- ============ Roles / autenticación ============
create table public.perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null default 'admin' check (rol in ('admin')),
  creado_en timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where user_id = auth.uid() and rol = 'admin');
$$;

-- ============ Catálogo ============
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text not null default '',
  precio integer not null check (precio >= 0),
  foto_url text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ============ Stock del día ============
-- total_disponible = agendado (fijo) + excedente (único campo editable)
create table public.stock_dia (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  producto_id uuid not null references public.productos(id) on delete cascade,
  cantidad_agendada integer not null default 0 check (cantidad_agendada >= 0),
  cantidad_excedente integer not null default 0 check (cantidad_excedente >= 0),
  total_disponible integer generated always as (cantidad_agendada + cantidad_excedente) stored,
  unique (fecha, producto_id)
);

-- ============ Pedidos ============
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  cliente_nombre text not null,
  cliente_telefono text not null,
  origen text not null default 'bot' check (origen in ('bot', 'manual')),
  estado text not null default 'recibido' check (estado in
    ('recibido','pago_verificado','pendiente_cobro','impreso','empacado','listo','entregado','cancelado')),
  metodo_pago text,
  pagado boolean not null default false,
  modalidad text not null default 'domicilio' check (modalidad in ('domicilio','recoger')),
  direccion text,
  tarifa_domicilio integer not null default 0,
  total integer not null default 0,
  nota text,
  comprobante_url text,
  fecha_entrega date,
  franja_horaria text,
  creado_en timestamptz not null default now()
);
create index pedidos_estado_idx on public.pedidos (estado);
create index pedidos_fecha_idx on public.pedidos (fecha_entrega);

create table public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario integer not null default 0
);

-- ============ Tarifas de domicilio (sección 11) ============
create table public.tarifas_domicilio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,          -- zona/barrio o "Tarifa fija"
  valor integer not null check (valor >= 0),
  activo boolean not null default true
);

-- ============ Métodos de pago (sección 11): nombre, número de cuenta, tipo de cuenta ============
create table public.metodos_pago (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  numero_cuenta text not null default '',
  tipo_cuenta text not null default '',
  activo boolean not null default true
);

-- ============ Config + historial ============
create table public.config (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  valor text not null default ''
);

create table public.config_historial (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.config(id) on delete cascade,
  valor_anterior text,
  cambiado_por uuid default auth.uid(),
  cambiado_en timestamptz not null default now()
);

create or replace function public.config_guardar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.valor is distinct from old.valor then
    insert into public.config_historial (config_id, valor_anterior) values (old.id, old.valor);
  end if;
  return new;
end $$;

create trigger config_historial_trg before update on public.config
  for each row execute function public.config_guardar_historial();

-- ============ Secretos (API key, token WhatsApp): jamás legibles desde el cliente ============
create table public.config_secretos (
  clave text primary key,
  valor text not null,
  actualizado_en timestamptz not null default now()
);

create or replace function public.set_secreto(p_clave text, p_valor text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  insert into public.config_secretos (clave, valor) values (p_clave, p_valor)
    on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();
end $$;

create or replace function public.secreto_configurado(p_clave text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  return exists (select 1 from public.config_secretos where clave = p_clave);
end $$;

-- ============ Bitácora de auditoría ============
create table public.auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  operacion text not null,
  fila_id text,
  usuario uuid default auth.uid(),
  cambiado_en timestamptz not null default now()
);

create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
  insert into public.auditoria (tabla, operacion, fila_id) values (tg_table_name, tg_op, v_id);
  return coalesce(new, old);
end $$;

create trigger aud_stock after insert or update or delete on public.stock_dia for each row execute function public.auditar();
create trigger aud_config after insert or update or delete on public.config for each row execute function public.auditar();
create trigger aud_pedidos after insert or update or delete on public.pedidos for each row execute function public.auditar();

-- ============ RLS: solo admin autenticado ============
do $$
declare t text;
begin
  foreach t in array array['perfiles','productos','stock_dia','pedidos','pedido_items',
    'tarifas_domicilio','metodos_pago','config','config_historial','config_secretos','auditoria']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['productos','stock_dia','pedidos','pedido_items',
    'tarifas_domicilio','metodos_pago','config']
  loop
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

create policy admin_read on public.config_historial for select to authenticated using (public.is_admin());
create policy admin_read on public.auditoria for select to authenticated using (public.is_admin());
create policy self_read on public.perfiles for select to authenticated using (user_id = auth.uid());
-- config_secretos: sin políticas => inaccesible; solo vía set_secreto()/Edge Functions con service role.

-- ============ Storage: fotos del catálogo (públicas de lectura) y comprobantes (privado) ============
insert into storage.buckets (id, name, public) values ('catalogo', 'catalogo', true) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('comprobantes', 'comprobantes', false) on conflict do nothing;

create policy catalogo_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'catalogo' and public.is_admin()) with check (bucket_id = 'catalogo' and public.is_admin());
create policy comprobantes_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.is_admin());

-- ============ Realtime para pedidos en vivo ============
alter publication supabase_realtime add table public.pedidos;
