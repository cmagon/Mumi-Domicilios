# Mumi Delivery

Micrositio de administración (PWA) + esquema Supabase, según el diseño técnico.

## Puesta en marcha
1. En Supabase (proyecto `https://fqjvbzozrqsqyqagmvtv.supabase.co`) ejecuta `supabase/migrations/0001_schema.sql` y luego `supabase/seed.sql` (SQL Editor o `supabase db push`).
2. Crea tu usuario en Auth y hazlo admin: `insert into public.perfiles (user_id) values ('<uuid>');`
3. `cd web && cp .env.example .env`, pega la **anon key** (Project Settings → API) en `VITE_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev`

La API key de IA se guarda vía RPC `set_secreto` en `config_secretos` (sin acceso desde el cliente).
Pendiente: Edge Function del webhook de WhatsApp, impresión térmica automática, plantillas de WhatsApp.

## Bot de WhatsApp (Edge Functions)
```bash
supabase login && supabase link --project-ref fqjvbzozrqsqyqagmvtv
supabase db push                       # aplica 0001 y 0002
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_APP_SECRET=... \
  WHATSAPP_VERIFY_TOKEN=<texto-que-tu-elijas> NOTIFY_WEBHOOK_SECRET=<otro-texto> \
  OPENAI_API_KEY=<solo si usas Claude y quieres notas de voz>
supabase functions deploy whatsapp-webhook
supabase functions deploy notificar-listo
```
- Meta → WhatsApp → Configuración: callback `https://fqjvbzozrqsqyqagmvtv.supabase.co/functions/v1/whatsapp-webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, suscribe `messages`.
- Supabase → Database → Webhooks: tabla `pedidos`, evento UPDATE, función `notificar-listo`, header `x-webhook-secret: <NOTIFY_WEBHOOK_SECRET>`.
- Proveedor de IA y su API key se cambian desde el micrositio (Configuración).
- Admin por WhatsApp: `Hoy: cacao 30, limón 20, ...` actualiza el excedente; `reanudar 57300...` reactiva el bot tras una escalada. Domiciliario: `pedidos`.
