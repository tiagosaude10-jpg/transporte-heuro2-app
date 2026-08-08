(() => {
  'use strict';
  const app = window.HEURO, session = app?.readSession?.();
  if (!app || !session?.access_token || session.access !== 'administrador_geral') { location.replace('./comando.html'); return; }
  const $ = id => document.getElementById(id);
  const roleMeta = {
    medico: { title: 'Médico', subtitle: '1 profissional · UTI 01', slots: 1 },
    enfermagem: { title: 'Enfermagem', subtitle: '3 profissionais · definição da ambulância ao assumir', slots: 3 },
    motorista: { title: 'Motoristas', subtitle: '3 profissionais · definição da ambulância ao assumir', slots: 3 }
  };
  const roleOrder = ['medico', 'enfermagem', 'motorista'];
  const vehicleOrder = { 'UTI-01': 0, 'BASICA-01': 1, 'BASICA-02': 2 };
  const state = { vehicles: [], profiles: [], assignments: [], driverRequired: true };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const roleForJob = job => { const j = String(job || '').toLowerCase(); if (j.includes('médic') || j.includes('medic')) return 'medico'; if (j.includes('enfermeir') || ((j.includes('técnic') || j.includes('tecnic') || j.includes('auxiliar')) && j.includes('enferm'))) return 'enfermagem'; if (j.includes('motorista') || j.includes('condutor')) return 'motorista'; return null; };
  const api = async (path, options = {}) => { const response = await fetch(app.apiUrl(path), { ...options, headers: { ...app.authenticatedHeaders(session.access_token), ...(options.headers || {}) }, cache: 'no-store' }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível concluir a operação.'); return data; };
  const show = (text, ok = false) => { const el = $('message'); el.textContent = text; el.className = `message${ok ? ' ok' : ''}`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 5000); };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const moveDate = days => { const d = new Date(`${$('shiftDate').value}T12:00:00-04:00`); d.setDate(d.getDate() + days); $('shiftDate').value = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); loadRoster(); };

  function renderPlates() {
    $('plateFields').innerHTML = state.vehicles.sort((a, b) => vehicleOrder[a.code] - vehicleOrder[b.code]).map(v => `<label class="plate-field"><span><strong>${esc(v.display_name)}</strong><small>${v.support_type === 'avancado_uti' ? 'Suporte avançado' : 'Suporte básico'}</small></span><input data-plate="${esc(v.code)}" value="${esc(v.license_plate || '')}" maxlength="8" placeholder="ABC1D23" autocomplete="off" autocapitalize="characters"></label>`).join('');
  }
  const optionsFor = role => state.profiles.filter(p => roleForJob(p.job_role) === role).map(p => `<option value="${p.id}">${esc(p.display_name || p.full_name)} — ${esc(p.job_role)}</option>`).join('');
  function renderRoster() {
    $('roleGroups').innerHTML = roleOrder.map(role => { const meta = roleMeta[role], current = state.assignments.filter(a => a.professional_role === role); const slots = Array.from({ length: meta.slots }, (_, index) => `<div class="role-slot"><label>${meta.title} ${meta.slots > 1 ? index + 1 : ''}</label><select data-role="${role}" data-slot="${index}"><option value="">Não informado</option>${optionsFor(role)}</select></div>`).join(''); return `<section class="role-group"><header><h3>${meta.title}</h3><span>${meta.subtitle}</span></header><div class="role-slots">${slots}</div></section>`; }).join('');
    roleOrder.forEach(role => { const rows = state.assignments.filter(a => a.professional_role === role); document.querySelectorAll(`select[data-role="${role}"]`).forEach((select, index) => { select.value = rows[index]?.user_id || ''; }); });
    const counts = Object.fromEntries(roleOrder.map(role => [role, state.assignments.filter(a => a.professional_role === role).length]));
    const complete = counts.medico >= 1 && counts.enfermagem >= 3 && (!state.driverRequired || counts.motorista >= 3);
    $('rosterStatus').className = `roster-status${complete ? ' complete' : ''}`;
    $('rosterStatus').textContent = complete ? 'Escala completa. Cada profissional deverá confirmar pessoalmente o plantão no botão Equipe do Plantão.' : 'Escala em rascunho. Você pode salvar os profissionais já definidos e completar depois.';
    $('driverRule').textContent = state.driverRequired ? 'Configuração atual: motorista obrigatório nas três ambulâncias.' : 'Configuração atual: motorista opcional. Essa regra é controlada em Configurações do sistema.';
  }
  async function loadRoster() {
    $('rosterStatus').textContent = 'Carregando escala...';
    try { const rows = await api(`/rest/v1/transport_shift_rosters?shift_date=eq.${$('shiftDate').value}&select=id,driver_required,transport_shift_assignments(id,user_id,user_name,professional_role,vehicle_id,assumed_at)`); const roster = rows?.[0]; state.assignments = roster?.transport_shift_assignments || []; if (roster) state.driverRequired = roster.driver_required; renderRoster(); } catch (error) { show(error.message); }
  }
  async function savePlates() {
    const button = $('savePlates'); button.disabled = true; button.textContent = 'Salvando...';
    try { const plates = [...document.querySelectorAll('[data-plate]')].map(input => ({ code: input.dataset.plate, license_plate: input.value })); const updated = await api('/rest/v1/rpc/save_transport_vehicle_plates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_plates: plates }) }); if (Array.isArray(updated)) state.vehicles = updated; renderPlates(); show('Placas salvas com sucesso.', true); } catch (error) { show(error.message); } finally { button.disabled = false; button.textContent = 'Salvar placas dos veículos'; }
  }
  async function saveRoster() {
    const button = $('saveRoster'); button.disabled = true; button.textContent = 'Salvando...';
    try { const assignments = [...document.querySelectorAll('select[data-role]')].filter(select => select.value).map(select => ({ user_id: select.value, professional_role: select.dataset.role })); await api('/rest/v1/rpc/save_transport_shift_roster', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_shift_date: $('shiftDate').value, p_assignments: assignments }) }); show('Escala do dia salva. Os profissionais já podem assumir o plantão com o próprio login.', true); await loadRoster(); } catch (error) { show(error.message); } finally { button.disabled = false; button.textContent = 'Salvar escala do dia'; }
  }
  async function init() {
    try { const [vehicles, profiles, settings] = await Promise.all([api('/rest/v1/transport_vehicles?active=eq.true&code=in.(BASICA-01,BASICA-02,UTI-01)&select=id,code,display_name,support_type,license_plate,active'), api('/rest/v1/profiles?status=eq.aprovado&authorized_access=in.(executante,solicitante_executante,administrador_geral)&select=id,display_name,full_name,job_role,authorized_access&order=display_name.asc'), api('/rest/v1/transport_app_settings?id=eq.1&select=driver_report_enabled')]); state.vehicles = vehicles; state.profiles = profiles; state.driverRequired = settings?.[0]?.driver_report_enabled !== false; renderPlates(); $('shiftDate').value = today(); await loadRoster(); } catch (error) { show(error.message); }
  }
  $('previousDay').addEventListener('click', () => moveDate(-1)); $('nextDay').addEventListener('click', () => moveDate(1)); $('shiftDate').addEventListener('change', loadRoster); $('savePlates').addEventListener('click', savePlates); $('saveRoster').addEventListener('click', saveRoster); init(); app.clearLegacyCaches().catch(() => {});
})();
