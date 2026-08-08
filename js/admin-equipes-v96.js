(() => {
  'use strict';
  const app = window.HEURO, session = app?.readSession?.();
  if (!app || !session?.access_token || session.access !== 'administrador_geral') { location.replace('./comando.html'); return; }
  const $ = id => document.getElementById(id);
  const roleNames = { medico: 'Médico', enfermagem: 'Enfermagem', motorista: 'Motorista' };
  const vehicleOrder = { 'UTI-01': 0, 'BASICA-01': 1, 'BASICA-02': 2 };
  const state = { vehicles: [], profiles: [], assignments: [], requests: [], driverRequired: true };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const roleForJob = job => { const j = String(job || '').toLowerCase(); if (j.includes('médic') || j.includes('medic')) return 'medico'; if (j.includes('enfermeir') || ((j.includes('técnic') || j.includes('tecnic') || j.includes('auxiliar')) && j.includes('enferm'))) return 'enfermagem'; if (j.includes('motorista') || j.includes('condutor')) return 'motorista'; return null; };
  const api = async (path, options = {}) => { const response = await fetch(app.apiUrl(path), { ...options, headers: { ...app.authenticatedHeaders(session.access_token), ...(options.headers || {}) }, cache: 'no-store' }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível concluir a operação.'); return data; };
  const show = (text, ok = false) => { const el = $('message'); el.textContent = text; el.className = `message${ok ? ' ok' : ''}`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 6000); };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const moveDate = days => { const d = new Date(`${$('shiftDate').value}T12:00:00-04:00`); d.setDate(d.getDate() + days); $('shiftDate').value = d.toISOString().slice(0, 10); syncRangeStart(); loadRoster(); };
  const syncRangeStart = () => { if (!$('repeatUntil').value || $('repeatUntil').value < $('shiftDate').value) $('repeatUntil').value = $('shiftDate').value; };
  const rolesForVehicle = vehicle => vehicle.code === 'UTI-01' ? ['medico', 'enfermagem', 'motorista'] : ['enfermagem', 'motorista'];

  function renderPlates() {
    $('plateFields').innerHTML = state.vehicles.sort((a, b) => vehicleOrder[a.code] - vehicleOrder[b.code]).map(v => `<label class="plate-field" data-code="${esc(v.code)}"><span><strong>${esc(v.display_name)}</strong><small>${v.support_type === 'avancado_uti' ? 'Suporte avançado' : 'Suporte básico'}</small></span><input data-plate="${esc(v.code)}" value="${esc(v.license_plate || '')}" maxlength="8" placeholder="ABC1D23" autocomplete="off" autocapitalize="characters"></label>`).join('');
  }
  const optionsFor = role => state.profiles.filter(p => roleForJob(p.job_role) === role).map(p => `<option value="${p.id}">${esc(p.display_name || p.full_name)} — ${esc(p.job_role)}</option>`).join('');
  const periodLabel = period => ({ '12h_diurno': '12h diurno · 07h–19h', '12h_noturno': '12h noturno · 19h–07h', '24h': '24h · 07h–07h' }[period] || '24h · 07h–07h');
  const durationPicker = (vehicleId, role) => `<div class="slot-duration"><label class="hours-12-day"><input type="radio" name="period-${vehicleId}-${role}" value="12h_diurno"><span>12h<br>Dia</span></label><label class="hours-12-night"><input type="radio" name="period-${vehicleId}-${role}" value="12h_noturno"><span>12h<br>Noite</span></label><label class="hours-24"><input type="radio" name="period-${vehicleId}-${role}" value="24h" checked><span>24h</span></label></div>`;
  function renderRoster() {
    const vehicles = [...state.vehicles].sort((a, b) => vehicleOrder[a.code] - vehicleOrder[b.code]);
    $('vehicleRosters').innerHTML = vehicles.map(vehicle => {
      const roles = rolesForVehicle(vehicle).filter(role => role !== 'motorista' || state.driverRequired);
      const slots = roles.map(role => `<div class="vehicle-slot"><label>${roleNames[role]}</label><select data-vehicle="${vehicle.id}" data-role="${role}"><option value="">Não informado</option>${optionsFor(role)}</select>${durationPicker(vehicle.id, role)}</div>`).join('');
      return `<section class="vehicle-roster ${vehicle.code === 'UTI-01' ? 'uti' : vehicle.code === 'BASICA-02' ? 'basic-two' : 'basic-one'}"><header><div><span>VEÍCULO</span><h3>${esc(vehicle.display_name)}</h3></div><b>${esc(vehicle.license_plate || 'SEM PLACA')}</b></header><div class="vehicle-slots">${slots}</div></section>`;
    }).join('');
    state.assignments.filter(a => a.professional_role !== 'administrador' && a.vehicle_id).forEach(a => {
      const select = document.querySelector(`select[data-vehicle="${a.vehicle_id}"][data-role="${a.professional_role}"]`);
      if (select) select.value = a.user_id;
      const radio = document.querySelector(`input[name="period-${a.vehicle_id}-${a.professional_role}"][value="${a.shift_period || '24h'}"]`);
      if (radio) radio.checked = true;
    });
    const required = [...document.querySelectorAll('select[data-vehicle][data-role]')];
    const complete = required.length > 0 && required.every(select => select.value);
    $('rosterStatus').className = `roster-status${complete ? ' complete' : ''}`;
    $('rosterStatus').textContent = complete ? 'Escala completa por veículo. Cada profissional já possui ambulância e jornada previstas.' : 'Escala em rascunho. Os campos podem ser completados depois; a entrada espontânea continua disponível.';
    $('driverRule').textContent = state.driverRequired ? 'Configuração atual: motorista obrigatório nas três ambulâncias.' : 'Configuração atual: motorista opcional. Essa regra é controlada em Configurações do sistema.';
  }
  function renderRequests() {
    $('requestCount').textContent = `${state.requests.length} ${state.requests.length === 1 ? 'pendente' : 'pendentes'}`;
    if (!state.requests.length) { $('accessRequests').innerHTML = '<div class="request-empty">Nenhuma solicitação aguardando liberação nesta data.</div>'; return; }
    $('accessRequests').innerHTML = state.requests.map(r => `<article class="access-request"><div class="request-head"><div><strong>${esc(r.user_name)}</strong><span>${esc(roleNames[r.professional_role] || r.professional_role)} · ${esc(r.transport_vehicles?.display_name || 'Veículo')} · ${periodLabel(r.shift_period)}</span></div><b>${esc(r.transport_vehicles?.license_plate || 'SEM PLACA')}</b></div><p>${esc(r.conflict_reason || 'Conflito com a escala vigente.')}</p><div class="request-actions"><button class="approve" data-review="${r.id}" data-approve="true">Liberar acesso</button><button class="deny" data-review="${r.id}" data-approve="false">Recusar</button></div></article>`).join('');
  }
  async function loadRoster() {
    $('rosterStatus').textContent = 'Carregando escala...';
    try {
      const [rows, requests] = await Promise.all([
        api(`/rest/v1/transport_shift_rosters?shift_date=eq.${$('shiftDate').value}&select=id,driver_required,transport_shift_assignments(id,user_id,user_name,professional_role,vehicle_id,assumed_at,duration_hours,shift_period,shift_ends_at)`),
        api(`/rest/v1/transport_shift_access_requests?shift_date=eq.${$('shiftDate').value}&status=eq.pendente&select=id,user_id,user_name,professional_role,vehicle_id,duration_hours,shift_period,status,conflict_reason,requested_at,transport_vehicles(display_name,license_plate)&order=requested_at.asc`)
      ]);
      const roster = rows?.[0]; state.assignments = roster?.transport_shift_assignments || []; state.requests = requests || []; if (roster) state.driverRequired = roster.driver_required; renderRoster(); renderRequests();
    } catch (error) { show(error.message); }
  }
  async function savePlates() {
    const button = $('savePlates'); button.disabled = true; button.textContent = 'Salvando...';
    try { const plates = [...document.querySelectorAll('[data-plate]')].map(input => ({ code: input.dataset.plate, license_plate: input.value })); const updated = await api('/rest/v1/rpc/save_transport_vehicle_plates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_plates: plates }) }); if (Array.isArray(updated)) state.vehicles = updated; renderPlates(); show('Placas salvas com sucesso.', true); } catch (error) { show(error.message); } finally { button.disabled = false; button.textContent = 'Salvar placas dos veículos'; }
  }
  async function saveRoster() {
    const button = $('saveRoster'); button.disabled = true; button.textContent = 'Salvando...';
    try {
      const assignments = [...document.querySelectorAll('select[data-vehicle][data-role]')].filter(select => select.value).map(select => {
        const period = document.querySelector(`input[name="period-${select.dataset.vehicle}-${select.dataset.role}"]:checked`);
        return { user_id: select.value, professional_role: select.dataset.role, vehicle_id: select.dataset.vehicle, shift_period: period?.value || '24h' };
      });
      const end = $('repeatRoster').checked ? $('repeatUntil').value : $('shiftDate').value;
      const result = await api('/rest/v1/rpc/save_transport_shift_roster_range', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_start_date: $('shiftDate').value, p_end_date: end, p_assignments: assignments }) });
      show(`${result?.days_saved || 1} ${Number(result?.days_saved) === 1 ? 'escala salva' : 'escalas salvas'} por veículo.`, true); await loadRoster();
    } catch (error) { show(error.message); } finally { button.disabled = false; button.textContent = $('repeatRoster').checked ? 'Salvar escalas do período' : 'Salvar escala do dia'; }
  }
  async function reviewRequest(id, approve, button) {
    button.disabled = true;
    try { await api('/rest/v1/rpc/review_transport_shift_access_request', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_request_id: id, p_approve: approve }) }); show(approve ? 'Acesso liberado para o profissional.' : 'Solicitação recusada e registrada.', true); await loadRoster(); } catch (error) { show(error.message); button.disabled = false; }
  }
  async function init() {
    try { const [vehicles, profiles, settings] = await Promise.all([api('/rest/v1/transport_vehicles?active=eq.true&code=in.(BASICA-01,BASICA-02,UTI-01)&select=id,code,display_name,support_type,license_plate,active'), api('/rest/v1/profiles?status=eq.aprovado&authorized_access=in.(executante,solicitante_executante,administrador_geral)&select=id,display_name,full_name,job_role,authorized_access&order=display_name.asc'), api('/rest/v1/transport_app_settings?id=eq.1&select=driver_report_enabled')]); state.vehicles = vehicles; state.profiles = profiles; state.driverRequired = settings?.[0]?.driver_report_enabled !== false; renderPlates(); $('shiftDate').value = today(); syncRangeStart(); await loadRoster(); } catch (error) { show(error.message); }
  }
  $('previousDay').addEventListener('click', () => moveDate(-1)); $('nextDay').addEventListener('click', () => moveDate(1)); $('shiftDate').addEventListener('change', () => { syncRangeStart(); loadRoster(); });
  $('repeatRoster').addEventListener('change', event => { $('rangeFields').hidden = !event.target.checked; $('saveRoster').textContent = event.target.checked ? 'Salvar escalas do período' : 'Salvar escala do dia'; syncRangeStart(); });
  $('monthEnd').addEventListener('click', () => { const d = new Date(`${$('shiftDate').value}T12:00:00-04:00`); d.setMonth(d.getMonth() + 1, 0); $('repeatUntil').value = d.toISOString().slice(0, 10); });
  $('accessRequests').addEventListener('click', event => { const button = event.target.closest('[data-review]'); if (button) reviewRequest(button.dataset.review, button.dataset.approve === 'true', button); });
  $('savePlates').addEventListener('click', savePlates); $('saveRoster').addEventListener('click', saveRoster); init(); app.clearLegacyCaches().catch(() => {});
})();
