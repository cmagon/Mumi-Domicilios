# Mumi Delivery

Micrositio de administración (PWA) + esquema Supabase, según el diseño técnico.

## Puesta en marcha
1. En Supabase (proyecto `https://fqjvbzozrqsqyqagmvtv.supabase.co`) ejecuta `supabase/migrations/0001_schema.sql` y luego `supabase/seed.sql` (SQL Editor o `supabase db push`).
2. Crea tu usuario en Auth y hazlo admin: `insert into public.perfiles (user_id) values ('<uuid>');`
3. `cd web && cp .env.example .env`, pega la **anon key** (Project Settings → API) en `VITE_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev`

La API key de IA se guarda vía RPC `set_secreto` en `config_secretos` (sin acceso desde el cliente).
Pendiente: Edge Function del webhook de WhatsApp, impresión térmica automática, plantillas de WhatsApp.
