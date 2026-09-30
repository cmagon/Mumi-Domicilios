-- Resumen de clientes calculado desde pedidos (sin duplicar datos). Respeta RLS: solo admin lo ve.
create or replace view public.clientes_resumen with (security_invoker = true) as
with base as (
  select right(regexp_replace(cliente_telefono, '\D', '', 'g'), 10) as clave,
         (array_agg(cliente_nombre order by creado_en desc))[1] as nombre,
         (array_agg(cliente_telefono order by creado_en desc))[1] as telefono,
         count(*) as pedidos,
         coalesce(sum(total), 0) as total_gastado,
         max(creado_en) as ultimo_pedido,
         min(creado_en) as primer_pedido
    from public.pedidos
   where estado <> 'cancelado'
   group by 1
), fav as (
  select right(regexp_replace(p.cliente_telefono, '\D', '', 'g'), 10) as clave,
         pr.nombre as sabor, sum(i.cantidad) as unidades
    from public.pedidos p
    join public.pedido_items i on i.pedido_id = p.id
    join public.productos pr on pr.id = i.producto_id
   where p.estado <> 'cancelado'
   group by 1, 2
)
select b.telefono, b.nombre, b.pedidos, b.total_gastado, b.ultimo_pedido, b.primer_pedido,
       (select string_agg(f.sabor || ' (' || f.unidades || ')', ', ' order by f.unidades desc)
          from (select * from fav where fav.clave = b.clave order by unidades desc limit 3) f) as sabores_favoritos
  from base b;
