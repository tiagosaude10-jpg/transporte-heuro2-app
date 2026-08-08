-- Versão 99: distingue 12h diurno (07h-19h), 12h noturno (19h-07h) e 24h (07h-07h).

alter table public.transport_shift_assignments
  add column if not exists shift_period text not null default '24h';

alter table public.transport_shift_assignments
  drop constraint if exists transport_shift_assignments_shift_period_check;
alter table public.transport_shift_assignments
  add constraint transport_shift_assignments_shift_period_check
  check (shift_period in ('12h_diurno', '12h_noturno', '24h'));

update public.transport_shift_assignments a
set shift_period = case
  when a.duration_hours = 24 then '24h'
  when extract(hour from timezone('America/Porto_Velho', coalesce(a.assumed_at, a.created_at))) >= 19
    or extract(hour from timezone('America/Porto_Velho', coalesce(a.assumed_at, a.created_at))) < 7
    then '12h_noturno'
  else '12h_diurno'
end;

alter table public.transport_shift_access_requests
  add column if not exists shift_period text not null default '24h';

alter table public.transport_shift_access_requests
  drop constraint if exists transport_shift_access_requests_shift_period_check;
alter table public.transport_shift_access_requests
  add constraint transport_shift_access_requests_shift_period_check
  check (shift_period in ('12h_diurno', '12h_noturno', '24h'));

update public.transport_shift_access_requests r
set shift_period = case
  when r.duration_hours = 24 then '24h'
  when extract(hour from timezone('America/Porto_Velho', r.requested_at)) >= 19
    or extract(hour from timezone('America/Porto_Velho', r.requested_at)) < 7
    then '12h_noturno'
  else '12h_diurno'
end;

-- Converte vínculos existentes para os limites fixos do plantão 07h-07h.
update public.transport_shift_assignments a
set duration_hours = case when a.shift_period = '24h' then 24 else 12 end,
    shift_ends_at = case a.shift_period
      when '12h_diurno' then (r.shift_date::timestamp + time '19:00') at time zone 'America/Porto_Velho'
      else ((r.shift_date + 1)::timestamp + time '07:00') at time zone 'America/Porto_Velho'
    end
from public.transport_shift_rosters r
where r.id = a.roster_id and a.assumed_at is not null;

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
  v_period text;
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
    v_period := lower(trim(coalesce(v_item->>'shift_period', '24h')));
    begin
      v_user_id := (v_item->>'user_id')::uuid;
      v_vehicle_id := (v_item->>'vehicle_id')::uuid;
    exception when others then
      raise exception 'Profissional ou veículo inválido na escala.';
    end;
    if v_period not in ('12h_diurno', '12h_noturno', '24h') then
      raise exception 'Escolha 12h diurno, 12h noturno ou 24h.';
    end if;
    v_duration := case when v_period = '24h' then 24 else 12 end;
    if v_role not in ('medico', 'enfermagem', 'motorista') then raise exception 'Categoria profissional inválida.'; end if;
    if v_user_id = any(v_ids) then raise exception 'O mesmo profissional não pode aparecer duas vezes na escala.'; end if;

    select * into v_vehicle from public.transport_vehicles
    where id = v_vehicle_id and active = true and code in ('UTI-01', 'BASICA-01', 'BASICA-02');
    if v_vehicle.id is null then raise exception 'Veículo inválido na escala.'; end if;
    if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then raise exception 'O médico só pode ser escalado na UTI 01.'; end if;

    select * into v_profile from public.profiles
    where id = v_user_id and status::text = 'aprovado'
      and authorized_access::text in ('executante', 'solicitante_executante', 'administrador_geral');
    if v_profile.id is null then raise exception 'Profissional não aprovado ou sem acesso de execução.'; end if;
    if public.transport_professional_role(v_profile.job_role) is distinct from v_role then
      raise exception 'O cargo de % não corresponde à categoria selecionada.', coalesce(v_profile.display_name, v_profile.full_name);
    end if;

    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role, duration_hours, shift_period
    ) values (
      v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name), v_role, v_duration, v_period
    )
    on conflict (roster_id, user_id) do update set
      user_name = excluded.user_name,
      vehicle_id = case when public.transport_shift_assignments.assumed_at is null then excluded.vehicle_id else public.transport_shift_assignments.vehicle_id end,
      professional_role = case when public.transport_shift_assignments.assumed_at is null then excluded.professional_role else public.transport_shift_assignments.professional_role end,
      duration_hours = case when public.transport_shift_assignments.assumed_at is null then excluded.duration_hours else public.transport_shift_assignments.duration_hours end,
      shift_period = case when public.transport_shift_assignments.assumed_at is null then excluded.shift_period else public.transport_shift_assignments.shift_period end;
    v_ids := array_append(v_ids, v_user_id);
  end loop;

  delete from public.transport_shift_assignments a
  where a.roster_id = v_roster.id and a.assumed_at is null
    and a.professional_role <> 'administrador' and not (a.user_id = any(v_ids));
  return v_roster;
