-- Biblioteca de imágenes y videos del bot: material con contexto (p. ej. "así se ven las galletas en una caja") que el bot puede enviar en las conversaciones.
-- Lo sube el admin por WhatsApp (con el contexto) o desde el micrositio (Catálogo → Imágenes del bot).
create table if not exists public.bot_imagenes (
  id uuid primary key default gen_random_uuid(),
  descripcion text not null default '',
  url text not null,
  tipo text not null default 'image' check (tipo in ('image', 'video')),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
alter table public.bot_imagenes enable row level security;
drop policy if exists admin_all on public.bot_imagenes;
create policy admin_all on public.bot_imagenes for all to authenticated using (public.is_admin()) with check (public.is_admin());
