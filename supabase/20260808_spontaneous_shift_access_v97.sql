-- Versão 97: escala administrativa + entrada espontânea + liberação de conflitos.

alter table public.transport_shift_assignments
  drop constraint if exists transport_shift_assignments_professional_role_check;

alter table public.transport_shift_assignments
  add constraint transport_shift_assignments_professional_role_check
  check (professional_role in ('medico', 'enfermagem', 'motorista', 'administrador'));

alter table public.transport_shift_assignments
  drop constraint if exists transport_shift_assignments_roster_id_vehicle_id_profession_key;

create table if not exists public.transport_shift_access_requests (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.transport_shift_rosters(id) on delete cascade,
  shift_date date not null,
  vehicle_id uuid not null references public.transport_vehicles(id),
  user_id uuid not null references public.profiles(id),
  user_name text not null,
  professional_role text not null check (professional_role in ('medico', 'enfermagem', 'motorista')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'cancelado')),
  conflict_reason text not null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

create unique index if not exists transport_shift_access_requests_one_pending_idx
  on public.transport_shift_access_requests(roster_id, user_id)
  where status = 'pendente';

create index if not exists transport_shift_access_requests_admin_idx
  on public.transport_shift_access_requests(shift_date, status, requested_at);

create index if not exists transport_shift_access_requests_roster_idx
  on public.transport_shift_access_requests(roster_id);

create index if not exists transport_shift_access_requests_vehicle_idx
  on public.transport_shift_access_requests(vehicle_id);

create index if not exists transport_shift_access_requests_user_idx
  on public.transport_shift_access_requests(user_id);

create index if not exists transport_shift_access_requests_reviewed_by_idx
  on public.transport_shift_access_requests(reviewed_by)
  where reviewed_by is not null;

alter table public.transport_shift_access_requests enable row level security;
revoke all on public.transport_shift_access_requests from anon;
grant select on public.transport_shift_access_requests to authenticated;

drop policy if exists "users read own access request or admin reads all" on public.transport_shift_access_requests;
create policy "users read own access request or admin reads all"
on public.transport_shift_access_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin_general())
);

drop policy if exists "users read own shift assignment or admin reads all" on public.transport_shift_assignments;
drop policy if exists "approved executants read shift assignments" on public.transport_shift_assignments;
create policy "approved executants read shift assignments"
on public.transport_shift_assignments for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status::text = 'aprovado'
      and p.authorized_access::text in ('executante', 'solicitante_executante', 'administrador_geral')
  )
);

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
    begin v_user_id := (v_item->>'user_id')::uuid;
    exception when others then raise exception 'Profissional inválido na escala.';
    end;
    if v_role not in ('medico', 'enfermagem', 'motorista') then raise exception 'Categoria profissional inválida.'; end if;
    if v_user_id = any(v_ids) then raise exception 'O mesmo profissional não pode aparecer duas vezes na escala.'; end if;

    select * into v_profile from public.profiles
    where id = v_user_id and status::text = 'aprovado'
      and authorized_access::text in ('executante', 'solicitante_executante', 'administrador_geral');
    if v_profile.id is null then raise exception 'Profissional não aprovado ou sem acesso de execução.'; end if;
    if public.transport_professional_role(v_profile.job_role) is distinct from v_role then
      raise exception 'O cargo de % não corresponde à categoria selecionada.', coalesce(v_profile.display_name, v_profile.full_name);
    end if;

    insert into public.transport_shift_assignments(roster_id, vehicle_id, user_id, user_name, professional_role)
    values (v_roster.id, null, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name), v_role)
    on conflict (roster_id, user_id) do update set
      user_name = excluded.user_name,
      professional_role = case when public.transport_shift_assignments.assumed_at is null then excluded.professional_role else public.transport_shift_assignments.professional_role end;
    v_ids := array_append(v_ids, v_user_id);
  end loop;

  -- Mantém quem já entrou espontaneamente; remove apenas previsões ainda não assumidas.
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

