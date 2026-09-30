# Prompt del bot (v2) y comportamiento natural

El texto completo está en [`prompt-v2.txt`](./prompt-v2.txt) y se carga en Supabase con `supabase/migrations/0008_prompt_v2_seguimiento.sql`. Se edita desde el micrositio (Configuración → System prompt, con historial de versiones).

## Cómo abren las conversaciones los clientes (base del prompt)
Resumen de patrones típicos de ventas por WhatsApp (criterio propio del diseño; una búsqueda web solo confirmó preguntas frecuentes genéricas de restaurantes y la mecánica técnica del indicador "escribiendo"):
- Solo saludo: "hola", "buenas tardes", "ola", "holaa".
- Interés desde publicidad: "info", "me interesa", "vi su publicidad".
- Pregunta directa: precio, sabores, si hay hoy, domicilio, ubicación, tiempos.
- Pedido directo: "quiero 6 de cacao".
- Cliente recurrente: "lo mismo de la vez pasada".
- Eventos o regalos, quejas, regateo y mensajes fuera de tema.
- Errores típicos: "bnas", "q sabores", "cuanto bale", "galetas", "kiero", "xfa"; mensajes partidos en varias líneas, audios y respuestas de una palabra ("si", "dale", "ok", 👍).

## Cómo se comporta (qué es prompt y qué es código)
| Comportamiento | Dónde vive |
|---|---|
| Tono, orden del flujo (saludo → catálogo → fotos → pregunta), tipos de apertura, ortografía, cuándo escalar, frase de "no puedo ayudar" con el número de atención | Prompt (editable) |
| Fotos en el punto exacto: el bot escribe `[[FOTOS]]` y el sistema las envía ahí | Prompt + código |
| "Escribiendo…", visto azul y pausa proporcional al largo de cada mensaje; respuestas en varios mensajes cortos | Código; se ajusta en Configuración |
| Esperar unos segundos por si el cliente sigue escribiendo y responder todo junto | Código; Configuración |
| Recordatorios si el cliente no responde (comprobante, dirección…): a los 45 min y a las 6 h, solo de 7:00 a 20:00 y dentro de la ventana de 24 h | Función `seguimientos` + herramienta `marcar_pendiente`; Configuración |
| Ubicación compartida = dirección; stickers y reacciones | Código |
| Número de atención personalizada | Configuración (`numero_atencion`) |

## Activar los recordatorios (cron)
En Supabase → Integrations → Cron → Create job: tipo **Supabase Edge Function**, función `seguimientos`, método POST, cada 10 minutos (`*/10 * * * *`), con el header `x-cron-secret` igual al secret `NOTIFY_WEBHOOK_SECRET`.
