-- =====================================================================
-- Sira Propiedades · ACTUALIZACIÓN: papelera, expediente, documentos y archivos
-- Se puede ejecutar varias veces sin problema (no borra nada).
-- Pégalo completo en Supabase → SQL Editor → Run.
-- (Los mismos cambios están al final de configurar-base.sql para instalaciones nuevas.)
-- =====================================================================

-- ---------- A. Papelera de propiedades y fecha de cierre ----------
alter table public.propiedades add column if not exists eliminada_en  timestamptz;
alter table public.propiedades add column if not exists eliminada_por uuid references public.perfiles(id) on delete set null;
alter table public.propiedades add column if not exists cerrada_en    timestamptz;
update public.propiedades set cerrada_en = actualizada where cerrada_en is null and estado in ('vendida','arrendada');
create index if not exists propiedades_eliminada on public.propiedades (eliminada_en) where eliminada_en is not null;

/* mismas personas que hoy pueden eliminar: el dueño, y corredor/asistente solo lo suyo sin publicar */
create or replace function public.puede_papelera(creada uuid, est text, publ boolean) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mi_rol() = 'dueno'
      or (public.mi_rol() in ('corredor','asistente') and creada = auth.uid() and est in ('revision','pausada') and not publ)
$$;
grant execute on function public.puede_papelera(uuid, text, boolean) to authenticated;

create or replace function public.preparar_propiedad() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.codigo := 'SIRA-' || lpad(nextval('public.codigo_seq')::text, 4, '0');
    new.creada := now();
    new.creada_por := auth.uid();
    new.publicada := false;
  elsif auth.uid() is not null then          -- cambios desde el panel: autor, código y fecha no se tocan
    new.id := old.id; new.codigo := old.codigo; new.creada := old.creada; new.creada_por := old.creada_por;
    new.publicada := old.publicada;
  end if;
  /* papelera: solo quien puede eliminar la propiedad puede mandarla ahí o restaurarla */
  if tg_op = 'INSERT' then
    new.eliminada_en := null; new.eliminada_por := null;
  elsif auth.uid() is not null then
    if new.eliminada_en is distinct from old.eliminada_en then
      if not public.puede_papelera(old.creada_por, old.estado, old.publicada) then
        raise exception 'permission denied: tu perfil no puede eliminar ni restaurar esta propiedad';
      end if;
      if new.eliminada_en is not null then new.eliminada_en := now(); new.eliminada_por := auth.uid();
      else new.eliminada_por := null; end if;
    else
      new.eliminada_en := old.eliminada_en; new.eliminada_por := old.eliminada_por;
    end if;
  end if;
  /* fecha en que pasó a vendida o arrendada (para el expediente) */
  if new.estado in ('vendida','arrendada') then
    if tg_op = 'INSERT' or old.estado is distinct from new.estado then new.cerrada_en := now();
    else new.cerrada_en := old.cerrada_en; end if;
  else
    new.cerrada_en := null;
  end if;
  if new.estado in ('disponible','reservada','vendida','arrendada') then new.publicada := true; end if;
  if (new.datos->>'operacion') = 'Arriendo' and new.estado = 'vendida' then
    raise exception 'Una propiedad en arriendo no puede quedar como vendida (usa "arrendada").';
  elsif (new.datos->>'operacion') = 'Venta' and new.estado = 'arrendada' then
    raise exception 'Una propiedad en venta no puede quedar como arrendada (usa "vendida").';
  end if;
  new.actualizada := clock_timestamp();
  new.actualizada_por := auth.uid();
  return new;
end $$;
drop trigger if exists preparar_propiedad on public.propiedades;
create trigger preparar_propiedad before insert or update on public.propiedades
  for each row execute function public.preparar_propiedad();

create or replace function public.anotar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  yo text := coalesce((select nullif(nombre,'') from public.perfiles where id = auth.uid()),
                      (select email from public.perfiles where id = auth.uid()), 'Sistema');
  tit text;