end;
$$;

revoke all on function public.save_transport_shift_roster(date, jsonb) from public, anon;
grant execute on function public.save_transport_shift_roster(date, jsonb) to authenticated;

drop function if exists public.assume_transport_shift(uuid, integer);
drop function if exists public.assume_transport_shift(uuid, text);

create function public.assume_transport_shift(
  p_vehicle_id uuid,
  p_shift_period text
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
  v_period text := lower(trim(coalesce(p_shift_period, '')));
  v_duration smallint;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_conflict text;
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if v_period not in ('12h_diurno', '12h_noturno', '24h') then
    raise exception 'Escolha 12h diurno, 12h noturno ou 24h.';
  end if;
  if v_period = '12h_diurno' and not (v_local_now::time >= time '07:00' and v_local_now::time < time '19:00') then
    raise exception 'O plantão de 12h diurno só pode ser assumido entre 07h e 19h.';
  end if;
  if v_period = '12h_noturno' and not (v_local_now::time >= time '19:00' or v_local_now::time < time '07:00') then
    raise exception 'O plantão de 12h noturno só pode ser assumido entre 19h e 07h.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null or v_profile.status::text <> 'aprovado'
     or v_profile.authorized_access::text not in ('executante', 'solicitante_executante', 'administrador_geral') then
    raise exception 'Acesso não autorizado.';
  end if;
  select * into v_vehicle from public.transport_vehicles
  where id = p_vehicle_id and active = true and code in ('UTI-01', 'BASICA-01', 'BASICA-02');
  if v_vehicle.id is null then raise exception 'Ambulância inválida.'; end if;

  v_shift_date := case when v_local_now::time < time '07:00' then v_local_now::date - 1 else v_local_now::date end;
  v_duration := case when v_period = '24h' then 24 else 12 end;
  v_start_at := case v_period
    when '12h_noturno' then (v_shift_date::timestamp + time '19:00') at time zone 'America/Porto_Velho'
    else (v_shift_date::timestamp + time '07:00') at time zone 'America/Porto_Velho'
  end;
  v_end_at := case v_period
    when '12h_diurno' then (v_shift_date::timestamp + time '19:00') at time zone 'America/Porto_Velho'
    else ((v_shift_date + 1)::timestamp + time '07:00') at time zone 'America/Porto_Velho'
  end;

  insert into public.transport_shift_rosters(shift_date, driver_required, created_by, updated_by)
  values (v_shift_date, coalesce((select driver_report_enabled from public.transport_app_settings where id = 1), true), auth.uid(), auth.uid())
  on conflict (shift_date) do update set updated_at = public.transport_shift_rosters.updated_at
  returning * into v_roster;
  perform 1 from public.transport_shift_rosters where id = v_roster.id for update;

  if v_profile.authorized_access::text = 'administrador_geral' then
    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at, duration_hours, shift_period, shift_ends_at
    ) values (
      v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name),
      'administrador', now(), v_duration, v_period, v_end_at
    )
    on conflict (roster_id, user_id) do update set
      vehicle_id = excluded.vehicle_id, user_name = excluded.user_name, professional_role = 'administrador',
      assumed_at = now(), duration_hours = excluded.duration_hours, shift_period = excluded.shift_period, shift_ends_at = excluded.shift_ends_at
    returning * into v_assignment;
    return jsonb_build_object('status','ativo','assignment_id',v_assignment.id,'vehicle_id',v_vehicle.id,'duration_hours',v_duration,'shift_period',v_period,'shift_ends_at',v_end_at,'admin_override',true);
  end if;

  v_role := public.transport_professional_role(v_profile.job_role);
  if v_role is null then raise exception 'Seu cargo cadastrado não corresponde a médico, enfermagem ou motorista.'; end if;
  if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then raise exception 'O médico assume automaticamente a UTI 01.'; end if;

  select * into v_assignment from public.transport_shift_assignments
  where roster_id = v_roster.id and user_id = auth.uid() for update;
  if v_assignment.id is not null and v_assignment.professional_role is distinct from v_role then
    raise exception 'Sua categoria na escala não corresponde ao cargo cadastrado.';
  end if;
  if v_assignment.id is not null and v_assignment.assumed_at is null
     and (v_assignment.vehicle_id <> v_vehicle.id or v_assignment.shift_period <> v_period) then
    v_conflict := 'Você foi escalado pelo administrador em outro veículo ou horário.';
  end if;

  if v_conflict is null and exists (
    select 1 from public.transport_shift_assignments a
    where a.roster_id = v_roster.id and a.vehicle_id = v_vehicle.id
      and a.professional_role = v_role and a.user_id <> auth.uid()
      and (
        (a.assumed_at is not null and (a.shift_ends_at is null or a.shift_ends_at > now()))
        or (a.assumed_at is null and (v_period = '24h' or a.shift_period = '24h' or a.shift_period = v_period))
      )
  ) then
    v_conflict := 'Esta categoria já possui outro profissional escalado ou ativo neste veículo e horário.';
  end if;

  if v_conflict is not null then
    update public.transport_shift_access_requests set
      vehicle_id = v_vehicle.id, professional_role = v_role, duration_hours = v_duration,
      shift_period = v_period, conflict_reason = v_conflict, requested_at = now()
    where roster_id = v_roster.id and user_id = auth.uid() and status = 'pendente'
    returning id into v_request_id;
    if v_request_id is null then
      insert into public.transport_shift_access_requests(
        roster_id, shift_date, vehicle_id, user_id, user_name, professional_role,
        duration_hours, shift_period, conflict_reason
      ) values (
        v_roster.id, v_shift_date, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name),
        v_role, v_duration, v_period, v_conflict
      ) returning id into v_request_id;
    end if;
    return jsonb_build_object('status','pendente','request_id',v_request_id,'reason',v_conflict,'vehicle_id',v_vehicle.id,'duration_hours',v_duration,'shift_period',v_period);
  end if;

  insert into public.transport_shift_assignments(
    roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at, duration_hours, shift_period, shift_ends_at
  ) values (
    v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name),
    v_role, now(), v_duration, v_period, v_end_at
  )
  on conflict (roster_id, user_id) do update set
    vehicle_id = excluded.vehicle_id, user_name = excluded.user_name, professional_role = excluded.professional_role,
    assumed_at = now(), duration_hours = excluded.duration_hours, shift_period = excluded.shift_period, shift_ends_at = excluded.shift_ends_at
  returning * into v_assignment;

  update public.transport_shift_access_requests set status = 'cancelado', reviewed_at = now()
  where roster_id = v_roster.id and user_id = auth.uid() and status = 'pendente';
  return jsonb_build_object('status','ativo','assignment_id',v_assignment.id,'vehicle_id',v_vehicle.id,'duration_hours',v_duration,'shift_period',v_period,'shift_ends_at',v_end_at);
