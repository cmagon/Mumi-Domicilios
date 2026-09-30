-- Regla de escalamiento: el bot recopila datos del cliente antes de avisar al admin.
-- Idempotente: solo agrega el bloque si aún no está en el system prompt.
update public.config
   set valor = valor || E'\n\nAntes de escalar a un humano (notificar_humano):\n- Pide siempre el nombre completo y el teléfono de contacto del cliente.\n- Pregunta qué necesita, con detalles: para pedidos grandes o eventos, sabores, cantidades y fecha; para personalizaciones, en qué consiste; para quejas, qué ocurrió.\n- Llama a notificar_humano solo cuando tengas esos datos. Después avisa al cliente que en un momento le escribe alguien del equipo.'
 where clave = 'system_prompt'
   and valor not like '%Antes de escalar a un humano%';
