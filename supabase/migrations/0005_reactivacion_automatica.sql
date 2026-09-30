-- Reactivación automática del bot tras la atención humana
alter table public.conversaciones add column if not exists humano_desde timestamptz;
update public.conversaciones set humano_desde = coalesce(humano_desde, actualizado_en) where humano;
insert into public.config (clave, valor) values ('horas_humano', '12') on conflict (clave) do nothing;
