create table if not exists public.transport_shift_rosters (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null unique,
  starts_at timestamptz generated always as ((shift_date::timestamp + time '07:00') at time zone 'America/Porto_Velho') stored,
  ends_at timestamptz generated always as (((shift_date + 1)::timestamp + time '07:00') at time zone 'America/Porto_Velho') stored,
  driver_required boolean not null default true,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transport_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.transport_shift_rosters(id) on delete cascade,
  vehicle_id uuid not null references public.transport_vehicles(id),
  user_id uuid not null references public.profiles(id),
  user_name text not null,
  professional_role text not null check (professional_role in ('medico','enfermagem','motorista')),
  created_at timestamptz not null default now(),
  unique (roster_id, vehicle_id, professional_role),
  unique (roster_id, user_id)
);

create index if not exists transport_shift_assignments_user_idx
  on public.transport_shift_assignments(user_id, roster_id);
create index if not exists transport_shift_assignments_vehicle_idx
  on public.transport_shift_assignments(vehicle_id, roster_id);
create index if not exists transport_shift_rosters_created_by_idx
  on public.transport_shift_rosters(created_by);
create index if not exists transport_shift_rosters_updated_by_idx
  on public.transport_shift_rosters(updated_by);

alter table public.transport_shift_rosters enable row level security;
alter table public.transport_shift_assignments enable row level security;

revoke all on public.transport_shift_rosters from anon;
revoke all on public.transport_shift_assignments from anon;
grant select on public.transport_shift_rosters to authenticated;
grant select on public.transport_shift_assignments to authenticated;

drop policy if exists "approved users read shift rosters" on public.transport_shift_rosters;
create policy "approved users read shift rosters"
on public.transport_shift_rosters for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.status::text = 'aprovado'
));

drop policy if exists "approved users read shift assignments" on public.transport_shift_assignments;
create policy "approved users read shift assignments"
on public.transport_shift_assignments for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.status::text = 'aprovado'
));

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
  v_vehicle public.transport_vehicles%rowtype;
  v_profile public.profiles%rowtype;
  v_role text;
  v_expected integer;
begin
  if auth.uid() is null or not public.is_admin_general() then
    raise exception 'Somente o Administrador Geral pode salvar a equipe do plantão.';
  end if;
  if p_shift_date is null then raise exception 'Informe a data do plantão.'; end if;
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de profissionais inválida.';
  end if;

  select coalesce(driver_report_enabled, true) into v_driver_required
  from public.transport_app_settings where id = 1;
  v_expected := case when v_driver_required then 7 else 4 end;
  if jsonb_array_length(p_assignments) < v_expected then
    raise exception 'Preencha todos os profissionais obrigatórios deste plantão.';
  end if;

  insert into public.transport_shift_rosters(shift_date, driver_required, created_by, updated_by)
  values (p_shift_date, v_driver_required, auth.uid(), auth.uid())
  on conflict (shift_date) do update set
    driver_required = excluded.driver_required,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_roster;

  delete from public.transport_shift_assignments where roster_id = v_roster.id;

  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    v_role := lower(trim(coalesce(v_item->>'professional_role', '')));
    if v_role not in ('medico','enfermagem','motorista') then
      raise exception 'Função profissional inválida.';
    end if;
    select * into v_vehicle from public.transport_vehicles
      where id = (v_item->>'vehicle_id')::uuid and active = true;
    if v_vehicle.id is null or v_vehicle.code not in ('BASICA-01','BASICA-02','UTI-01') then
      raise exception 'Ambulância inválida para a escala.';
    end if;
    if v_vehicle.support_type = 'basico' and v_role = 'medico' then
      raise exception 'As ambulâncias básicas devem ter profissional de enfermagem.';
    end if;
    if v_vehicle.support_type = 'avancado_uti' and v_role not in ('medico','enfermagem','motorista') then
      raise exception 'Função incompatível com a UTI.';
    end if;
    if v_role = 'motorista' and not v_driver_required and nullif(v_item->>'user_id','') is null then
      continue;
    end if;
    select * into v_profile from public.profiles
      where id = (v_item->>'user_id')::uuid
        and status::text = 'aprovado'
        and authorized_access::text in ('executante','solicitante_executante','administrador_geral');
    if v_profile.id is null then raise exception 'Profissional não aprovado ou sem acesso de execução.'; end if;
    if public.transport_professional_role(v_profile.job_role) is distinct from v_role then
      raise exception 'O cargo de % não corresponde à função selecionada.', coalesce(v_profile.display_name, v_profile.full_name);
    end if;
    insert into public.transport_shift_assignments(roster_id, vehicle_id, user_id, user_name, professional_role)
    values (v_roster.id, v_vehicle.id, v_profile.id, coalesce(v_profile.display_name,v_profile.full_name), v_role);
  end loop;

  if exists (
    select 1 from public.transport_vehicles v
    where v.code in ('BASICA-01','BASICA-02') and not exists (
      select 1 from public.transport_shift_assignments a
      where a.roster_id=v_roster.id and a.vehicle_id=v.id and a.professional_role='enfermagem'
    )
  ) then raise exception 'Cada ambulância básica exige técnico ou enfermeiro.'; end if;

  if not exists (
    select 1 from public.transport_shift_assignments a join public.transport_vehicles v on v.id=a.vehicle_id
    where a.roster_id=v_roster.id and v.code='UTI-01' and a.professional_role='medico'
  ) or not exists (
    select 1 from public.transport_shift_assignments a join public.transport_vehicles v on v.id=a.vehicle_id
    where a.roster_id=v_roster.id and v.code='UTI-01' and a.professional_role='enfermagem'
  ) then raise exception 'A UTI exige médico e enfermeiro.'; end if;

  if v_driver_required and exists (
    select 1 from public.transport_vehicles v
    where v.code in ('BASICA-01','BASICA-02','UTI-01') and not exists (
      select 1 from public.transport_shift_assignments a
      where a.roster_id=v_roster.id and a.vehicle_id=v.id and a.professional_role='motorista'
    )
  ) then raise exception 'O motorista é obrigatório em cada ambulância pela configuração administrativa atual.'; end if;

  return v_roster;