begin
  if tg_table_name = 'propiedades' then
    if tg_op = 'INSERT' then
      tit := coalesce(new.datos->>'tipo','') || ' en ' || coalesce(new.datos->>'comuna','');
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Creó', new.codigo, tit || ' · ' || new.estado);
    elsif tg_op = 'DELETE' then
      tit := coalesce(old.datos->>'tipo','') || ' en ' || coalesce(old.datos->>'comuna','');
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Eliminó', old.codigo, tit);
    elsif new.eliminada_en is distinct from old.eliminada_en then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo,
        case when new.eliminada_en is null then 'Restauró' else 'Envió a la papelera' end, new.codigo,
        coalesce(new.datos->>'tipo','') || ' en ' || coalesce(new.datos->>'comuna',''));
    elsif new.estado is distinct from old.estado then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Cambió estado', new.codigo, old.estado || ' → ' || new.estado);
      if new.datos is distinct from old.datos then
        insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Editó', new.codigo, null);
      end if;
    elsif new.datos is distinct from old.datos then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Editó',
        new.codigo, case when (new.datos->'precio') is distinct from (old.datos->'precio')
                         then 'Precio: ' || coalesce(old.datos->>'precio','—') || ' → ' || coalesce(new.datos->>'precio','—') end);
    end if;
  elsif tg_table_name = 'perfiles' then
    if new.rol is distinct from old.rol or new.activo is distinct from old.activo then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Cambió perfil', null,
        coalesce(nullif(new.nombre,''), new.email) || ': ' || old.rol || case when old.activo then '' else ' (inactivo)' end
        || ' → ' || new.rol || case when new.activo then '' else ' (inactivo)' end);
    end if;
  elsif tg_table_name = 'config' then
    insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Actualizó ' || new.clave, null,
      case when new.clave in ('plantillas','portales') then null else new.valor::text end);
  elsif tg_table_name = 'contratos' then
    if tg_op = 'INSERT' then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Creó contrato', null, coalesce(new.datos->>'nombre',''));
    elsif tg_op = 'DELETE' then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Eliminó contrato', null, coalesce(old.datos->>'nombre',''));
    elsif (new.datos->'monto') is distinct from (old.datos->'monto') then
      insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo, 'Cambió arriendo', null,
        coalesce(new.datos->>'nombre','') || ': ' || coalesce(old.datos->>'monto','—') || ' → ' || coalesce(new.datos->>'monto','—'));
    end if;
  elsif tg_table_name = 'pagos' and exists (select 1 from public.contratos where id = coalesce(new.contrato_id, old.contrato_id)) then
    -- (si el contrato se eliminó, sus pagos se borran sin llenar el historial)
    insert into historial(quien, quien_nombre, accion, codigo, detalle) values (auth.uid(), yo,
      case tg_op when 'DELETE' then 'Anuló pago' else 'Registró pago' end, null,
      coalesce((select datos->>'nombre' from public.contratos where id = coalesce(new.contrato_id, old.contrato_id)),'')
      || ' · ' || to_char(coalesce(new.periodo, old.periodo), 'MM/YYYY')
      || case when tg_op = 'DELETE' then '' else ' · $' || coalesce(new.monto_pagado, 0)::text end);
  end if;
  return coalesce(new, old);
end $$;

/* lo eliminado no se ve en el sitio ni en el listado; solo en la papelera de quien puede restaurarlo */
drop policy if exists prop_ver on public.propiedades;
create policy prop_ver on public.propiedades for select to authenticated
  using (public.mi_rol() in ('dueno','gerente','corredor','asistente','lectura')
         and (eliminada_en is null or public.puede_papelera(creada_por, estado, publicada)));
/* para borrar para siempre, primero pasa por la papelera */
drop policy if exists prop_borrar on public.propiedades;
create policy prop_borrar on public.propiedades for delete to authenticated
  using (eliminada_en is not null and public.puede_papelera(creada_por, estado, publicada));
create or replace view public.publicas as
  select codigo, estado, creada,
         case when coalesce((datos->>'mapaExacto')::boolean, false) then datos else datos - 'direccion' - 'lat' - 'lng' end as datos
  from public.propiedades
  where estado in ('disponible','reservada','vendida','arrendada') and eliminada_en is null;

