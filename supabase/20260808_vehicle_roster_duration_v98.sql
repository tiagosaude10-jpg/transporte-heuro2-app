-- Versão 98: escala organizada por veículo e jornadas de 12h ou 24h.

alter table public.transport_shift_assignments
  add column if not exists duration_hours smallint not null default 24,
  add column if not exists shift_ends_at timestamptz;

alter table public.transport_shift_assignments
  drop constraint if exists transport_shift_assignments_duration_hours_check;
alter table public.transport_shift_assignments
  add constraint transport_shift_assignments_duration_hours_check
  check (duration_hours in (12, 24));

update public.transport_shift_assignments
set shift_ends_at = assumed_at + make_interval(hours => duration_hours)
where assumed_at is not null and shift_ends_at is null;

alter table public.transport_shift_access_requests
  add column if not exists duration_hours smallint not null default 24;

alter table public.transport_shift_access_requests
  drop constraint if exists transport_shift_access_requests_duration_hours_check;
alter table public.transport_shift_access_requests
  add constraint transport_shift_access_requests_duration_hours_check
  check (duration_hours in (12, 24));

create index if not exists transport_shift_assignments_end_idx
  on public.transport_shift_assignments(shift_ends_at)
  where assumed_at is not null;

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
  v_vehicle public.transport_vehicles%rowtype;
  v_role text;
  v_user_id uuid;
  v_vehicle_id uuid;
  v_duration smallint;
  v_ids uuid[] := '{}';
begin
  if auth.uid() is null or not public.is_admin_general() then
    raise exception 'Somente o Administrador Geral pode salvar a escala.';
  end if;
  if p_shift_date is null then raise exception 'Informe a data do plantão.'; end if;
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de profissionais inválida.';
  end if;

  select coalesce((select driver_report_enabled from public.transport_app_settings where id = 1), true)
    into v_driver_required;

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
      v_vehicle_id := (v_item->>'vehicle_id')::uuid;
      v_duration := coalesce((v_item->>'duration_hours')::smallint, 24);
    exception when others then
      raise exception 'Profissional, veículo ou jornada inválidos na escala.';
    end;

    if v_role not in ('medico', 'enfermagem', 'motorista') then
      raise exception 'Categoria profissional inválida.';
    end if;
    if v_duration not in (12, 24) then
      raise exception 'A jornada deve ser de 12 ou 24 horas.';
    end if;
    if v_user_id = any(v_ids) then
      raise exception 'O mesmo profissional não pode aparecer duas vezes na escala.';
    end if;

    select * into v_vehicle from public.transport_vehicles
    where id = v_vehicle_id and active = true
      and code in ('UTI-01', 'BASICA-01', 'BASICA-02');
    if v_vehicle.id is null then raise exception 'Veículo inválido na escala.'; end if;
    if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then
      raise exception 'O médico só pode ser escalado na UTI 01.';
    end if;

    select * into v_profile from public.profiles
    where id = v_user_id and status::text = 'aprovado'
      and authorized_access::text in ('executante', 'solicitante_executante', 'administrador_geral');
    if v_profile.id is null then raise exception 'Profissional não aprovado ou sem acesso de execução.'; end if;
    if public.transport_professional_role(v_profile.job_role) is distinct from v_role then
      raise exception 'O cargo de % não corresponde à categoria selecionada.', coalesce(v_profile.display_name, v_profile.full_name);
    end if;

    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role, duration_hours
    ) values (
      v_roster.id, v_vehicle.id, v_profile.id,
      coalesce(v_profile.display_name, v_profile.full_name), v_role, v_duration
    )
    on conflict (roster_id, user_id) do update set
      user_name = excluded.user_name,
      vehicle_id = case when public.transport_shift_assignments.assumed_at is null then excluded.vehicle_id else public.transport_shift_assignments.vehicle_id end,
      professional_role = case when public.transport_shift_assignments.assumed_at is null then excluded.professional_role else public.transport_shift_assignments.professional_role end,
      duration_hours = case when public.transport_shift_assignments.assumed_at is null then excluded.duration_hours else public.transport_shift_assignments.duration_hours end;

    v_ids := array_append(v_ids, v_user_id);
  end loop;

  delete from public.transport_shift_assignments a
  where a.roster_id = v_roster.id
    and a.assumed_at is null
    and a.professional_role <> 'administrador'
    and not (a.user_id = any(v_ids));

  return v_roster;
end;
$$;

revoke all on function public.save_transport_shift_roster(date, jsonb) from public, anon;
grant execute on function public.save_transport_shift_roster(date, jsonb) to authenticated;

