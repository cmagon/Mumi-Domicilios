-- Casos: cada aviso lleva un número corto (#12) para que el admin responda por WhatsApp sin confusión ("12: tu mensaje"),
-- y se registra cuándo se envió por WhatsApp para poder agrupar los avisos en un solo resumen cuando hay mucho movimiento.
create sequence if not exists public.notificaciones_caso_seq;
alter table public.notificaciones add column if not exists caso bigint default nextval('public.notificaciones_caso_seq');
alter table public.notificaciones add column if not exists wa_enviado_en timestamptz;
create index if not exists notificaciones_caso_idx on public.notificaciones (caso);
-- Lo anterior no se reenvía
update public.notificaciones set wa_enviado_en = now() where wa_enviado_en is null;