-- ---------- B. Quién puede ver los documentos y archivos ----------
/* dueño, gerente y asistente: todas las propiedades. Corredor: las que creó o las que administra. Solo lectura: ninguna. */
create or replace function public.puede_docs_prop(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.mi_rol()
    when 'dueno' then true
    when 'gerente' then true
    when 'asistente' then true
    when 'corredor' then exists (select 1 from public.propiedades where id = pid and creada_por = auth.uid())
                      or exists (select 1 from public.contratos where propiedad_id = pid and encargado = auth.uid())
    else false end
$$;
create or replace function public.puede_archivo(pid uuid, cid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when pid is not null then public.puede_docs_prop(pid) else coalesce(public.puede_contrato(cid), false) end
$$;
grant execute on function public.puede_docs_prop(uuid), public.puede_archivo(uuid, uuid) to authenticated;

-- ---------- C. Carpeta de documentos legales (casilleros) ----------
create table if not exists public.doc_estado (
  propiedad_id    uuid not null references public.propiedades(id) on delete cascade,
  operacion       text not null check (operacion in ('venta','arriendo')),
  clave           text not null check (length(clave) between 1 and 40),
  estado          text not null default 'pendiente' check (estado in ('pendiente','recibido','na')),
  emitido         date,
  vigencia_dias   integer check (vigencia_dias is null or vigencia_dias between 0 and 3650),   -- null = usa la general; 0 = no vence
  actualizada     timestamptz not null default now(),
  actualizada_por uuid references public.perfiles(id) on delete set null,
  primary key (propiedad_id, operacion, clave)
);
drop trigger if exists sello_cambio on public.doc_estado;
create trigger sello_cambio before insert or update on public.doc_estado
  for each row execute function public.sello_cambio();
alter table public.doc_estado enable row level security;
drop policy if exists docest_todo on public.doc_estado;
create policy docest_todo on public.doc_estado for all to authenticated
  using (public.puede_docs_prop(propiedad_id)) with check (public.puede_docs_prop(propiedad_id));

/* vigencia general (en días hábiles) de cada documento: la edita el dueño o el gerente. {"mandato":0} = no vence */
insert into public.config (clave, valor) values ('vigencias', '{"mandato": 0}') on conflict (clave) do nothing;

-- ---------- D. Archivos de cada propiedad o arriendo ----------
create table if not exists public.archivos (
  id          uuid primary key default gen_random_uuid(),
  propiedad_id uuid references public.propiedades(id) on delete cascade,
  contrato_id  uuid references public.contratos(id) on delete cascade,
  categoria   text not null check (categoria in ('contrato_arriendo','contrato_compraventa','acta_ingreso','otros','legal')),
  etiqueta    text check (etiqueta is null or length(etiqueta) <= 60),       -- nombre libre de la categoría "Otros"
  doc_clave   text check (doc_clave is null or length(doc_clave) <= 40),     -- si es el respaldo de un documento legal
  nombre      text not null check (length(nombre) between 1 and 200),
  ruta        text not null unique check (length(ruta) between 5 and 300),
  tamano      integer check (tamano is null or tamano >= 0),
  tipo        text check (tipo is null or length(tipo) <= 100),
  subido_en   timestamptz not null default now(),
  subido_por  uuid references public.perfiles(id) on delete set null,
  check ((propiedad_id is not null) <> (contrato_id is not null)),
  check (categoria <> 'legal' or doc_clave is not null)
);
create index if not exists archivos_prop on public.archivos (propiedad_id);
create index if not exists archivos_ctr  on public.archivos (contrato_id);
/* quién subió y cuándo lo pone la base: nadie lo puede falsear */
create or replace function public.preparar_archivo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.subido_en := now(); new.subido_por := auth.uid();
  return new;
end $$;
drop trigger if exists preparar_archivo on public.archivos;
create trigger preparar_archivo before insert on public.archivos
  for each row execute function public.preparar_archivo();
alter table public.archivos enable row level security;
drop policy if exists arch_ver on public.archivos;
create policy arch_ver on public.archivos for select to authenticated
  using (public.mi_rol() in ('dueno','gerente','corredor','asistente') and public.puede_archivo(propiedad_id, contrato_id));
drop policy if exists arch_subir on public.archivos;
create policy arch_subir on public.archivos for insert to authenticated
  with check (public.mi_rol() in ('dueno','gerente','corredor','asistente') and public.puede_archivo(propiedad_id, contrato_id));
drop policy if exists arch_borrar on public.archivos;
create policy arch_borrar on public.archivos for delete to authenticated
  using (public.mi_rol() in ('dueno','gerente','corredor','asistente') and public.puede_archivo(propiedad_id, contrato_id)
         and (public.mi_rol() in ('dueno','gerente') or subido_por = auth.uid()));

revoke all on public.doc_estado, public.archivos from anon, authenticated;
grant select, insert, update, delete on public.doc_estado to authenticated;
grant select, insert, delete on public.archivos to authenticated;

-- ---------- E. Almacenamiento PRIVADO para documentos (se abren con enlaces temporales) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

/* ¿esta ruta pertenece a un archivo que la persona puede ver? */
create or replace function public.puede_ver_ruta(r text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mi_rol() in ('dueno','gerente','corredor','asistente')
     and exists (select 1 from public.archivos a where a.ruta = r and public.puede_archivo(a.propiedad_id, a.contrato_id))
$$;
grant execute on function public.puede_ver_ruta(text) to authenticated;

drop policy if exists docs_subir on storage.objects;
create policy docs_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.mi_rol() in ('dueno','gerente','corredor','asistente')
              and (storage.foldername(name))[1] in ('p','c'));
drop policy if exists docs_ver on storage.objects;
create policy docs_ver on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (public.puede_ver_ruta(name) or owner_id = auth.uid()::text));
drop policy if exists docs_borrar on storage.objects;
create policy docs_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (public.mi_rol() in ('dueno','gerente') or owner_id = auth.uid()::text));