end;
$$;

revoke all on function public.assume_transport_shift(uuid, text) from public, anon;
grant execute on function public.assume_transport_shift(uuid, text) to authenticated;

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
  v_end_at timestamptz;
begin
  if auth.uid() is null or not public.is_admin_general() then raise exception 'Somente o Administrador Geral pode analisar solicitações.'; end if;
  select * into v_request from public.transport_shift_access_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if v_request.status <> 'pendente' then raise exception 'Esta solicitação já foi analisada.'; end if;

  v_end_at := case v_request.shift_period
    when '12h_diurno' then (v_request.shift_date::timestamp + time '19:00') at time zone 'America/Porto_Velho'
    else ((v_request.shift_date + 1)::timestamp + time '07:00') at time zone 'America/Porto_Velho'
  end;
  if p_approve and v_end_at <= now() then raise exception 'O horário desta solicitação já terminou.'; end if;

  if p_approve then
    insert into public.transport_shift_assignments(
      roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at, duration_hours, shift_period, shift_ends_at
    ) values (
      v_request.roster_id, v_request.vehicle_id, v_request.user_id, v_request.user_name,
      v_request.professional_role, now(), v_request.duration_hours, v_request.shift_period, v_end_at
    )
    on conflict (roster_id, user_id) do update set
      vehicle_id = excluded.vehicle_id, user_name = excluded.user_name, professional_role = excluded.professional_role,
      assumed_at = now(), duration_hours = excluded.duration_hours, shift_period = excluded.shift_period, shift_ends_at = excluded.shift_ends_at
    returning * into v_assignment;
  end if;

  update public.transport_shift_access_requests set
    status = case when p_approve then 'aprovado' else 'recusado' end,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = v_request.id;
  return jsonb_build_object('status',case when p_approve then 'aprovado' else 'recusado' end,'request_id',v_request.id,'assignment_id',v_assignment.id,'duration_hours',v_request.duration_hours,'shift_period',v_request.shift_period);
end;
$$;

revoke all on function public.review_transport_shift_access_request(uuid, boolean) from public, anon;
grant execute on function public.review_transport_shift_access_request(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
