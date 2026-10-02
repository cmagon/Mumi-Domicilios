-- Integrar una regla aprendida al prompt maestro: se agrega al final, el prompt se actualiza y queda un respaldo automático del anterior.
alter table public.bot_aprendizajes drop constraint if exists bot_aprendizajes_estado_check;
alter table public.bot_aprendizajes add constraint bot_aprendizajes_estado_check check (estado in ('pendiente', 'activa', 'descartada', 'integrada'));

create or replace function public.integrar_regla(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r text; v text;
begin
  if not public.is_admin() then raise exception 'sin permiso'; end if;
  select regla into r from public.bot_aprendizajes where id = p_id and estado in ('pendiente', 'activa');
  if r is null then raise exception 'regla no disponible'; end if;
  select valor into v from public.config where clave = 'system_prompt';
  if v is null then raise exception 'no hay prompt maestro'; end if;
  -- el trigger de config guarda un respaldo automático del prompt anterior antes de este cambio
  update public.config set valor =
    case when position('# APRENDIZAJES INTEGRADOS' in v) > 0 then rtrim(v) || E'\n- ' || r
         else rtrim(v) || E'\n\n# APRENDIZAJES INTEGRADOS\n- ' || r end
   where clave = 'system_prompt';
  update public.bot_aprendizajes set estado = 'integrada', decidido_en = now() where id = p_id;
end $$;
