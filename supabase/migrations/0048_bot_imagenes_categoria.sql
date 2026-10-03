-- Categoría de las imágenes del bot (Volantes, Productos, Promos…) para ordenarlas en la galería.
alter table public.bot_imagenes add column if not exists categoria text not null default 'General';