drop function if exists public.assume_transport_shift(uuid);
drop function if exists public.assume_transport_shift(uuid, smallint);
drop function if exists public.assume_transport_shift(uuid, integer);

create function public.assume_transport_shift(
  p_vehicle_id uuid,
  p_duration_hours integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_assignment public.transport_shift_assignments%rowtype;
  v_vehicle public.transport_vehicles%rowtype;
  v_roster public.transport_shift_rosters%rowtype;
  v_local_now timestamp := timezone('America/Porto_Velho', now());
  v_shift_date date;
  v_role text;
  v_conflict text;
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if p_duration_hours not in (12, 24) then raise exception 'Escolha uma jornada de 12 ou 24 horas.'; end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null or v_profile.status::text <> 'aprovado'
     or v_profile.authorized_access::text not in ('executante', 'solicitante_executante', 'administrador_geral') then
    raise exception 'Acesso não autorizado.';
  end if;

  select * into v_vehicle from public.transport_vehicles
  where id = p_vehicle_id and active = true and code in ('UTI-01', 'BASICA-01', 'BASICA-02');
  if v_vehicle.id is null then raise exception 'Ambulância inválida.'; end if;

  v_shift_date := case when v_local_now::time < time '07:00' then v_local_now::date - 1 else v_local_now::date end;
  insert into public.transport_shift_rosters(shift_date, driver_required, created_by, updated_by)
  values (v_shift_date, coalesce((select driver_report_enabled from public.transport_app_settings where id = 1), true), auth.uid(), auth.uid())
  on conflict (shift_date) do update set updated_at = public.transport_shift_rosters.updated_at
  returning * into v_roster;

  perform 1 from public.transport_shift_rosters where id = v_roster.id for update;

  if v_profile.authorized_access::text = 'administrador_geral' then
    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at, duration_hours, shift_ends_at
    ) values (
      v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name),
      'administrador', now(), p_duration_hours, now() + make_interval(hours => p_duration_hours)
    )
    on conflict (roster_id, user_id) do update set
      vehicle_id = excluded.vehicle_id,
      user_name = excluded.user_name,
      professional_role = 'administrador',
      assumed_at = now(),
      duration_hours = excluded.duration_hours,
      shift_ends_at = now() + make_interval(hours => excluded.duration_hours)
    returning * into v_assignment;
    return jsonb_build_object('status', 'ativo', 'assignment_id', v_assignment.id, 'vehicle_id', v_vehicle.id, 'duration_hours', p_duration_hours, 'admin_override', true);
  end if;

  v_role := public.transport_professional_role(v_profile.job_role);
  if v_role is null then raise exception 'Seu cargo cadastrado não corresponde a médico, enfermagem ou motorista.'; end if;
  if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then raise exception 'O médico assume automaticamente a UTI 01.'; end if;

  select * into v_assignment from public.transport_shift_assignments
  where roster_id = v_roster.id and user_id = auth.uid() for update;

  if v_assignment.id is not null and v_assignment.professional_role is distinct from v_role then
    raise exception 'Sua categoria na escala não corresponde ao cargo cadastrado.';
  end if;

  if v_assignment.id is not null and v_assignment.vehicle_id is not null
     and v_assignment.vehicle_id <> v_vehicle.id and v_assignment.assumed_at is null then
    v_conflict := 'Você foi escalado pelo administrador em outro veículo.';
  end if;

  if v_conflict is null and exists (
    select 1 from public.transport_shift_assignments a
    where a.roster_id = v_roster.id and a.vehicle_id = v_vehicle.id
      and a.professional_role = v_role and a.user_id <> auth.uid()
      and (
        a.assumed_at is null
        or a.shift_ends_at is null
        or a.shift_ends_at > now()
      )
  ) then
    v_conflict := 'Esta categoria já possui outro profissional escalado ou ativo neste veículo.';
  end if;

  if v_conflict is not null then
    update public.transport_shift_access_requests set
      vehicle_id = v_vehicle.id,
      professional_role = v_role,
      duration_hours = p_duration_hours,
      conflict_reason = v_conflict,
      requested_at = now()
    where roster_id = v_roster.id and user_id = auth.uid() and status = 'pendente'
    returning id into v_request_id;

    if v_request_id is null then
      insert into public.transport_shift_access_requests(
        roster_id, shift_date, vehicle_id, user_id, user_name,
        professional_role, duration_hours, conflict_reason
      ) values (
        v_roster.id, v_shift_date, v_vehicle.id, v_profile.id,
        coalesce(v_profile.display_name, v_profile.full_name),
        v_role, p_duration_hours, v_conflict
      ) returning id into v_request_id;
    end if;

    return jsonb_build_object('status', 'pendente', 'request_id', v_request_id, 'reason', v_conflict, 'vehicle_id', v_vehicle.id, 'duration_hours', p_duration_hours);
  end if;

  insert into public.transport_shift_assignments(
    roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at, duration_hours, shift_ends_at
  ) values (
    v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name),
    v_role, now(), p_duration_hours, now() + make_interval(hours => p_duration_hours)
  )
  on conflict (roster_id, user_id) do update set
    vehicle_id = excluded.vehicle_id,
    user_name = excluded.user_name,
    professional_role = excluded.professional_role,
    assumed_at = now(),
    duration_hours = excluded.duration_hours,
    shift_ends_at = now() + make_interval(hours => excluded.duration_hours)
  returning * into v_assignment;

  update public.transport_shift_access_requests set status = 'cancelado', reviewed_at = now()
  where roster_id = v_roster.id and user_id = auth.uid() and status = 'pendente';

  return jsonb_build_object('status', 'ativo', 'assignment_id', v_assignment.id, 'vehicle_id', v_vehicle.id, 'duration_hours', p_duration_hours);
