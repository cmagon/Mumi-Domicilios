-- Gemini como proveedor de pruebas, motor de audio configurable y alertas de errores de IA

create table if not exists public.alertas_ia (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('cuota', 'clave', 'audio', 'error')),
  detalle text not null,
  notificada boolean not null default false,
  resuelta boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists alertas_ia_abiertas_idx on public.alertas_ia (creado_en desc) where not resuelta;

alter table public.alertas_ia enable row level security;
drop policy if exists admin_all on public.alertas_ia;
create policy admin_all on public.alertas_ia for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Proveedor de pruebas: Gemini para chat y audio (se puede cambiar desde Configuración)
insert into public.config (clave, valor) values ('motor_audio', 'gemini') on conflict (clave) do nothing;
update public.config set valor = 'gemini' where clave = 'proveedor_ia' and valor = 'claude';
