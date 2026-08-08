(() => {
  'use strict';

  const app = window.HEURO;
  const session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }
  if (!['executante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) {
    location.replace('./comando.html?motivo=sem_permissao_equipe');
    return;
  }

  const $ = (id) => document.getElementById(id);
  const overview = $('overviewPanel');
  const categoryPanel = $('categoryPanel');
  const categoryHeader = $('categoryHeader');
  const categoryCounter = $('categoryCounter');
  const searchNote = $('categorySearchNote');
  const list = $('requestList');
  const search = $('searchInput');
  const searchForm = $('searchForm');
  const modal = $('actionModal');
  const modalContent = $('modalContent');
  const modalTitle = $('modalTitle');
  const modalSubtitle = $('modalSubtitle');
  const confirmButton = $('modalConfirm');
  const generatePdfButton = $('generateSelectedPdf');
  const pdfSelectedCount = $('pdfSelectedCount');

  const STAGED_KEY = `heuro_transportes_provisorios_v78_${session.user_id}`;
  const REPORTS_KEY = `heuro_transportes_relatorios_v83_${session.user_id}`;
  const TERMINAL = new Set(['concluido', 'cancelado', 'recusado', 'suspenso']);
  const labels = {
    pendente: 'Pendente', solicitado: 'Solicitado', aguardando: 'Aguardando', aceito: 'Aceito',
    preparando_saida: 'Preparando saída', a_caminho_origem: 'A caminho da origem',
    no_local_origem: 'No local de origem', paciente_embarcado: 'Paciente embarcado',
    a_caminho_destino: 'A caminho do destino', no_destino: 'No destino',
    paciente_entregue: 'Paciente entregue', concluido: 'Concluído', suspenso: 'Suspenso',
    cancelado: 'Cancelado', recusado: 'Recusado', aguardando_ambulancia: 'Aguardando ambulância',
    aguardando_equipe: 'Aguardando equipe', basico: 'Suporte Básico',
    avancado_uti: 'Suporte Avançado / UTI', emergencia: 'Emergência', urgencia: 'Urgência',
    eletivo: 'Eletivo', transferencia: 'Transferência', exame_procedimento: 'Exame/Procedimento',
    consulta: 'Consulta', aguardando_aceites: 'Aguardando aceite da equipe',
    aguardando_relatorios: 'Aguardando relatórios', medico: 'Médico',
    enfermagem: 'Enfermagem', motorista: 'Motorista'
  };
  const tabMeta = {
    pending: { counter: 'Pendentes' },
    active: { counter: 'Aceitos' },
    completed: { counter: 'Concluídos' }
  };

  let requests = [];
  let ownProfile = null;
  let activeTab = 'pending';
  let selectedRequest = null;
  let searchMode = false;
  let searchTerm = '';
  let focusedRequestId = null;
  let committing = false;
  let backgroundPromise = null;
  let backgroundSent = false;
  let completedFilter = 'all';
  const staged = new Map();
  const stagedReports = new Map();
  const selectedIds = new Set();

  const auth = () => app.authenticatedHeaders(session.access_token);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
  const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const date = (value) => value ? String(value).slice(0, 10).split('-').reverse().join('/') : 'Não informada';
  const time = (value) => String(value || '').slice(0, 5) || 'Não informado';
  const dateTime = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Porto_Velho', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(parsed).replace(',', ' ·');
  };
  const executionOf = (request) => Array.isArray(request.transport_executions)
    ? request.transport_executions[0]
    : request.transport_executions;
  const participantsOf = (request) => {
    const participants = executionOf(request)?.transport_team_participations;
    return Array.isArray(participants) ? participants : [];
  };
  const ownParticipation = (request) => participantsOf(request).find((participant) => String(participant.user_id) === String(session.user_id));
  const isCollectiveFlow = (request) => Array.isArray(executionOf(request)?.required_reports);
  const participationProgress = (request) => {
    const execution = executionOf(request);
    if (!Array.isArray(execution?.required_reports)) return '';
    const participants = participantsOf(request);
    const missingAccepts = execution.required_reports.filter((role) => !participants.some((participant) => participant.professional_role === role));
    if (missingAccepts.length) return `Faltam aceites: ${missingAccepts.map((role) => labels[role] || role).join(', ')}`;
    const missingReports = execution.required_reports.filter((role) => !participants.some((participant) => participant.professional_role === role && participant.report_status === 'assinado'));
    if (missingReports.length) return `Faltam conclusões: ${missingReports.map((role) => labels[role] || role).join(', ')}`;
    return 'Todas as partes obrigatórias foram concluídas.';
  };
  const originalCategory = (request) => {
    const execution = executionOf(request);
    const status = norm(execution?.status || request.status);
    if (TERMINAL.has(status)) return 'completed';
    if (status === 'aguardando_aceites') return 'pending';
    if (execution) return 'active';
    return 'pending';
  };
  const userCategory = (request) => {
    const original = originalCategory(request);
    if (original === 'completed' || !isCollectiveFlow(request)) return original;
    const own = ownParticipation(request);
    if (own?.report_status === 'assinado') return 'completed';
    if (own) return 'active';
    return original;
  };
  const effectiveCategory = (request) => {
    const action = staged.get(String(request.id));
    if (action === 'accept') return 'active';
    if (action === 'complete') return 'completed';
    return userCategory(request);
  };
  const stamp = (request) => {
    const execution = executionOf(request);
    const category = originalCategory(request);
    if (category === 'completed') return new Date(execution?.completed_at || request.updated_at || 0).getTime();
    if (category === 'active') return new Date(execution?.accepted_at || request.updated_at || 0).getTime();
    return new Date(`${request.transport_date || '9999-12-31'}T${String(request.destination_time || '23:59').slice(0, 5)}:00`).getTime();
  };
  const priority = (request) => Number(request.priority_rank || ({ emergencia: 1, urgencia: 2, eletivo: 3 }[request.priority] || 3));
  const matches = (request, term) => !term || norm([
    request.patient_name, request.protocol, request.destination, request.origin_sector, request.origin_location,
    request.requester_name, request.transfer_reason, request.observations
  ].join(' ')).includes(term);
  const originText = (request) => `${request.origin_sector || '—'}${request.origin_location ? ` · ${['UTI', 'Sala Vermelha'].includes(request.origin_sector) ? 'Box' : 'Enfermaria/Leito'} ${request.origin_location}` : ''}`;
  const oxygenText = (request) => request.oxygen_required
    ? `Sim${request.oxygen_details ? ` · ${request.oxygen_details}` : ''}`
    : 'Não';
  const attachmentText = (request) => {
    const paths = Array.isArray(request.attachment_paths) ? request.attachment_paths : [];
    return paths.length ? `${paths.length} anexo(s)` : 'Sem anexos';
  };

  function readStaged() {
    try {
      const saved = JSON.parse(localStorage.getItem(STAGED_KEY) || '[]');
      if (!Array.isArray(saved)) return;
      saved.forEach(([id, action]) => {
        if (id && ['accept', 'complete'].includes(action)) staged.set(String(id), action);
      });
    } catch (_) { localStorage.removeItem(STAGED_KEY); }
    try {
      const savedReports = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
      if (Array.isArray(savedReports)) savedReports.forEach(([id, report]) => { if (id && report) stagedReports.set(String(id), report); });
    } catch (_) { localStorage.removeItem(REPORTS_KEY); }
  }

  function saveStaged() {
    if (staged.size) localStorage.setItem(STAGED_KEY, JSON.stringify([...staged.entries()]));
    else localStorage.removeItem(STAGED_KEY);
    if (stagedReports.size) localStorage.setItem(REPORTS_KEY, JSON.stringify([...stagedReports.entries()]));
    else localStorage.removeItem(REPORTS_KEY);
  }

  function reconcileStaged() {
    for (const [id, action] of staged) {
      const request = requests.find((item) => String(item.id) === String(id));
      const own = request ? ownParticipation(request) : null;
      if (!request || (action === 'accept' && (originalCategory(request) !== 'pending' || (isCollectiveFlow(request) && own))) ||
          (action === 'complete' && (originalCategory(request) === 'completed' || (isCollectiveFlow(request) && own?.report_status === 'assinado')))) {
        staged.delete(id);
        stagedReports.delete(id);
      }
    }
    saveStaged();
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(app.apiUrl(path), {
      ...options,
      headers: { ...auth(), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.hint || data?.details || 'Falha ao carregar dados.');
    return data;
  }

  function counts() {
    return {
      pending: requests.filter((request) => effectiveCategory(request) === 'pending').length,
      active: requests.filter((request) => effectiveCategory(request) === 'active').length,
      completed: requests.filter((request) => effectiveCategory(request) === 'completed').length
    };
  }

  function updateCounts() {
    const current = counts();
    $('pendingCount').textContent = current.pending;
    $('activeCount').textContent = current.active;
    $('completedCount').textContent = current.completed;
    const value = searchMode
      ? requests.filter((request) => matches(request, searchTerm)).length
      : focusedRequestId
        ? requests.filter((request) => String(request.id) === String(focusedRequestId) && effectiveCategory(request) === activeTab).length
        : current[activeTab];
    categoryCounter.innerHTML = `<strong>${value}</strong><span>${searchMode ? 'Resultados' : focusedRequestId ? 'Encontrado' : tabMeta[activeTab].counter}</span>`;
  }

  function showOverview() {
    searchMode = false;
    searchTerm = '';
    focusedRequestId = null;
    selectedIds.clear();
    categoryPanel.hidden = true;
    overview.hidden = false;
    search.value = '';
    updateCounts();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  function openCategory(tab, fromSearch = false, focusId = null) {
    const tabChanged = activeTab !== tab;
    activeTab = tab;
    if (tabChanged) selectedIds.clear();
    searchMode = fromSearch;
    focusedRequestId = focusId;
    overview.hidden = true;
    categoryPanel.hidden = false;
    categoryHeader.className = fromSearch ? 'category-header category-search' : `category-header category-${tab}`;
    searchNote.hidden = !(fromSearch || focusId);
    searchNote.textContent = fromSearch
      ? 'Cada resultado mostra sua situação atual. Toque em “Abrir em...” para acessar a tabela completa.'
      : 'Exibindo somente o transporte localizado. Use “Equipe” para voltar às categorias.';
    render();
    categoryPanel.querySelector('.category-content').scrollTop = 0;
  }

  async function load() {
    try {
      const [data, profiles] = await Promise.all([
        fetchJson('/rest/v1/transport_requests?select=id,protocol,status,patient_name,birth_date,origin_sector,origin_location,destination,support_type,priority,priority_rank,transport_date,destination_time,transfer_reason,oxygen_required,oxygen_details,observations,attachment_paths,requester_name,created_at,updated_at,transport_executions(*,transport_team_participations(*))&order=created_at.desc'),
        fetchJson(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=id,display_name,full_name,job_role`)
      ]);
      requests = Array.isArray(data) ? data : [];
      ownProfile = Array.isArray(profiles) ? profiles[0] : null;
      reconcileStaged();
      for (const id of [...selectedIds]) {
        if (!requests.some((request) => String(request.id) === String(id))) selectedIds.delete(id);
      }
      render();
    } catch (error) {
      list.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    }
  }

  function stageAction(id, action) {
    staged.set(String(id), action);
    backgroundSent = false;
    saveStaged();
    render();
    requestAnimationFrame(() => document.querySelector(`[data-row-id="${CSS.escape(String(id))}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function undoAction(id) {
    staged.delete(String(id));
    stagedReports.delete(String(id));
    saveStaged();
    render();
  }

  const tableHead = () => `<thead><tr>
    <th class="cell-select"><input class="row-selector select-all-visible" type="checkbox" aria-label="Selecionar todos os transportes visíveis"></th>
    <th>Paciente</th><th>Protocolo</th><th>Nascimento</th><th>Origem</th><th>Destino</th>
    <th>Data do destino</th><th>Horário do destino</th><th>Ambulância</th><th>Prioridade</th>
    <th>Motivo</th><th>Oxigênio</th><th>Solicitante</th><th>Executante</th>
    <th>Horário da solicitação</th><th>Horário do aceite</th><th>Horário da conclusão</th><th>Documentos</th>
    <th>Observações</th><th>Ações</th>
  </tr></thead>`;

  function lifecycleButton(request, mode) {
    const own = ownParticipation(request);
    const collective = isCollectiveFlow(request);
    if (mode === 'pending' && collective && own) return '<button class="lifecycle-action signed-button compact" type="button" disabled>Meu aceite registrado</button>';
    if (mode === 'pending') return `<button class="lifecycle-action accept compact" data-stage-accept="${esc(request.id)}" type="button">${collective ? 'Registrar meu aceite' : 'Aceitar'}</button>`;
    if (mode === 'provisional-accept') return `<button class="lifecycle-action undo compact" data-undo="${esc(request.id)}" type="button">Desaceitar</button>`;
    if (mode === 'active' && collective) {
      if (!own) return '';
      if (own.report_status === 'assinado') return '<button class="lifecycle-action signed-button compact" type="button" disabled>Minha parte assinada</button>';
      return `<button class="lifecycle-action report-button compact" data-open-report="${esc(request.id)}" type="button">Concluir minha parte</button>`;
    }
    if (mode === 'active') return `<button class="lifecycle-action conclude compact" data-stage-complete="${esc(request.id)}" type="button">Concluir</button>`;
    if (mode === 'provisional-complete') return `<button class="lifecycle-action undo compact" data-undo="${esc(request.id)}" type="button">Desconcluir</button>`;
    return '';
  }

  function tableActionButtons(request, mode) {
    const execution = executionOf(request);
    const conclude = `<button class="lifecycle-action conclude compact" data-stage-complete="${esc(request.id)}" type="button">Concluir</button>`;
    if (mode === 'pending') return (isCollectiveFlow(request) ? '' : conclude) + lifecycleButton(request, mode);
    if (mode === 'active') return lifecycleButton(request, mode);
    if (mode === 'completed' && norm(execution?.status) === 'suspenso') {
      return `<button class="lifecycle-action accept compact" data-reactivate="${esc(request.id)}" type="button">Reativar</button>`;
    }
    return lifecycleButton(request, mode);
  }

  function tableRow(request, mode) {
    const execution = executionOf(request);
    const provisional = mode.startsWith('provisional');
    const selected = selectedIds.has(String(request.id));
    return `<tr data-row-id="${esc(request.id)}" class="${provisional ? 'provisional-row ' : ''}${selected ? 'selected-row' : ''}">
      <td class="cell-select"><input class="row-selector" data-select-row="${esc(request.id)}" type="checkbox" ${selected ? 'checked' : ''} aria-label="Selecionar transporte de ${esc(request.patient_name || 'paciente')}"></td>
      <td class="cell-patient"><strong>${esc(request.patient_name || 'Não informado')}</strong></td>
      <td>${esc(request.protocol || 'SEM PROTOCOLO')}</td>
      <td>${date(request.birth_date)}</td>
      <td class="cell-wide">${esc(originText(request))}</td>
      <td class="cell-wide">${esc(request.destination || 'Não informado')}</td>
      <td>${date(request.transport_date)}</td>
      <td>${time(request.destination_time)}</td>
      <td>${esc(labels[request.support_type] || request.support_type || '—')}</td>
      <td>${esc(labels[request.priority] || request.priority || '—')}</td>
      <td>${esc(labels[request.transfer_reason] || request.transfer_reason || '—')}</td>
      <td class="cell-wide">${esc(oxygenText(request))}</td>
      <td class="cell-wide">${esc(request.requester_name || 'Não informado')}</td>
      <td class="cell-wide">${esc(isCollectiveFlow(request) ? participationProgress(request) : execution?.responsible_name || 'Não definido')}</td>
      <td>${dateTime(request.created_at)}</td>
      <td>${dateTime(execution?.accepted_at)}</td>
      <td>${dateTime(execution?.completed_at)}</td>
      <td>${esc(attachmentText(request))}</td>
      <td class="cell-notes">${esc(request.observations || 'Sem observações')}</td>
      <td><div class="table-actions">${tableActionButtons(request, mode)}</div></td>
    </tr>`;
  }

  function tableSection(data, mode, title = '') {
    if (!data.length) return '';
    const provisional = mode.startsWith('provisional');
    return `<section class="transport-table-section ${provisional ? 'provisional-section' : ''} ${mode === 'active' || mode === 'provisional-accept' ? 'accepted-section' : mode === 'completed' || mode === 'provisional-complete' ? 'completed-section' : 'waiting-section'}">
      ${title ? `<header class="table-section-heading"><h3>${esc(title)}</h3><span>${data.length}</span>${provisional ? '<p>Alteração provisória: você ainda pode desfazer. Será gravada ao sair desta tela.</p>' : ''}</header>` : ''}
      <div class="table-scroll"><table class="transport-table">${tableHead()}<tbody>${data.map((request) => tableRow(request, mode)).join('')}</tbody></table></div>
    </section>`;
  }

  function renderPending(term = '') {
    const conclusions = requests.filter((request) => userCategory(request) === 'pending' && staged.get(String(request.id)) === 'complete' && matches(request, term)).sort((a, b) => priority(a) - priority(b) || stamp(a) - stamp(b));
    const acceptances = requests.filter((request) => userCategory(request) === 'pending' && staged.get(String(request.id)) === 'accept' && matches(request, term)).sort((a, b) => priority(a) - priority(b) || stamp(a) - stamp(b));
    const waiting = requests.filter((request) => userCategory(request) === 'pending' && !staged.has(String(request.id)) && (!focusedRequestId || String(request.id) === String(focusedRequestId)) && matches(request, term)).sort((a, b) => priority(a) - priority(b) || stamp(a) - stamp(b));
    list.innerHTML = `${tableSection(conclusions, 'provisional-complete', 'Conclusões selecionadas')}${tableSection(acceptances, 'provisional-accept', 'Aceites selecionados')}${tableSection(waiting, 'pending')}` || '<div class="empty">Nenhum transporte pendente.</div>';
    bindActions();
  }

  function renderActive(term = '') {
    const chosen = requests.filter((request) => userCategory(request) === 'active' && staged.get(String(request.id)) === 'complete' && matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    const active = requests.filter((request) => userCategory(request) === 'active' && !staged.has(String(request.id)) && (!focusedRequestId || String(request.id) === String(focusedRequestId)) && matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    list.innerHTML = `${tableSection(chosen, 'provisional-complete', 'Conclusões selecionadas')}${tableSection(active, 'active')}` || '<div class="empty">Nenhum transporte aceito.</div>';
    bindActions();
  }

  function renderCompleted(term = '') {
    const all = requests.filter((request) => userCategory(request) === 'completed' && (!focusedRequestId || String(request.id) === String(focusedRequestId)) && matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    const statusOf = (request) => norm(executionOf(request)?.status || request.status);
    const completed = completedFilter === 'all' ? all : all.filter((request) => statusOf(request) === completedFilter);
    const filterLabels = { all: 'Todos', concluido: 'Concluídos', cancelado: 'Cancelados', suspenso: 'Suspensos', recusado: 'Recusados' };
    const filters = `<nav class="terminal-filters" aria-label="Filtrar histórico">${Object.entries(filterLabels).map(([value,label]) => {
      const count = value === 'all' ? all.length : all.filter((request) => statusOf(request) === value).length;
      return `<button class="${completedFilter === value ? 'active' : ''}" data-terminal-filter="${value}" type="button">${label} <b>${count}</b></button>`;
    }).join('')}</nav>`;
    list.innerHTML = filters + (tableSection(completed, 'completed') || '<div class="empty">Nenhum transporte nesta situação.</div>');
    bindActions();
  }

  const searchCategoryMeta = {
    pending: { label: 'Pendente', button: 'Abrir em Pendentes' },
    active: { label: 'Aceito / em execução', button: 'Abrir em Aceitos' },
    completed: { label: 'Concluído / encerrado', button: 'Abrir em Concluídos' }
  };

  function searchResultHtml(request) {
    const execution = executionOf(request);
    const category = effectiveCategory(request);
    const status = norm(execution?.status || request.status) || 'pendente';
    const meta = searchCategoryMeta[category];
    return `<article class="search-result search-result-${category}"><div class="search-result-head"><div><h2>${esc(request.patient_name)}</h2><div class="protocol">${esc(request.protocol || 'SEM PROTOCOLO')}</div></div><span class="search-result-status">${esc(meta.label)}</span></div><div class="search-result-route"><b>${esc(originText(request))}</b> → <b>${esc(request.destination)}</b></div><div class="search-result-meta"><span><b>Status atual:</b> ${esc(labels[status] || status)}</span><span><b>Solicitado:</b> ${dateTime(request.created_at)}</span><span><b>Aceito:</b> ${dateTime(execution?.accepted_at)}</span><span><b>Concluído:</b> ${dateTime(execution?.completed_at)}</span></div><div class="search-result-actions"><button class="open-category-button" data-open-tab="${category}" data-open-id="${esc(request.id)}" type="button">${esc(meta.button)}</button></div></article>`;
  }

  function renderSearchResults(term) {
    const data = requests.filter((request) => matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    list.innerHTML = data.length ? `<div class="search-results">${data.map(searchResultHtml).join('')}</div>` : '<div class="empty">Nenhum transporte encontrado para esse nome ou protocolo.</div>';
    bindActions();
  }

  function render() {
    updateCounts();
    if (categoryPanel.hidden) return;
    if (searchMode) { renderSearchResults(searchTerm); return; }
    if (activeTab === 'pending') renderPending();
    else if (activeTab === 'active') renderActive();
    else renderCompleted();
  }

  function visibleSelectionIds() {
    return [...list.querySelectorAll('[data-select-row]')].map((input) => String(input.dataset.selectRow));
  }

  function syncSelectionControls() {
    list.querySelectorAll('[data-select-row]').forEach((input) => {
      const selected = selectedIds.has(String(input.dataset.selectRow));
      input.checked = selected;
      input.closest('tr')?.classList.toggle('selected-row', selected);
    });
    const visible = visibleSelectionIds();
    const selectedVisible = visible.filter((id) => selectedIds.has(id)).length;
    list.querySelectorAll('.select-all-visible').forEach((input) => {
      input.checked = Boolean(visible.length && selectedVisible === visible.length);
      input.indeterminate = Boolean(selectedVisible && selectedVisible < visible.length);
    });
    if (generatePdfButton) {
      generatePdfButton.disabled = selectedIds.size === 0;
      generatePdfButton.classList.toggle('has-selection', selectedIds.size > 0);
    }
    if (pdfSelectedCount) pdfSelectedCount.textContent = String(selectedIds.size);
  }

  const reportMarks = {
    medico: [
      ['estado_estavel', 'Paciente estável'], ['estado_grave', 'Paciente grave/crítico'],
      ['suporte_respiratorio', 'Suporte respiratório'], ['ventilacao_mecanica', 'Ventilação mecânica'],
      ['monitorizacao', 'Monitorização contínua'], ['droga_vasoativa', 'Droga vasoativa'],
      ['medicacao', 'Medicação administrada'], ['procedimento', 'Procedimento/conduta realizada'],
      ['intercorrencia', 'Intercorrência durante o transporte'], ['entrega_realizada', 'Paciente entregue à equipe receptora']
    ],
    enfermagem: [
      ['estado_estavel', 'Paciente estável'], ['estado_grave', 'Paciente grave/crítico'],
      ['consciente', 'Consciente/alerta'], ['sedado', 'Sedado'],
      ['monitorizacao', 'Monitorização contínua'], ['oxigenoterapia', 'Oxigenoterapia'],
      ['ventilacao_mecanica', 'Ventilação mecânica'], ['dispositivos_conferidos', 'Acessos, sondas e drenos conferidos'],
      ['medicacao', 'Medicação executada'], ['intercorrencia', 'Intercorrência durante o transporte'],
      ['documentos_entregues', 'Documentos/exames entregues'], ['entrega_realizada', 'Paciente entregue à equipe receptora']
    ],
    motorista: [
      ['veiculo_conferido', 'Ambulância conferida antes da saída'], ['limpeza_adequada', 'Limpeza em condições adequadas'],
      ['combustivel_adequado', 'Combustível suficiente'], ['equipamentos_fixados', 'Equipamentos e materiais fixados'],
      ['oxigenio_acondicionado', 'Cilindros de oxigênio acondicionados'], ['rota_sem_alteracao', 'Trajeto sem alteração operacional'],
      ['transito_intenso', 'Trânsito intenso/atraso na rota'], ['falha_mecanica', 'Falha mecânica'],
      ['ocorrencia_operacional', 'Outra ocorrência operacional'], ['retorno_base', 'Retorno à base registrado']
    ]
  };
  const reportTemplates = {
    medico: {
      '': '',
      sem_intercorrencias: 'Transporte médico realizado sem intercorrências. Paciente mantido sob monitorização e entregue à equipe receptora nas condições registradas neste formulário.',
      avc: 'Paciente em transporte por condição neurológica. Registrar nível de consciência, suporte utilizado, evolução clínica, intercorrências, condutas e condição na entrega.',
      dpoc: 'Paciente em transporte por condição respiratória. Registrar oxigenoterapia ou ventilação, saturação, monitorização, intercorrências, condutas e condição na entrega.',
      trauma: 'Paciente vítima de trauma. Registrar imobilizações, monitorização, suporte, intercorrências, condutas e condição na entrega.',
      sindrome_coronariana: 'Paciente em transporte por síndrome coronariana. Registrar monitorização, suporte hemodinâmico, medicações, intercorrências, condutas e condição na entrega.'
    },
    enfermagem: {
      '': '',
      sem_intercorrencias: 'Transporte de enfermagem realizado sem intercorrências. Mantidos os cuidados, a monitorização e a segurança dos dispositivos registrados neste formulário. Paciente entregue à equipe receptora.',
      avc: 'Paciente em transporte por condição neurológica. Registrar consciência, sinais vitais, oxigenação, dispositivos, cuidados, intercorrências e condição na entrega.',
      dpoc: 'Paciente em transporte por condição respiratória. Registrar oxigenoterapia ou ventilação, saturação, sinais vitais, dispositivos, cuidados, intercorrências e condição na entrega.',
      trauma: 'Paciente vítima de trauma. Registrar imobilizações, sinais vitais, dispositivos, cuidados, intercorrências e condição na entrega.',
      pos_operatorio: 'Paciente em transporte no período pós-operatório. Registrar sinais vitais, dispositivos, curativos, infusões, dor, intercorrências e condição na entrega.'
    },
    motorista: {
      '': '',
      sem_intercorrencias: 'Deslocamento realizado sem ocorrência operacional. Ambulância e equipamentos conferidos conforme os itens selecionados.',
      atraso_rota: 'Houve alteração no tempo de deslocamento. Descrever o motivo, o local aproximado e a repercussão operacional.',
      falha_veiculo: 'Houve ocorrência relacionada ao veículo. Descrever o sinal observado, a providência adotada e a continuidade do deslocamento.',
      apoio_operacional: 'Foi necessário apoio operacional durante o deslocamento. Descrever o motivo e a providência adotada.'
    }
  };
  const templateLabels = {
    sem_intercorrencias: 'Sem intercorrências', avc: 'Paciente com AVC', dpoc: 'Paciente com DPOC',
    trauma: 'Paciente vítima de trauma', sindrome_coronariana: 'Síndrome coronariana/infarto',
    pos_operatorio: 'Paciente pós-operatório', atraso_rota: 'Atraso ou alteração de rota',
    falha_veiculo: 'Falha no veículo', apoio_operacional: 'Apoio operacional'
  };

  function openReport(id) {
    selectedRequest = getRequest(id);
    if (!selectedRequest) return;
    const own = ownParticipation(selectedRequest);
    if (!own) { alert('Registre seu aceite antes de concluir sua parte.'); return; }
    if (own.report_status === 'assinado') { alert('Sua parte já foi assinada.'); return; }
    const role = own.professional_role;
    const templates = reportTemplates[role] || {};
    const marks = reportMarks[role] || [];
    const saved = stagedReports.get(String(id)) || {};
    modalTitle.textContent = `Relatório de ${labels[role] || role}`;
    modalSubtitle.textContent = selectedRequest.protocol || '';
    modalContent.innerHTML = `<div class="identity-note"><b>Autor:</b> ${esc(own.user_name || ownProfile?.display_name || ownProfile?.full_name || 'Usuário')}<br><b>Categoria:</b> ${esc(labels[role] || role)}<br><small>A conclusão ficará provisória até você sair da tela. Depois de gravada, esta parte ficará vinculada ao seu login.</small></div>
      <div class="field full"><label>Modelo de relatório</label><select id="reportTemplate"><option value="">Sem modelo</option>${Object.keys(templates).filter(Boolean).map((value) => `<option value="${esc(value)}" ${saved.template === value ? 'selected' : ''}>${esc(templateLabels[value] || value)}</option>`).join('')}</select></div>
      <div class="report-checks">${marks.map(([value, text]) => `<label class="report-check"><input name="reportMark" type="checkbox" value="${esc(value)}" ${saved.marks?.includes(value) ? 'checked' : ''}><span>${esc(text)}</span></label>`).join('')}</div>
      ${role === 'motorista' ? `<div class="sheet-grid"><div class="field"><label>Quilometragem de saída</label><input id="kmStart" type="number" min="0" step="0.1" inputmode="decimal" value="${saved.km_start ?? ''}"></div><div class="field"><label>Quilometragem de chegada</label><input id="kmEnd" type="number" min="0" step="0.1" inputmode="decimal" value="${saved.km_end ?? ''}"></div></div>` : ''}
      <div class="field full"><label>Descrição complementar</label><textarea id="reportNarrative" rows="6" maxlength="5000" placeholder="Digite, ajuste ou complemente o relatório.">${esc(saved.narrative || '')}</textarea></div>
      <label class="review-confirm"><input id="reviewConfirmed" type="checkbox"><span>Revisei as marcações e confirmo que este registro corresponde ao que acompanhei ou executei.</span></label>`;
    const template = $('reportTemplate');
    const narrative = $('reportNarrative');
    template.onchange = () => {
      const value = templates[template.value] || '';
      if (!narrative.value.trim() || confirm('Substituir o texto atual pelo modelo escolhido?')) narrative.value = value;
    };
    confirmButton.classList.remove('hidden');
    confirmButton.textContent = 'Marcar minha conclusão';
    confirmButton.onclick = () => stageReport(id, role);
    showModal();
  }

  function stageReport(id, role) {
    const marks = [...modalContent.querySelectorAll('input[name="reportMark"]:checked')].map((input) => input.value);
    const narrative = $('reportNarrative').value.trim();
    if (!marks.length) { alert('Marque pelo menos uma informação do relatório.'); return; }
    if (!$('reviewConfirmed').checked) { alert('Confirme que você revisou o relatório.'); return; }
    if (marks.some((mark) => ['intercorrencia', 'falha_mecanica', 'ocorrencia_operacional'].includes(mark)) && !narrative) {
      alert('Descreva a intercorrência ou ocorrência no campo complementar.'); return;
    }
    const report = { role, marks, template: $('reportTemplate').value || null, narrative: narrative || null };
    if (role === 'motorista') {
      report.km_start = $('kmStart').value ? Number($('kmStart').value) : null;
      report.km_end = $('kmEnd').value ? Number($('kmEnd').value) : null;
      if (report.km_start != null && report.km_end != null && report.km_end < report.km_start) {
        alert('A quilometragem de chegada não pode ser menor que a de saída.'); return;
      }
    }
    stagedReports.set(String(id), report);
    stageAction(id, 'complete');
    closeModal();
  }

  function bindActions() {
    list.querySelectorAll('[data-stage-accept]').forEach((button) => { button.onclick = () => stageAction(button.dataset.stageAccept, 'accept'); });
    list.querySelectorAll('[data-stage-complete]').forEach((button) => { button.onclick = () => stageAction(button.dataset.stageComplete, 'complete'); });
    list.querySelectorAll('[data-open-report]').forEach((button) => { button.onclick = () => openReport(button.dataset.openReport); });
    list.querySelectorAll('[data-undo]').forEach((button) => { button.onclick = () => undoAction(button.dataset.undo); });
    list.querySelectorAll('[data-open-tab]').forEach((button) => { button.onclick = () => openCategory(button.dataset.openTab, false, button.dataset.openId); });
    list.querySelectorAll('[data-terminal-filter]').forEach((button) => {
      button.onclick = () => { completedFilter = button.dataset.terminalFilter || 'all'; renderCompleted(searchMode ? searchTerm : ''); };
    });
    list.querySelectorAll('[data-status-menu]').forEach((button) => { button.onclick = () => openStatusMenu(button.dataset.statusMenu); });
    list.querySelectorAll('[data-reactivate]').forEach((button) => { button.onclick = () => changeStatusNow(button.dataset.reactivate, 'aceito', 'Transporte reativado.'); });
    list.querySelectorAll('[data-select-row]').forEach((input) => {
      input.onchange = () => {
        const id = String(input.dataset.selectRow);
        if (input.checked) selectedIds.add(id); else selectedIds.delete(id);
        syncSelectionControls();
      };
    });
    list.querySelectorAll('.select-all-visible').forEach((input) => {
      input.onchange = () => {
        visibleSelectionIds().forEach((id) => {
          if (input.checked) selectedIds.add(id); else selectedIds.delete(id);
        });
        syncSelectionControls();
      };
    });
    syncSelectionControls();
  }

  const getRequest = (id) => requests.find((request) => String(request.id) === String(id));
  function showModal() { modal.classList.add('show'); }
  function closeModal() { modal.classList.remove('show'); selectedRequest = null; confirmButton.classList.remove('hidden'); confirmButton.onclick = null; }

  async function changeStatusNow(id, status, notes) {
    try {
      list.classList.add('is-saving');
      await fetchJson('/rest/v1/rpc/change_transport_execution_status', {
        method: 'POST',
        body: JSON.stringify({ p_request_id: id, p_new_status: status, p_notes: notes || null })
      });
      await load();
    } catch (error) {
      alert(error.message || 'Não foi possível atualizar o transporte.');
    } finally {
      list.classList.remove('is-saving');
    }
  }

  async function openStatusMenu(id) {
    const request = getRequest(id);
    if (!request) return;
    const hasExecution = Boolean(executionOf(request));
    const answer = prompt(hasExecution
      ? 'Digite 1 para Suspender, 2 para Cancelar ou 3 para Recusar este transporte.'
      : 'Digite 1 para Cancelar ou 2 para Recusar esta solicitação.');
    if (answer === null) return;
    const status = hasExecution
      ? ({ '1': 'suspenso', '2': 'cancelado', '3': 'recusado' })[answer.trim()]
      : ({ '1': 'cancelado', '2': 'recusado' })[answer.trim()];
    if (!status) { alert('Opção inválida.'); return; }
    const reason = prompt(`Informe obrigatoriamente o motivo de ${labels[status].toLowerCase()}:`);
    if (reason === null) return;
    if (!reason.trim()) { alert('O motivo é obrigatório.'); return; }
    if (!confirm(`Confirmar: ${labels[status]} — ${reason.trim()}?`)) return;
    await changeStatusNow(id, status, reason.trim());
  }

  const storagePath = (path) => String(path || '').split('/').map(encodeURIComponent).join('/');
  async function downloadAttachment(path) {
    const response = await fetch(app.apiUrl(`/storage/v1/object/authenticated/transport-attachments/${storagePath(path)}`), {
      headers: auth(), cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Falha ao carregar o anexo ${path.split('/').pop()}.`);
    return response.blob();
  }

  async function imageForPdf(blob) {
    if (!String(blob.type || '').startsWith('image/')) return null;
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Imagem inválida.'));
        image.src = url;
      });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/jpeg', .72), width: canvas.width, height: canvas.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function appendAttachments(doc, request, addHeader) {
    const paths = Array.isArray(request.attachment_paths) ? request.attachment_paths : [];
    for (let index = 0; index < paths.length; index += 1) {
      doc.addPage();
      let y = addHeader(request, true);
      doc.setTextColor(18, 61, 112);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`ANEXO ${index + 1} DE ${paths.length}`, 12, y + 2);
      try {
        const blob = await downloadAttachment(paths[index]);
        const picture = await imageForPdf(blob);
        if (!picture) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text('Este anexo é um documento PDF e permanece disponível no sistema.', 12, y + 12);
          continue;
        }
        const maxWidth = 186;
        const maxHeight = 245;
        const ratio = Math.min(maxWidth / picture.width, maxHeight / picture.height);
        const width = picture.width * ratio;
        const height = picture.height * ratio;
        doc.addImage(picture.data, 'JPEG', 12 + (maxWidth - width) / 2, y + 8, width, height, undefined, 'FAST');
      } catch (error) {
        doc.setTextColor(160, 35, 45);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(error.message || 'Não foi possível incorporar este anexo.', 12, y + 12);
      }
    }
  }

  const pdfFieldRows = (request) => {
    const execution = executionOf(request);
    const action = staged.get(String(request.id));
    const status = action === 'accept' ? 'Aceite selecionado — será gravado ao sair'
      : action === 'complete' ? 'Conclusão selecionada — será gravada ao sair'
      : labels[norm(execution?.status || request.status)] || execution?.status || request.status || 'Pendente';
    const acceptedAt = execution?.accepted_at || (action === 'accept' || action === 'complete' ? 'Será registrado ao sair da tela' : null);
    const completedAt = execution?.completed_at || (action === 'complete' ? 'Será registrado ao sair da tela' : null);
    const rows = [
      ['Paciente', request.patient_name || 'Não informado'],
      ['Protocolo', request.protocol || 'SEM PROTOCOLO'],
      ['Nascimento', date(request.birth_date)],
      ['Origem', originText(request)],
      ['Destino', request.destination || 'Não informado'],
      ['Data do destino', date(request.transport_date)],
      ['Horário do destino', time(request.destination_time)],
      ['Ambulância', labels[request.support_type] || request.support_type || '—'],
      ['Prioridade', labels[request.priority] || request.priority || '—'],
      ['Motivo', labels[request.transfer_reason] || request.transfer_reason || '—'],
      ['Oxigênio', oxygenText(request)],
      ['Solicitante', request.requester_name || 'Não informado'],
      ['Executante', execution?.responsible_name || 'Não definido'],
      ['Horário da solicitação', dateTime(request.created_at)],
      ['Horário do aceite', acceptedAt === 'Será registrado ao sair da tela' ? acceptedAt : dateTime(acceptedAt)],
      ['Horário da conclusão', completedAt === 'Será registrado ao sair da tela' ? completedAt : dateTime(completedAt)],
      ['Documentos', attachmentText(request)],
      ['Observações', request.observations || 'Sem observações'],
      ['Status', status]
    ];
    participantsOf(request).filter((participant) => participant.report_status === 'assinado').forEach((participant) => {
      const role = labels[participant.professional_role] || participant.professional_role;
      const data = participant.report_data || {};
      const selectedMarks = Array.isArray(data.marks)
        ? data.marks.map((mark) => reportMarks[participant.professional_role]?.find(([value]) => value === mark)?.[1] || mark).join('; ')
        : 'Sem marcações registradas';
      rows.push([`Relatório — ${role}`, `${participant.user_name || 'Profissional'} · assinado em ${dateTime(participant.signed_at)}\n${selectedMarks}${participant.narrative ? `\n${participant.narrative}` : ''}`]);
    });
    return rows;
  };

  async function generateSelectedPdf() {
    const selected = requests.filter((request) => selectedIds.has(String(request.id)));
    if (!selected.length) { alert('Selecione pelo menos um transporte para gerar o PDF.'); return; }
    const originalLabel = generatePdfButton.querySelector('.pdf-button-label')?.textContent || 'Gerar PDF';
    generatePdfButton.disabled = true;
    generatePdfButton.querySelector('.pdf-button-label').textContent = 'Gerando...';
    try {
      if (window.HEURO_PDF?.loadJsPdf) await window.HEURO_PDF.loadJsPdf();
      if (!window.jspdf?.jsPDF) throw new Error('O gerador de PDF não foi carregado.');
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const pageWidth = 210;
      const margin = 12;
      const labelWidth = 43;
      const valueWidth = pageWidth - (margin * 2) - labelWidth;
      const navy = [5, 50, 105];
      const addHeader = (request, continuation = false) => {
        doc.setFillColor(...navy);
        doc.rect(0, 0, pageWidth, 24, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('TRANSPORTE HEURO — RELATÓRIO SELECIONADO', pageWidth / 2, 10, { align: 'center' });
        doc.setFontSize(9);
        doc.text(`${request.patient_name || 'Paciente'} · ${request.protocol || 'SEM PROTOCOLO'}${continuation ? ' · continuação' : ''}`, pageWidth / 2, 17, { align: 'center' });
        return 29;
      };
      for (let requestIndex = 0; requestIndex < selected.length; requestIndex += 1) {
        const request = selected[requestIndex];
        if (requestIndex) doc.addPage();
        let y = addHeader(request);
        pdfFieldRows(request).forEach(([label, value]) => {
          doc.setFontSize(8.4);
          doc.setFont('helvetica', 'normal');
          const lines = doc.splitTextToSize(String(value ?? '—'), valueWidth - 6);
          const rowHeight = Math.max(9, lines.length * 4.1 + 4);
          if (y + rowHeight > 284) {
            doc.addPage();
            y = addHeader(request, true);
          }
          doc.setFillColor(y % 2 ? 247 : 239, 244, 251);
          doc.setDrawColor(190, 207, 226);
          doc.rect(margin, y, labelWidth, rowHeight, 'FD');
          doc.setFillColor(255, 255, 255);
          doc.rect(margin + labelWidth, y, valueWidth, rowHeight, 'FD');
          doc.setTextColor(18, 61, 112);
          doc.setFont('helvetica', 'bold');
          doc.text(String(label), margin + 3, y + 5.6);
          doc.setTextColor(28, 48, 75);
          doc.setFont('helvetica', 'normal');
          doc.text(lines, margin + labelWidth + 3, y + 5.6);
          y += rowHeight;
        });
        await appendAttachments(doc, request, addHeader);
      }
      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setTextColor(90, 108, 132);
        doc.setFontSize(7.5);
        doc.text(`Gerado em ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Porto_Velho', dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`, margin, 293);
        doc.text(`Página ${page} de ${totalPages}`, 198, 293, { align: 'right' });
      }
      const fileName = `Transportes_HEURO_selecionados_${new Date().toISOString().slice(0, 10)}.pdf`;
      const file = new File([doc.output('blob')], fileName, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Transportes HEURO selecionados' });
      } else {
        doc.save(fileName);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') alert(error.message || 'Não foi possível gerar o PDF.');
    } finally {
      generatePdfButton.querySelector('.pdf-button-label').textContent = originalLabel;
      syncSelectionControls();
    }
  }

  function actionRequest(id, action, keepalive = false) {
    const request = getRequest(id);
    const report = stagedReports.get(String(id));
    const collectiveReport = action === 'complete' && request && isCollectiveFlow(request);
    if (collectiveReport && !report) return Promise.reject(new Error('O relatório obrigatório não foi preenchido.'));
    const path = action === 'accept'
      ? '/rest/v1/rpc/accept_transport_request'
      : collectiveReport ? '/rest/v1/rpc/submit_transport_report' : '/rest/v1/rpc/change_transport_execution_status';
    const body = action === 'accept'
      ? { p_request_id: id, p_vehicle_id: null, p_team_name: null }
      : collectiveReport
        ? { p_request_id: id, p_report_data: { ...report, narrative: undefined }, p_narrative: report.narrative || null }
        : { p_request_id: id, p_new_status: 'concluido', p_notes: null };
    return fetchJson(path, { method: 'POST', body: JSON.stringify(body), keepalive });
  }

  async function commitAll() {
    if (!staged.size || committing) return;
    committing = true;
    list.classList.add('is-saving');
    try {
      for (const [id, action] of [...staged.entries()]) {
        const request = getRequest(id);
        if (!request || (action === 'accept' && originalCategory(request) !== 'pending') || (action === 'complete' && originalCategory(request) === 'completed')) {
          staged.delete(id);
          continue;
        }
        if (action === 'complete' && originalCategory(request) === 'pending' && !ownParticipation(request)) {
          await actionRequest(id, 'accept');
        }
        await actionRequest(id, action);
        staged.delete(id);
        stagedReports.delete(id);
        saveStaged();
      }
      await load();
    } finally {
      committing = false;
      list.classList.remove('is-saving');
      saveStaged();
    }
  }

  async function leaveScreen(next) {
    if (committing) return;
    try {
      await commitAll();
      next();
    } catch (error) {
      alert(`Não foi possível salvar as alterações: ${error.message}. A tela permanecerá aberta para você tentar novamente.`);
      render();
    }
  }

  function flushInBackground() {
    if (!staged.size || backgroundSent || backgroundPromise) return backgroundPromise;
    backgroundSent = true;
    const snapshot = [...staged.entries()];
    backgroundPromise = Promise.allSettled(snapshot.map(([id, action]) => actionRequest(id, action, true)))
      .then((results) => {
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            staged.delete(snapshot[index][0]);
            stagedReports.delete(snapshot[index][0]);
          }
        });
        saveStaged();
        if (staged.size) backgroundSent = false;
      })
      .finally(() => { backgroundPromise = null; });
    return backgroundPromise;
  }

  readStaged();
  document.querySelectorAll('.status-card').forEach((button) => button.addEventListener('click', () => openCategory(button.dataset.tab, false)));
  document.addEventListener('heuro:navigate', (event) => {
    if (!event.detail?.navigate) return;
    event.preventDefault();
    leaveScreen(event.detail.navigate);
  });
  $('categoryBack').addEventListener('click', () => leaveScreen(showOverview));
  $('commandBack').addEventListener('click', (event) => {
    event.preventDefault();
    leaveScreen(() => location.assign(`./comando.html?v=20260807.88&fresh=${Date.now()}`));
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = norm(search.value);
    if (term.length < 2) { alert('Digite pelo menos duas letras do nome ou protocolo.'); search.focus(); return; }
    searchTerm = term;
    openCategory('pending', true);
  });
  generatePdfButton?.addEventListener('click', generateSelectedPdf);
  $('modalCancel').onclick = closeModal;
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushInBackground();
    else Promise.resolve(backgroundPromise).finally(() => load());
  });
  window.addEventListener('pagehide', flushInBackground);

  const requestedTab = new URLSearchParams(location.search).get('tab');
  if (['pending', 'active', 'completed'].includes(requestedTab)) openCategory(requestedTab, false);
  load();
  setInterval(() => { if (!document.hidden && !staged.size && !committing) load(); }, 45000);
})();
