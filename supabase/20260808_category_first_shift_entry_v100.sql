-- Entrada operacional por categoria profissional; privilégios administrativos ficam separados.

delete from public.transport_shift_access_requests where professional_role = 'administrador';
delete from public.transport_shift_assignments where professional_role = 'administrador';

create or replace function public.assume_transport_shift(p_vehicle_id uuid, p_shift_period text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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

  v_role := public.transport_professional_role(v_profile.job_role);
  if v_role is null then
    raise exception 'Seu cargo cadastrado não corresponde a médico, enfermagem ou motorista.';
  end if;

  select * into v_vehicle from public.transport_vehicles
  where id = p_vehicle_id and active = true and code in ('UTI-01', 'BASICA-01', 'BASICA-02');
  if v_vehicle.id is null then raise exception 'Ambulância inválida.'; end if;
  if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then
    raise exception 'Seu cadastro é de Médico e essa categoria só pode assumir a UTI 01.';
  end if;

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
    return jsonb_build_object('status','pendente','request_id',v_request_id,'reason',v_conflict,'vehicle_id',v_vehicle.id,'professional_role',v_role,'duration_hours',v_duration,'shift_period',v_period);
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
  return jsonb_build_object('status','ativo','assignment_id',v_assignment.id,'vehicle_id',v_vehicle.id,'professional_role',v_role,'duration_hours',v_duration,'shift_period',v_period,'shift_ends_at',v_end_at);
end;
$function$;

revoke all on function public.assume_transport_shift(uuid, text) from public, anon;
grant execute on function public.assume_transport_shift(uuid, text) to authenticated;