end;
$$;

revoke all on function public.save_transport_shift_roster(date,jsonb) from public, anon;
grant execute on function public.save_transport_shift_roster(date,jsonb) to authenticated;

alter function public.accept_transport_request(uuid,uuid,text) rename to accept_transport_request_unchecked;
revoke all on function public.accept_transport_request_unchecked(uuid,uuid,text) from public, anon, authenticated;

create function public.accept_transport_request(
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
  select * into v_profile from public.profiles where id=auth.uid();
  if v_profile.id is null or v_profile.status::text <> 'aprovado' then
    raise exception 'Acesso não autorizado.';
  end if;
  if v_profile.authorized_access::text = 'administrador_geral' then
    return public.accept_transport_request_unchecked(p_request_id,p_vehicle_id,p_team_name);
  end if;

  select * into v_request from public.transport_requests where id=p_request_id;
  if v_request.id is null then raise exception 'Solicitação não encontrada.'; end if;
  v_shift_date := case when v_local_now::time < time '07:00' then v_local_now::date - 1 else v_local_now::date end;

  select a.vehicle_id, v.code, v.display_name, v.support_type, a.professional_role
    into v_assignment
  from public.transport_shift_rosters r
  join public.transport_shift_assignments a on a.roster_id=r.id
  join public.transport_vehicles v on v.id=a.vehicle_id
  where r.shift_date=v_shift_date and a.user_id=auth.uid();

  if v_assignment.vehicle_id is null then
    raise exception 'Você não está escalado em uma ambulância neste plantão (07h às 07h).';
  end if;
  if v_assignment.professional_role is distinct from public.transport_professional_role(v_profile.job_role) then
    raise exception 'Sua função na escala não corresponde ao cargo cadastrado.';
  end if;
  if v_assignment.support_type is distinct from v_request.support_type then
    raise exception 'Sua ambulância do plantão não é compatível com este transporte.';
  end if;
  if p_vehicle_id is not null and p_vehicle_id <> v_assignment.vehicle_id then
    raise exception 'Selecione a ambulância em que você está escalado neste plantão.';
  end if;

  return public.accept_transport_request_unchecked(
    p_request_id,
    v_assignment.vehicle_id,
    coalesce(nullif(trim(p_team_name),''), v_assignment.display_name)
  );
end;
$$;

revoke all on function public.accept_transport_request(uuid,uuid,text) from public, anon;
grant execute on function public.accept_transport_request(uuid,uuid,text) to authenticated;
notify pgrst, 'reload schema';
