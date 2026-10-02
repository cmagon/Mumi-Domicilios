-- 1) Responder citando un mensaje del cliente (tipo WhatsApp): se guarda el texto citado.
alter table public.mensajes add column if not exists cita text;

-- 2) Suscripciones de notificaciones push (una por dispositivo/navegador del admin).
create table if not exists public.push_suscripciones (
  endpoint text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);
alter table public.push_suscripciones enable row level security;
drop policy if exists push_admin on public.push_suscripciones;
create policy push_admin on public.push_suscripciones for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3) Aprendizaje global: ajuste puntual del prompt (idempotente, conserva tus ediciones).
update public.config
   set valor = valor || E'\n\nCRITERIOS DEL EQUIPO (aprendizaje global): lo que el equipo acordó o respondió a un cliente (p. ej. posibles descuentos por compras grandes, excepciones, tiempos) puedes ofrecerlo o sugerirlo a OTRO cliente que pregunte lo mismo, de forma general y sin dar cifras, porcentajes ni cantidades exactas; si insiste en números, usa avisar_equipo para que una persona los confirme. Nunca reveles datos de otros clientes.'
 where clave = 'system_prompt' and position('CRITERIOS DEL EQUIPO (aprendizaje global)' in valor) = 0;

-- 4) Claves VAPID de las notificaciones push (se generan solas desde el micrositio; solo las lee el servidor).
create table if not exists public.push_claves (
  id int primary key default 1 check (id = 1),
  publica text not null,
  privada text not null
);
alter table public.push_claves enable row level security; -- sin políticas: solo la service role
