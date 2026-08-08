(() => {
  'use strict';
  const app = window.HEURO;
  let session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }
  const $ = id => document.getElementById(id);
  const roles = { medico: 'Médico', enfermagem: 'Enfermagem', motorista: 'Motorista', administrador: 'Administrador Geral' };
  const order = { 'UTI-01': 0, 'BASICA-01': 1, 'BASICA-02': 2 };
  const state = { profile: null, isAdmin: false, vehicles: [], assignments: [], requests: [], shiftDate: '' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const roleForJob = job => { const j = String(job || '').toLowerCase(); if (j.includes('médic') || j.includes('medic')) return 'medico'; if (j.includes('enfermeir') || ((j.includes('técnic') || j.includes('tecnic') || j.includes('auxiliar')) && j.includes('enferm'))) return 'enfermagem'; if (j.includes('motorista') || j.includes('condutor')) return 'motorista'; return null; };
  const api = async (path, options = {}) => { const response = await fetch(app.apiUrl(path), { ...options, headers: { ...app.authenticatedHeaders(session.access_token), ...(options.headers || {}) }, cache: 'no-store' }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível concluir a operação.'); return data; };
  const activeShiftDate = () => { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value])); const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00-04:00`); if (Number(parts.hour) < 7) date.setDate(date.getDate() - 1); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); };
  const show = (text, ok = false) => { const el = $('message'); el.textContent = text; el.className = `message${ok ? ' ok' : ''}`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 6000); };
  const formatDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Porto_Velho', dateStyle: 'long' }).format(new Date(`${value}T12:00:00-04:00`));
  const ownAssignment = () => state.assignments.find(a => a.user_id === session.user_id && a.assumed_at);
  const ownPending = () => state.requests.find(r => r.user_id === session.user_id && r.status === 'pendente');
  const cardClass = vehicle => vehicle.code === 'UTI-01' ? 'uti' : vehicle.code === 'BASICA-02' ? 'basic-two' : 'basic-one';
  const ambulanceIcon = vehicle => vehicle.code === 'UTI-01'
    ? '<svg viewBox="0 0 96 68" aria-hidden="true"><path fill="currentColor" d="M8 16h52v8h17l11 15v19H8z"/><path fill="#fff" d="M64 29h11l7 10H64zM27 23h10v8h8v10h-8v8H27v-8h-8V31h8z"/><circle cx="26" cy="58" r="8" fill="#26384d"/><circle cx="73" cy="58" r="8" fill="#26384d"/></svg>'
    : '<svg viewBox="0 0 96 68" aria-hidden="true"><path fill="currentColor" d="M8 25h53l12 6 15 15v12H8z"/><path fill="#fff" d="M63 32h9l10 12H63zM28 31h8v7h7v8h-7v7h-8v-7h-7v-8h7z"/><circle cx="25" cy="58" r="7" fill="#26384d"/><circle cx="73" cy="58" r="7" fill="#26384d"/></svg>';
  const plateText = vehicle => vehicle.license_plate ? escapeHtml(vehicle.license_plate) : 'SEM PLACA';

  function renderIdentity() {
    const role = state.isAdmin ? 'administrador' : roleForJob(state.profile.job_role);
    $('identityCard').innerHTML = `<div class="identity-icon">👤</div><div><span>Profissional conectado</span><strong>${escapeHtml(state.profile.display_name || state.profile.full_name)}</strong><small>${escapeHtml(state.profile.job_role || 'Cargo não informado')}${role ? ` · ${roles[role]}` : ''}</small></div>`;
  }

  function teamRows(vehicle) {
    const team = state.assignments.filter(a => a.vehicle_id === vehicle.id && a.assumed_at);
    const expected = vehicle.code === 'UTI-01' ? ['medico', 'enfermagem', 'motorista'] : ['enfermagem', 'motorista'];
    const rows = expected.map(role => { const people = team.filter(a => a.professional_role === role); return `<div class="person ${people.length ? 'confirmed' : ''}"><div><span>${roles[role]}</span><strong>${people.length ? people.map(p => escapeHtml(p.user_name)).join(', ') : 'Aguardando entrada'}</strong></div><b>${people.length ? '✓ No plantão' : 'Livre'}</b></div>`; });
    team.filter(a => a.professional_role === 'administrador').forEach(person => rows.push(`<div class="person admin"><div><span>Administrador Geral</span><strong>${escapeHtml(person.user_name)}</strong></div><b>Acesso total</b></div>`));
    return rows.join('');
  }

  function vehicleCard(vehicle, role) {
    const selected = ownAssignment()?.vehicle_id === vehicle.id;
    const pending = ownPending()?.vehicle_id === vehicle.id;
    const medicalBlocked = !state.isAdmin && role === 'medico' && vehicle.code !== 'UTI-01';
    if (medicalBlocked) return '';
    const status = selected ? 'Em plantão' : pending ? 'Aguardando liberação' : 'Disponível';
    const label = selected ? 'Plantão assumido' : pending ? 'Solicitação registrada' : state.isAdmin ? 'Entrar neste veículo' : role === 'medico' ? 'Assumir UTI 01' : 'Assumir nesta equipe';
    return `<article class="vehicle-card choice ${cardClass(vehicle)} ${selected ? 'selected' : ''} ${pending ? 'waiting' : ''}"><header><span class="vehicle-icon">${ambulanceIcon(vehicle)}</span><div><h2>${escapeHtml(vehicle.display_name)}</h2><small>${vehicle.support_type === 'avancado_uti' ? 'Ambulância de suporte avançado' : 'Ambulância de suporte básico'}</small><span class="plate">${plateText(vehicle)}</span></div><span class="choice-status">${status}</span></header><div class="people">${teamRows(vehicle)}</div><button type="button" data-assume="${vehicle.id}" ${selected || pending ? 'disabled' : ''}>${label}</button></article>`;
  }

  function render() {
    renderIdentity();
    const role = state.isAdmin ? 'administrador' : roleForJob(state.profile.job_role);
    const assignment = ownAssignment();
    const pending = ownPending();
    if (!role) { $('statusBanner').className = 'status-banner'; $('statusBanner').textContent = 'Seu cargo não corresponde às categorias Médico, Enfermagem ou Motorista. Solicite a correção do cadastro ao administrador.'; $('vehicleCards').innerHTML = ''; return; }
    if (pending) { $('statusBanner').className = 'status-banner pending'; $('statusBanner').textContent = `${pending.conflict_reason || 'Foi identificado conflito com a escala.'} Sua solicitação ficou registrada. Entre em contato com o Administrador Geral para liberar o acesso.`; }
    else if (assignment) { const vehicle = state.vehicles.find(v => v.id === assignment.vehicle_id); $('statusBanner').className = 'status-banner active'; $('statusBanner').textContent = `${state.isAdmin ? 'Acesso administrativo' : 'Plantão'} ativo em ${vehicle?.display_name || 'ambulância selecionada'}${vehicle?.license_plate ? ` · placa ${vehicle.license_plate}` : ''}.`; }
    else if (state.isAdmin) { $('statusBanner').className = 'status-banner active'; $('statusBanner').textContent = 'Administrador Geral: escolha qualquer veículo. Seu acesso é direto e não ocupa a vaga da equipe assistencial.'; }
    else { $('statusBanner').className = 'status-banner'; $('statusBanner').textContent = `Escolha o veículo do plantão. Se houver conflito com a escala, o pedido será registrado para liberação administrativa.`; }
    $('vehicleCards').innerHTML = state.vehicles.sort((a, b) => order[a.code] - order[b.code]).map(v => vehicleCard(v, role)).join('');
  }

  async function assume(vehicleId, button) {
    button.disabled = true; button.textContent = 'Registrando...';
    try {
      const result = await api('/rest/v1/rpc/assume_transport_shift', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_vehicle_id: vehicleId }) });
      if (result?.status === 'pendente') show('Conflito registrado. A solicitação foi enviada ao Administrador Geral.'); else show('Entrada no plantão confirmada e vinculada ao seu login.', true);
      await loadShift();
    } catch (error) { show(error.message); button.disabled = false; button.textContent = 'Assumir nesta equipe'; }
  }

  async function loadShift() {
    const [rosters, requests] = await Promise.all([
      api(`/rest/v1/transport_shift_rosters?shift_date=eq.${state.shiftDate}&select=id,shift_date,driver_required,transport_shift_assignments(id,vehicle_id,user_id,user_name,professional_role,assumed_at)`),
      api(`/rest/v1/transport_shift_access_requests?shift_date=eq.${state.shiftDate}&status=eq.pendente&select=id,user_id,vehicle_id,professional_role,status,conflict_reason,requested_at`)
    ]);
    state.assignments = rosters?.[0]?.transport_shift_assignments || [];
    state.requests = requests || [];
    render();
  }

  async function init() {
    try {
      const profiles = await api(`/rest/v1/profiles?id=eq.${session.user_id}&select=id,display_name,full_name,status,authorized_access,job_role`);
      state.profile = profiles?.[0];
      if (!state.profile || state.profile.status !== 'aprovado') throw new Error('Acesso não autorizado.');
      state.isAdmin = state.profile.authorized_access === 'administrador_geral';
      session = { ...session, access: state.profile.authorized_access, display_name: state.profile.display_name }; app.saveSession(session);
      state.shiftDate = activeShiftDate(); $('shiftDateLabel').textContent = formatDate(state.shiftDate);
      state.vehicles = await api('/rest/v1/transport_vehicles?active=eq.true&code=in.(BASICA-01,BASICA-02,UTI-01)&select=id,code,display_name,support_type,license_plate,active');
      await loadShift();
    } catch (error) { $('statusBanner').textContent = error.message; $('vehicleCards').innerHTML = ''; }
  }

  $('vehicleCards').addEventListener('click', event => { const button = event.target.closest('button[data-assume]'); if (button) assume(button.dataset.assume, button); });
  init(); app.clearLegacyCaches().catch(() => {});
})();
