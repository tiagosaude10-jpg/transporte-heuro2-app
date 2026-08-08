(() => {
  'use strict';
  const app = window.HEURO;
  let session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }
  const $ = id => document.getElementById(id);
  const roles = { medico: 'Médico', enfermagem: 'Enfermagem', motorista: 'Motorista' };
  const order = { 'UTI-01': 0, 'BASICA-01': 1, 'BASICA-02': 2 };
  const state = { profile: null, isAdmin: false, vehicles: [], assignments: [], shiftDate: '' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const roleForJob = job => {
    const j = String(job || '').toLowerCase();
    if (j.includes('médic') || j.includes('medic')) return 'medico';
    if (j.includes('enfermeir') || ((j.includes('técnic') || j.includes('tecnic') || j.includes('auxiliar')) && j.includes('enferm'))) return 'enfermagem';
    if (j.includes('motorista') || j.includes('condutor')) return 'motorista';
    return null;
  };
  const api = async (path, options = {}) => {
    const response = await fetch(app.apiUrl(path), { ...options, headers: { ...app.authenticatedHeaders(session.access_token), ...(options.headers || {}) }, cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível concluir a operação.');
    return data;
  };
  const activeShiftDate = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00-04:00`);
    if (Number(parts.hour) < 7) date.setDate(date.getDate() - 1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  };
  const show = (text, ok = false) => {
    const el = $('message'); el.textContent = text; el.className = `message${ok ? ' ok' : ''}`; el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 5000);
  };
  const formatDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Porto_Velho', dateStyle: 'long' }).format(new Date(`${value}T12:00:00-04:00`));
  const vehicleById = id => state.vehicles.find(v => v.id === id);
  const ownAssignment = () => state.assignments.find(a => a.user_id === session.user_id);

  function renderIdentity() {
    const role = roleForJob(state.profile.job_role);
    $('identityCard').innerHTML = `<div class="identity-icon">👤</div><div><span>Profissional conectado</span><strong>${escapeHtml(state.profile.display_name || state.profile.full_name)}</strong><small>${escapeHtml(state.profile.job_role || 'Cargo não informado')}${role ? ` · ${roles[role]}` : ''}</small></div>`;
  }

  function adminCard(vehicle) {
    const team = state.assignments.filter(a => a.vehicle_id === vehicle.id && a.assumed_at);
    const expected = vehicle.support_type === 'avancado_uti' ? ['medico', 'enfermagem', 'motorista'] : ['enfermagem', 'motorista'];
    const people = expected.map(role => {
      const person = team.find(a => a.professional_role === role);
      return `<div class="person ${person ? 'confirmed' : ''}"><div><span>${roles[role]}</span><strong>${person ? escapeHtml(person.user_name) : 'Aguardando confirmação'}</strong></div><b>${person ? '✓ Assumiu' : 'Pendente'}</b></div>`;
    }).join('');
    return `<article class="vehicle-card ${vehicle.support_type === 'avancado_uti' ? 'uti' : ''}"><header><span class="vehicle-icon">${vehicle.support_type === 'avancado_uti' ? '✚' : '🚑'}</span><div><h2>${escapeHtml(vehicle.display_name)}</h2><small>${vehicle.license_plate ? `Placa ${escapeHtml(vehicle.license_plate)}` : 'Placa não cadastrada'}</small></div></header><div class="people">${people}</div></article>`;
  }

  function professionalCard(vehicle, assignment, role) {
    const selected = assignment?.vehicle_id === vehicle.id && assignment?.assumed_at;
    const medicalBlocked = role === 'medico' && vehicle.code !== 'UTI-01';
    if (medicalBlocked) return '';
    return `<article class="vehicle-card choice ${selected ? 'selected' : ''} ${vehicle.support_type === 'avancado_uti' ? 'uti' : ''}"><header><span class="vehicle-icon">${vehicle.support_type === 'avancado_uti' ? '✚' : '🚑'}</span><div><h2>${escapeHtml(vehicle.display_name)}</h2><small>${vehicle.license_plate ? `Placa ${escapeHtml(vehicle.license_plate)}` : 'Placa ainda não cadastrada'}</small></div><span class="choice-status">${selected ? 'Em plantão' : 'Disponível'}</span></header><button type="button" data-assume="${vehicle.id}" ${selected ? 'disabled' : ''}>${selected ? 'Plantão assumido' : role === 'medico' ? 'Assumir UTI 01' : `Assumir nesta equipe`}</button></article>`;
  }

  function render() {
    renderIdentity();
    const assignment = ownAssignment();
    const role = assignment?.professional_role || roleForJob(state.profile.job_role);
    if (state.isAdmin) {
      $('statusBanner').className = 'status-banner active';
      $('statusBanner').textContent = 'Visão do Administrador Geral: acompanhe abaixo quem já confirmou o plantão. O cadastro da escala e das placas fica no botão Administrativo.';
      $('vehicleCards').innerHTML = state.vehicles.sort((a, b) => order[a.code] - order[b.code]).map(adminCard).join('');
      return;
    }
    if (!role) {
      $('statusBanner').textContent = 'Seu cargo não corresponde às categorias Médico, Enfermagem ou Motorista. Solicite a correção do cadastro ao administrador.';
      $('vehicleCards').innerHTML = '';
      return;
    }
    if (!assignment) {
      $('statusBanner').textContent = `Seu nome não consta na escala de ${formatDate(state.shiftDate)}. Procure o Administrador Geral.`;
      $('vehicleCards').innerHTML = '';
      return;
    }
    const selectedVehicle = assignment.assumed_at ? vehicleById(assignment.vehicle_id) : null;
    $('statusBanner').className = `status-banner${selectedVehicle ? ' active' : ''}`;
    $('statusBanner').textContent = selectedVehicle ? `Plantão assumido como ${roles[role]} na ${selectedVehicle.display_name}.` : role === 'medico' ? 'Você está escalado como Médico. Confirme abaixo a UTI 01.' : `Você está escalado em ${roles[role]}. Escolha a ambulância/equipe em que assumirá o plantão.`;
    $('vehicleCards').innerHTML = state.vehicles.sort((a, b) => order[a.code] - order[b.code]).map(v => professionalCard(v, assignment, role)).join('');
  }

  async function assume(vehicleId, button) {
    button.disabled = true; button.textContent = 'Confirmando...';
    try {
      await api('/rest/v1/rpc/assume_transport_shift', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_vehicle_id: vehicleId }) });
      show('Plantão assumido e vinculado ao seu login.', true); await loadShift();
    } catch (error) { show(error.message); button.disabled = false; button.textContent = 'Assumir nesta equipe'; }
  }

  async function loadShift() {
    const roster = await api(`/rest/v1/transport_shift_rosters?shift_date=eq.${state.shiftDate}&select=id,shift_date,driver_required,transport_shift_assignments(id,vehicle_id,user_id,user_name,professional_role,assumed_at)`);
    state.assignments = roster?.[0]?.transport_shift_assignments || [];
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
    } catch (error) {
      $('statusBanner').textContent = error.message; $('vehicleCards').innerHTML = '';
    }
  }

  $('vehicleCards').addEventListener('click', event => { const button = event.target.closest('button[data-assume]'); if (button) assume(button.dataset.assume, button); });
  init(); app.clearLegacyCaches().catch(() => {});
})();
