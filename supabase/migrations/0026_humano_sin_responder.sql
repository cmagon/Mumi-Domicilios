-- Si la persona que atiende un chat tarda más de N minutos en responder al cliente, el bot lo retoma (0 = desactivado).
insert into public.config (clave, valor) values ('minutos_humano_sin_responder', '5') on conflict (clave) do nothing;
