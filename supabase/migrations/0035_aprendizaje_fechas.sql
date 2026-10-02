-- Reglas de aprendizaje con fecha de vencimiento opcional (pasada la fecha el bot deja de aplicarlas)
alter table public.bot_aprendizajes add column if not exists vigente_hasta date;