end;
$$;

revoke all on function public.assume_transport_shift(uuid, integer) from public, anon;
grant execute on function public.assume_transport_shift(uuid, integer) to authenticated;

create or replace function public.review_transport_shift_access_request(
  p_request_id uuid,
  p_approve boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.transport_shift_access_requests%rowtype;
  v_assignment public.transport_shift_assignments%rowtype;
begin
  if auth.uid() is null or not public.is_admin_general() then
    raise exception 'Somente o Administrador Geral pode analisar solicitações.';
  end if;

  select * into v_request from public.transport_shift_access_requests
  where id = p_request_id for update;
  if v_request.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if v_request.status <> 'pendente' then raise exception 'Esta solicitação já foi analisada.'; end if;

  if p_approve then
    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at, duration_hours, shift_ends_at
    ) values (
      v_request.roster_id, v_request.vehicle_id, v_request.user_id, v_request.user_name,
      v_request.professional_role, now(), v_request.duration_hours,
      now() + make_interval(hours => v_request.duration_hours)
    )
    on conflict (roster_id, user_id) do update set
      vehicle_id = excluded.vehicle_id,
      user_name = excluded.user_name,
      professional_role = excluded.professional_role,
      assumed_at = now(),
      duration_hours = excluded.duration_hours,
      shift_ends_at = now() + make_interval(hours => excluded.duration_hours)
    returning * into v_assignment;
  end if;

  update public.transport_shift_access_requests set
    status = case when p_approve then 'aprovado' else 'recusado' end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = v_request.id;

  return jsonb_build_object('status', case when p_approve then 'aprovado' else 'recusado' end, 'request_id', v_request.id, 'assignment_id', v_assignment.id, 'duration_hours', v_request.duration_hours);
end;
$$;

revoke all on function public.review_transport_shift_access_request(uuid, boolean) from public, anon;
grant execute on function public.review_transport_shift_access_request(uuid, boolean) to authenticated;

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
  if v_profile.id is null or v_profile.status::text <> 'aprovado' then raise exception 'Acesso não autorizado.'; end if;

  if v_profile.authorized_access::text = 'administrador_geral' then
    return public.accept_transport_request_unchecked(p_request_id, p_vehicle_id, p_team_name);
  end if;

  select * into v_request from public.transport_requests where id = p_request_id;
  if v_request.id is null then raise exception 'Solicitação não encontrada.'; end if;
  v_shift_date := case when v_local_now::time < time '07:00' then v_local_now::date - 1 else v_local_now::date end;

  select a.vehicle_id, v.code, v.display_name, v.support_type, a.professional_role
    into v_assignment
  from public.transport_shift_rosters r
  join public.transport_shift_assignments a on a.roster_id = r.id
  join public.transport_vehicles v on v.id = a.vehicle_id
  where r.shift_date = v_shift_date
    and a.user_id = auth.uid()
    and a.assumed_at is not null
    and (a.shift_ends_at is null or a.shift_ends_at > now());

  if v_assignment.vehicle_id is null then raise exception 'Assuma primeiro um plantão válido na opção Equipe do Plantão.'; end if;
  if v_assignment.professional_role is distinct from public.transport_professional_role(v_profile.job_role) then raise exception 'Sua categoria no plantão não corresponde ao cargo cadastrado.'; end if;
  if v_assignment.support_type is distinct from v_request.support_type then raise exception 'Sua ambulância do plantão não é compatível com este transporte.'; end if;
  if p_vehicle_id is not null and p_vehicle_id <> v_assignment.vehicle_id then raise exception 'Selecione a ambulância que você assumiu neste plantão.'; end if;

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