create or replace function public.save_transport_shift_roster_range(
  p_start_date date,
  p_end_date date,
  p_assignments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_admin_general() then
    raise exception 'Somente o Administrador Geral pode salvar escalas.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Período da escala inválido.';
  end if;
  if p_end_date - p_start_date > 62 then
    raise exception 'O período máximo para repetição é de 63 dias.';
  end if;
  for v_date in select generate_series(p_start_date, p_end_date, interval '1 day')::date
  loop
    perform public.save_transport_shift_roster(v_date, p_assignments);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('status', 'salvo', 'days_saved', v_count, 'start_date', p_start_date, 'end_date', p_end_date);
end;
$$;

revoke all on function public.save_transport_shift_roster_range(date, date, jsonb) from public, anon;
grant execute on function public.save_transport_shift_roster_range(date, date, jsonb) to authenticated;

drop function if exists public.assume_transport_shift(uuid);
create function public.assume_transport_shift(
  p_vehicle_id uuid
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
  v_planned boolean := false;
  v_capacity integer;
  v_planned_count integer;
  v_conflict text;
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
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

  -- Serializa entradas simultâneas no mesmo plantão.
  perform 1 from public.transport_shift_rosters where id = v_roster.id for update;

  if v_profile.authorized_access::text = 'administrador_geral' then
    insert into public.transport_shift_assignments(roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at)
    values (v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name), 'administrador', now())
    on conflict (roster_id, user_id) do update set vehicle_id = excluded.vehicle_id, user_name = excluded.user_name, professional_role = 'administrador', assumed_at = now()
    returning * into v_assignment;
    return jsonb_build_object('status', 'ativo', 'assignment_id', v_assignment.id, 'vehicle_id', v_vehicle.id, 'admin_override', true);
  end if;

  v_role := public.transport_professional_role(v_profile.job_role);
  if v_role is null then raise exception 'Seu cargo cadastrado não corresponde a médico, enfermagem ou motorista.'; end if;
  if v_role = 'medico' and v_vehicle.code <> 'UTI-01' then raise exception 'O médico assume automaticamente a UTI 01.'; end if;

  select * into v_assignment from public.transport_shift_assignments
  where roster_id = v_roster.id and user_id = auth.uid() for update;
  v_planned := v_assignment.id is not null;
  if v_planned and v_assignment.professional_role is distinct from v_role then
    raise exception 'Sua categoria na escala não corresponde ao cargo cadastrado.';
  end if;

  if exists (
    select 1 from public.transport_shift_assignments a
    where a.roster_id = v_roster.id and a.vehicle_id = v_vehicle.id
      and a.professional_role = v_role and a.assumed_at is not null and a.user_id <> auth.uid()
  ) then
    v_conflict := 'Já existe outro profissional da mesma categoria ativo neste veículo.';
  end if;

  if v_conflict is null and not v_planned then
    v_capacity := case v_role when 'medico' then 1 else 3 end;
    select count(*) into v_planned_count from public.transport_shift_assignments a
    where a.roster_id = v_roster.id and a.professional_role = v_role and a.user_id <> auth.uid();
    if v_planned_count >= v_capacity then
      v_conflict := 'A escala administrativa desta categoria já está completa para o plantão.';
    end if;
  end if;

  if v_conflict is not null then
    update public.transport_shift_access_requests set
      vehicle_id = v_vehicle.id,
      professional_role = v_role,
      conflict_reason = v_conflict,
      requested_at = now()
    where roster_id = v_roster.id and user_id = auth.uid() and status = 'pendente'
    returning id into v_request_id;
    if v_request_id is null then
      insert into public.transport_shift_access_requests(roster_id, shift_date, vehicle_id, user_id, user_name, professional_role, conflict_reason)
      values (v_roster.id, v_shift_date, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name), v_role, v_conflict)
      returning id into v_request_id;
    end if;
    return jsonb_build_object('status', 'pendente', 'request_id', v_request_id, 'reason', v_conflict, 'vehicle_id', v_vehicle.id);
  end if;

  insert into public.transport_shift_assignments(roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at)
  values (v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name, v_profile.full_name), v_role, now())
  on conflict (roster_id, user_id) do update set vehicle_id = excluded.vehicle_id, user_name = excluded.user_name, professional_role = excluded.professional_role, assumed_at = now()
  returning * into v_assignment;

  update public.transport_shift_access_requests set status = 'cancelado', reviewed_at = now()
  where roster_id = v_roster.id and user_id = auth.uid() and status = 'pendente';
  return jsonb_build_object('status', 'ativo', 'assignment_id', v_assignment.id, 'vehicle_id', v_vehicle.id, 'planned', v_planned);
end;
$$;

revoke all on function public.assume_transport_shift(uuid) from public, anon;
grant execute on function public.assume_transport_shift(uuid) to authenticated;

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
    insert into public.transport_shift_assignments(roster_id, vehicle_id, user_id, user_name, professional_role, assumed_at)
    values (v_request.roster_id, v_request.vehicle_id, v_request.user_id, v_request.user_name, v_request.professional_role, now())
    on conflict (roster_id, user_id) do update set vehicle_id = excluded.vehicle_id, user_name = excluded.user_name, professional_role = excluded.professional_role, assumed_at = now()
    returning * into v_assignment;
  end if;

  update public.transport_shift_access_requests set
    status = case when p_approve then 'aprovado' else 'recusado' end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = v_request.id;
  return jsonb_build_object('status', case when p_approve then 'aprovado' else 'recusado' end, 'request_id', v_request.id, 'assignment_id', v_assignment.id);
end;
$$;

revoke all on function public.review_transport_shift_access_request(uuid, boolean) from public, anon;
grant execute on function public.review_transport_shift_access_request(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
