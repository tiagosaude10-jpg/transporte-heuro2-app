alter table public.transport_vehicles
  add column if not exists license_plate text;

alter table public.transport_vehicles
  drop constraint if exists transport_vehicles_license_plate_check;

alter table public.transport_vehicles
  add constraint transport_vehicles_license_plate_check
  check (
    license_plate is null
    or license_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
  );

alter table public.transport_shift_assignments
  alter column vehicle_id drop not null;

alter table public.transport_shift_assignments
  add column if not exists assumed_at timestamptz;

create index if not exists transport_shift_assignments_active_idx
  on public.transport_shift_assignments(roster_id, vehicle_id, professional_role)
  where assumed_at is not null;

drop policy if exists "approved users read shift assignments" on public.transport_shift_assignments;
create policy "users read own shift assignment or admin reads all"
on public.transport_shift_assignments for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin_general())
);

create or replace function public.save_transport_vehicle_plates(
  p_plates jsonb
) returns setof public.transport_vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_code text;
  v_plate text;
begin
  if auth.uid() is null or not public.is_admin_general() then
    raise exception 'Somente o Administrador Geral pode cadastrar as placas.';
  end if;
  if jsonb_typeof(coalesce(p_plates, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de placas inválida.';
  end if;

  for v_item in select value from jsonb_array_elements(p_plates)
  loop
    v_code := upper(trim(coalesce(v_item->>'code', '')));
    v_plate := upper(regexp_replace(coalesce(v_item->>'license_plate', ''), '[^A-Za-z0-9]', '', 'g'));
    if v_code not in ('UTI-01', 'BASICA-01', 'BASICA-02') then
      raise exception 'Ambulância inválida.';
    end if;
    if v_plate <> '' and v_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
      raise exception 'A placa de % deve estar no padrão ABC1D23 ou ABC1234.', v_code;
    end if;
    update public.transport_vehicles
       set license_plate = nullif(v_plate, ''), updated_at = now()
     where code = v_code and active = true;
    if not found then raise exception 'Ambulância % não encontrada.', v_code; end if;
  end loop;

  return query
    select * from public.transport_vehicles
    where code in ('UTI-01', 'BASICA-01', 'BASICA-02')
    order by case code when 'UTI-01' then 1 when 'BASICA-01' then 2 else 3 end;
end;
$$;

revoke all on function public.save_transport_vehicle_plates(jsonb) from public, anon;
grant execute on function public.save_transport_vehicle_plates(jsonb) to authenticated;

create or replace function public.save_transport_shift_roster(
  p_shift_date date,
  p_assignments jsonb
) returns public.transport_shift_rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.transport_shift_rosters%rowtype;
  v_driver_required boolean := true;
  v_item jsonb;
  v_profile public.profiles%rowtype;
  v_role text;
  v_user_id uuid;
  v_ids uuid[] := '{}';
begin
  if auth.uid() is null or not public.is_admin_general() then
    raise exception 'Somente o Administrador Geral pode salvar a escala.';
  end if;
  if p_shift_date is null then raise exception 'Informe a data do plantão.'; end if;
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de profissionais inválida.';
  end if;

  select coalesce(
    (select driver_report_enabled from public.transport_app_settings where id = 1),
    true
  ) into v_driver_required;

  insert into public.transport_shift_rosters(shift_date, driver_required, created_by, updated_by)
  values (p_shift_date, v_driver_required, auth.uid(), auth.uid())
  on conflict (shift_date) do update set
    driver_required = excluded.driver_required,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_roster;

  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    v_role := lower(trim(coalesce(v_item->>'professional_role', '')));
    begin
      v_user_id := (v_item->>'user_id')::uuid;
    exception when others then
      raise exception 'Profissional inválido na escala.';
    end;
    if v_role not in ('medico', 'enfermagem', 'motorista') then
      raise exception 'Categoria profissional inválida.';
    end if;
    if v_user_id = any(v_ids) then
      raise exception 'O mesmo profissional não pode aparecer duas vezes na escala.';
    end if;

    select * into v_profile from public.profiles
    where id = v_user_id
      and status::text = 'aprovado'
      and authorized_access::text in ('executante', 'solicitante_executante', 'administrador_geral');
    if v_profile.id is null then
      raise exception 'Profissional não aprovado ou sem acesso de execução.';
    end if;
    if public.transport_professional_role(v_profile.job_role) is distinct from v_role then
      raise exception 'O cargo de % não corresponde à categoria selecionada.', coalesce(v_profile.display_name, v_profile.full_name);
    end if;

    if exists (
      select 1 from public.transport_shift_assignments a
      where a.roster_id = v_roster.id
        and a.user_id = v_user_id
        and a.assumed_at is not null
        and a.professional_role is distinct from v_role
    ) then
      raise exception 'A categoria de um profissional que já assumiu o plantão não pode ser alterada.';
    end if;

    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role
    ) values (
      v_roster.id, null, v_profile.id,
      coalesce(v_profile.display_name, v_profile.full_name), v_role
    )
    on conflict (roster_id, user_id) do update set
      user_name = excluded.user_name,
      professional_role = excluded.professional_role;

    v_ids := array_append(v_ids, v_user_id);
  end loop;

  if exists (
    select 1 from public.transport_shift_assignments a
    where a.roster_id = v_roster.id
      and not (a.user_id = any(v_ids))
      and a.assumed_at is not null
  ) then
    raise exception 'Não é possível retirar da escala um profissional que já assumiu o plantão.';
  end if;

  delete from public.transport_shift_assignments a
  where a.roster_id = v_roster.id
    and not (a.user_id = any(v_ids));

  return v_roster;
end;
$$;

revoke all on function public.save_transport_shift_roster(date, jsonb) from public, anon;
grant execute on function public.save_transport_shift_roster(date, jsonb) to authenticated;

create or replace function public.assume_transport_shift(
  p_vehicle_id uuid
) returns public.transport_shift_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_assignment public.transport_shift_assignments%rowtype;
  v_vehicle public.transport_vehicles%rowtype;
  v_local_now timestamp := timezone('America/Porto_Velho', now());
  v_shift_date date;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null or v_profile.status::text <> 'aprovado'
     or v_profile.authorized_access::text not in ('executante', 'solicitante_executante', 'administrador_geral') then
    raise exception 'Acesso não autorizado.';
  end if;

  v_shift_date := case when v_local_now::time < time '07:00'
    then v_local_now::date - 1 else v_local_now::date end;
  v_role := public.transport_professional_role(v_profile.job_role);
  if v_role is null then
    raise exception 'Seu cargo cadastrado não corresponde a médico, enfermagem ou motorista.';
  end if;

  select a.* into v_assignment
  from public.transport_shift_rosters r
  join public.transport_shift_assignments a on a.roster_id = r.id
  where r.shift_date = v_shift_date and a.user_id = auth.uid()
  for update of a;
  if v_assignment.id is null then
    raise exception 'Seu nome não consta na escala lançada pelo administrador para este plantão.';
  end if;
  if v_assignment.professional_role is distinct from v_role then
    raise exception 'Sua categoria na escala não corresponde ao cargo cadastrado.';
  end if;

  select * into v_vehicle from public.transport_vehicles
  where id = p_vehicle_id and active = true
    and code in ('UTI-01', 'BASICA-01', 'BASICA-02');
  if v_vehicle.id is null then raise exception 'Ambulância inválida.'; end if;
  if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then
    raise exception 'O médico assume automaticamente a UTI 01.';
  end if;

  if exists (
    select 1 from public.transport_shift_assignments a
    where a.roster_id = v_assignment.roster_id
      and a.vehicle_id = v_vehicle.id
      and a.professional_role = v_role
      and a.assumed_at is not null
      and a.user_id <> auth.uid()
  ) then
    raise exception 'Esta categoria já foi assumida por outro profissional nessa ambulância.';
  end if;

  update public.transport_shift_assignments
     set vehicle_id = v_vehicle.id, assumed_at = now()
   where id = v_assignment.id
   returning * into v_assignment;
  return v_assignment;
end;
$$;

revoke all on function public.assume_transport_shift(uuid) from public, anon;
grant execute on function public.assume_transport_shift(uuid) to authenticated;

create or replace function public.accept_transport_request(
  p_request_id uuid,
  p_vehicle_id uuid default null,
  p_team_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.transport_requests%rowtype;
  v_assignment record;
  v_local_now timestamp := timezone('America/Porto_Velho', now());
  v_shift_date date;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null or v_profile.status::text <> 'aprovado' then
    raise exception 'Acesso não autorizado.';
  end if;
  if v_profile.authorized_access::text = 'administrador_geral' then
    return public.accept_transport_request_unchecked(p_request_id, p_vehicle_id, p_team_name);
  end if;

  select * into v_request from public.transport_requests where id = p_request_id;
  if v_request.id is null then raise exception 'Solicitação não encontrada.'; end if;
  v_shift_date := case when v_local_now::time < time '07:00'
    then v_local_now::date - 1 else v_local_now::date end;

  select a.vehicle_id, v.code, v.display_name, v.support_type, a.professional_role
    into v_assignment
  from public.transport_shift_rosters r
  join public.transport_shift_assignments a on a.roster_id = r.id
  join public.transport_vehicles v on v.id = a.vehicle_id
  where r.shift_date = v_shift_date
    and a.user_id = auth.uid()
    and a.assumed_at is not null;

  if v_assignment.vehicle_id is null then
    raise exception 'Assuma primeiro o seu plantão na opção Equipe do Plantão.';
  end if;
  if v_assignment.professional_role is distinct from public.transport_professional_role(v_profile.job_role) then
    raise exception 'Sua categoria no plantão não corresponde ao cargo cadastrado.';
  end if;
  if v_assignment.support_type is distinct from v_request.support_type then
    raise exception 'Sua ambulância do plantão não é compatível com este transporte.';
  end if;
  if p_vehicle_id is not null and p_vehicle_id <> v_assignment.vehicle_id then
    raise exception 'Selecione a ambulância que você assumiu neste plantão.';
  end if;

  return public.accept_transport_request_unchecked(
    p_request_id,
    v_assignment.vehicle_id,
    coalesce(nullif(trim(p_team_name), ''), v_assignment.display_name)
  );
end;
$$;

revoke all on function public.accept_transport_request(uuid, uuid, text) from public, anon;
grant execute on function public.accept_transport_request(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
