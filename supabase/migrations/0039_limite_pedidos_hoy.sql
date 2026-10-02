-- Límite de pedidos para el mismo día: por defecto, hasta 1 h antes de que EMPIECEN las entregas (configurable).
insert into public.config (clave, valor) values ('limite_pedidos_hoy', 'inicio') on conflict (clave) do nothing;
-- Ajuste puntual del prompt (conserva tus ediciones): la regla pasa a contar desde el inicio de las entregas.
update public.config
   set valor = replace(valor, 'hasta 1 hora antes de que termine el horario de entregas (el sistema lo calcula)', 'hasta 1 hora antes de que empiecen las entregas (el sistema lo calcula)')
 where clave = 'system_prompt' and position('hasta 1 hora antes de que termine el horario de entregas (el sistema lo calcula)' in valor) > 0;
