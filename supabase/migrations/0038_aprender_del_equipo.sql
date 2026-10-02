-- Aprendizaje de cómo responde el equipo humano: marca de conversaciones ya revisadas.
alter table public.chats_revision add column if not exists equipo_revisado_en timestamptz;
