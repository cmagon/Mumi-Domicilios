-- Los avisos de los chats se ocultan solos cuando ya tuvieron solución.
-- Cuando una persona del equipo responde al cliente, se dan por atendidos los avisos de ese chat que pedían atención humana
-- (los de pago, cancelación o dirección se siguen cerrando solos cuando cambia el pedido: ver 0032).
create or replace function public.limpiar_avisos_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rol = 'admin' then
    update public.notificaciones n set leida = true
     where n.telefono = new.telefono and not n.leida
       and n.tipo in ('atencion', 'sin_respuesta', 'pedido_grande')
       and n.titulo not like 'Falta la dirección%';
  end if;
  return new;
end $$;
drop trigger if exists limpiar_avisos_chat_trg on public.mensajes;
create trigger limpiar_avisos_chat_trg after insert on public.mensajes for each row execute function public.limpiar_avisos_chat();

-- Limpieza de lo que ya estaba atendido: avisos de chats donde el equipo respondió después del aviso.
update public.notificaciones n set leida = true
 where not n.leida and n.telefono is not null
   and n.tipo in ('atencion', 'sin_respuesta', 'pedido_grande') and n.titulo not like 'Falta la dirección%'
   and exists (select 1 from public.mensajes m where m.telefono = n.telefono and m.rol = 'admin' and m.creado_en > n.creado_en);

-- Avisos de pedidos de fechas que ya pasaron
update public.notificaciones n set leida = true from public.pedidos p
 where n.pedido_id = p.id and not n.leida and p.fecha_entrega < current_date - 1 and n.tipo in ('sin_stock', 'cambio', 'atencion', 'pedido_grande');
