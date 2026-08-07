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
  const TERMINAL = new Set(['concluido', 'cancelado', 'recusado']);
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
    consulta: 'Consulta'
  };
  const tabMeta = {
    pending: { counter: 'Pendentes' },
    active: { counter: 'Aceitos' },
    completed: { counter: 'Concluídos' }
  };

  let requests = [];
  let activeTab = 'pending';
  let selectedRequest = null;
  let searchMode = false;
  let searchTerm = '';
  let focusedRequestId = null;
  let committing = false;
  let backgroundPromise = null;
  let backgroundSent = false;
  const staged = new Map();
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
  const originalCategory = (request) => {
    const execution = executionOf(request);
    const status = norm(execution?.status || request.status);
    if (TERMINAL.has(status)) return 'completed';
    if (execution) return 'active';
    return 'pending';
  };
  const effectiveCategory = (request) => {
    const action = staged.get(String(request.id));
    if (action === 'accept') return 'active';
    if (action === 'complete') return 'completed';
    return originalCategory(request);
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
  }

  function saveStaged() {
    if (staged.size) localStorage.setItem(STAGED_KEY, JSON.stringify([...staged.entries()]));
    else localStorage.removeItem(STAGED_KEY);
  }

  function reconcileStaged() {
    for (const [id, action] of staged) {
      const request = requests.find((item) => String(item.id) === String(id));
      if (!request || (action === 'accept' && originalCategory(request) !== 'pending') ||
          (action === 'complete' && originalCategory(request) === 'completed')) staged.delete(id);
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
      const data = await fetchJson('/rest/v1/transport_requests?select=id,protocol,status,patient_name,birth_date,origin_sector,origin_location,destination,support_type,priority,priority_rank,transport_date,destination_time,transfer_reason,oxygen_required,oxygen_details,observations,attachment_paths,requester_name,created_at,updated_at,transport_executions(*)&order=created_at.desc');
      requests = Array.isArray(data) ? data : [];
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
    saveStaged();
    render();
  }

  const tableHead = () => `<thead><tr>
    <th class="cell-select"><input class="row-selector select-all-visible" type="checkbox" aria-label="Selecionar todos os transportes visíveis"></th>
    <th>Paciente</th><th>Protocolo</th><th>Nascimento</th><th>Origem</th><th>Destino</th>
    <th>Data do destino</th><th>Horário do destino</th><th>Ambulância</th><th>Prioridade</th>
    <th>Motivo</th><th>Oxigênio</th><th>Solicitante</th><th>Executante</th><th>Viatura</th>
    <th>Solicitado em</th><th>Aceito em</th><th>Concluído em</th><th>Documentos</th>
    <th>Observações</th><th>Status</th><th>Ações</th>
  </tr></thead>`;

  function lifecycleButton(request, mode) {
    if (mode === 'pending') return `<button class="lifecycle-action accept compact" data-stage-accept="${esc(request.id)}" type="button">Aceitar</button>`;
    if (mode === 'provisional-accept') return `<button class="lifecycle-action undo compact" data-undo="${esc(request.id)}" type="button">Desaceitar</button>`;
    if (mode === 'active') return `<button class="lifecycle-action conclude compact" data-stage-complete="${esc(request.id)}" type="button">Concluir</button>`;
    if (mode === 'provisional-complete') return `<button class="lifecycle-action undo compact" data-undo="${esc(request.id)}" type="button">Desconcluir</button>`;
    return '';
  }

  function tableActionButtons(request, mode) {
    const conclude = `<button class="lifecycle-action conclude compact" data-stage-complete="${esc(request.id)}" type="button">Concluir</button>`;
    if (mode === 'pending' || mode === 'provisional-accept') return conclude + lifecycleButton(request, mode);
    return lifecycleButton(request, mode);
  }

  function tableRow(request, mode) {
    const execution = executionOf(request);
    const provisional = mode.startsWith('provisional');
    const visualStatus = mode === 'provisional-accept' ? 'Aceite selecionado' : mode === 'provisional-complete' ? 'Conclusão selecionada' : labels[norm(execution?.status || request.status)] || execution?.status || request.status || 'Pendente';
    const statusClass = mode === 'pending' ? 'waiting' : mode === 'active' || mode === 'provisional-accept' ? 'accepted' : 'completed';
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
      <td class="cell-wide">${esc(execution?.responsible_name || 'Não definido')}</td>
      <td>${esc(execution?.vehicle_code || 'Não definida')}</td>
      <td>${dateTime(request.created_at)}</td>
      <td>${dateTime(execution?.accepted_at)}</td>
      <td>${dateTime(execution?.completed_at)}</td>
      <td>${esc(attachmentText(request))}</td>
      <td class="cell-notes">${esc(request.observations || 'Sem observações')}</td>
      <td><span class="table-status ${statusClass}">${esc(visualStatus)}</span></td>
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
    const conclusions = requests.filter((request) => originalCategory(request) === 'pending' && staged.get(String(request.id)) === 'complete' && matches(request, term)).sort((a, b) => priority(a) - priority(b) || stamp(a) - stamp(b));
    const acceptances = requests.filter((request) => originalCategory(request) === 'pending' && staged.get(String(request.id)) === 'accept' && matches(request, term)).sort((a, b) => priority(a) - priority(b) || stamp(a) - stamp(b));
    const waiting = requests.filter((request) => originalCategory(request) === 'pending' && !staged.has(String(request.id)) && (!focusedRequestId || String(request.id) === String(focusedRequestId)) && matches(request, term)).sort((a, b) => priority(a) - priority(b) || stamp(a) - stamp(b));
    list.innerHTML = `${tableSection(conclusions, 'provisional-complete', 'Conclusões selecionadas')}${tableSection(acceptances, 'provisional-accept', 'Aceites selecionados')}${tableSection(waiting, 'pending')}` || '<div class="empty">Nenhum transporte pendente.</div>';
    bindActions();
  }

  function renderActive(term = '') {
    const chosen = requests.filter((request) => staged.get(String(request.id)) === 'complete' && matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    const active = requests.filter((request) => originalCategory(request) === 'active' && !staged.has(String(request.id)) && (!focusedRequestId || String(request.id) === String(focusedRequestId)) && matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    list.innerHTML = `${tableSection(chosen, 'provisional-complete', 'Conclusões selecionadas')}${tableSection(active, 'active')}` || '<div class="empty">Nenhum transporte aceito.</div>';
    bindActions();
  }

  function renderCompleted(term = '') {
    const completed = requests.filter((request) => originalCategory(request) === 'completed' && (!focusedRequestId || String(request.id) === String(focusedRequestId)) && matches(request, term)).sort((a, b) => stamp(b) - stamp(a));
    list.innerHTML = tableSection(completed, 'completed') || '<div class="empty">Nenhum transporte concluído.</div>';
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
    return `<article class="search-result search-result-${category}"><div class="search-result-head"><div><h2>${esc(request.patient_name)}</h2><div class="protocol">${esc(request.protocol || 'SEM PROTOCOLO')}</div></div><span class="search-result-status">${esc(meta.label)}</span></div><div class="search-result-route"><b>${esc(originText(request))}</b> → <b>${esc(request.destination)}</b></div><div class="search-result-meta"><span><b>Status atual:</b> ${esc(labels[status] || status)}</span><span><b>Solicitado:</b> ${dateTime(request.created_at)}</span><span><b>Aceito:</b> ${dateTime(execution?.accepted_at)}</span><span><b>Concluído:</b> ${dateTime(execution?.completed_at)}</span></div><div class="search-result-actions"><button class="details" data-details="${esc(request.id)}" type="button">Detalhes</button><button class="open-category-button" data-open-tab="${category}" data-open-id="${esc(request.id)}" type="button">${esc(meta.button)}</button></div></article>`;
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

  function bindActions() {
    list.querySelectorAll('[data-details]').forEach((button) => { button.onclick = () => openDetails(button.dataset.details); });
    list.querySelectorAll('[data-stage-accept]').forEach((button) => { button.onclick = () => stageAction(button.dataset.stageAccept, 'accept'); });
    list.querySelectorAll('[data-stage-complete]').forEach((button) => { button.onclick = () => stageAction(button.dataset.stageComplete, 'complete'); });
    list.querySelectorAll('[data-undo]').forEach((button) => { button.onclick = () => undoAction(button.dataset.undo); });
    list.querySelectorAll('[data-open-tab]').forEach((button) => { button.onclick = () => openCategory(button.dataset.openTab, false, button.dataset.openId); });
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
  function closeModal() { modal.classList.remove('show'); selectedRequest = null; confirmButton.classList.remove('hidden'); }

  async function openDetails(id) {
    selectedRequest = getRequest(id);
    if (!selectedRequest) return;
    const request = selectedRequest;
    const execution = executionOf(request);
    modalTitle.textContent = request.patient_name;
    modalSubtitle.textContent = request.protocol || '';
    modalContent.innerHTML = `<div class="sheet-grid">
      <div class="field"><label>Status</label><div>${esc(labels[norm(execution?.status || request.status)] || execution?.status || request.status)}</div></div>
      <div class="field"><label>Prioridade</label><div>${esc(labels[request.priority] || request.priority)}</div></div>
      <div class="field"><label>Nascimento</label><div>${date(request.birth_date)}</div></div>
      <div class="field"><label>Origem</label><div>${esc(originText(request))}</div></div>
      <div class="field"><label>Destino</label><div>${esc(request.destination)}</div></div>
      <div class="field"><label>Data e hora no destino</label><div>${date(request.transport_date)} às ${time(request.destination_time)}</div></div>
      <div class="field"><label>Ambulância</label><div>${esc(labels[request.support_type] || request.support_type)}</div></div>
      <div class="field"><label>Motivo</label><div>${esc(labels[request.transfer_reason] || request.transfer_reason)}</div></div>
      <div class="field"><label>Oxigênio</label><div>${esc(oxygenText(request))}</div></div>
      <div class="field"><label>Solicitante</label><div>${esc(request.requester_name || 'Não informado')}</div></div>
      <div class="field"><label>Solicitado em</label><div>${dateTime(request.created_at)}</div></div>
      <div class="field"><label>Aceito em</label><div>${dateTime(execution?.accepted_at)}</div></div>
      <div class="field"><label>Concluído em</label><div>${dateTime(execution?.completed_at)}</div></div>
      <div class="field"><label>Documentos</label><div>${esc(attachmentText(request))}</div></div>
      <div class="field full"><label>Observações</label><div>${esc(request.observations || 'Sem observações')}</div></div>
    </div>`;
    confirmButton.classList.add('hidden');
    showModal();
  }

  const pdfFieldRows = (request) => {
    const execution = executionOf(request);
    const action = staged.get(String(request.id));
    const status = action === 'accept' ? 'Aceite selecionado — será gravado ao sair'
      : action === 'complete' ? 'Conclusão selecionada — será gravada ao sair'
      : labels[norm(execution?.status || request.status)] || execution?.status || request.status || 'Pendente';
    const acceptedAt = execution?.accepted_at || (action === 'accept' || action === 'complete' ? 'Será registrado ao sair da tela' : null);
    const completedAt = execution?.completed_at || (action === 'complete' ? 'Será registrado ao sair da tela' : null);
    return [
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
      ['Viatura', execution?.vehicle_code || 'Não definida'],
      ['Solicitado em', dateTime(request.created_at)],
      ['Aceito em', acceptedAt === 'Será registrado ao sair da tela' ? acceptedAt : dateTime(acceptedAt)],
      ['Concluído em', completedAt === 'Será registrado ao sair da tela' ? completedAt : dateTime(completedAt)],
      ['Documentos', attachmentText(request)],
      ['Observações', request.observations || 'Sem observações'],
      ['Status', status]
    ];
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
      selected.forEach((request, requestIndex) => {
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
      });
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
    const path = action === 'accept' ? '/rest/v1/rpc/accept_transport_request' : '/rest/v1/rpc/change_transport_execution_status';
    const body = action === 'accept'
      ? { p_request_id: id, p_vehicle_id: null, p_team_name: null }
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
        if (action === 'complete' && originalCategory(request) === 'pending') {
          await actionRequest(id, 'accept');
        }
        await actionRequest(id, action);
        staged.delete(id);
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
        results.forEach((result, index) => { if (result.status === 'fulfilled') staged.delete(snapshot[index][0]); });
        saveStaged();
        if (staged.size) backgroundSent = false;
      })
      .finally(() => { backgroundPromise = null; });
    return backgroundPromise;
  }

  readStaged();
  document.querySelectorAll('.status-card').forEach((button) => button.addEventListener('click', () => openCategory(button.dataset.tab, false)));
  $('categoryBack').addEventListener('click', () => leaveScreen(showOverview));
  $('commandBack').addEventListener('click', (event) => {
    event.preventDefault();
    leaveScreen(() => location.assign(`./comando.html?v=20260807.79&fresh=${Date.now()}`));
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

  load();
  setInterval(() => { if (!document.hidden && !staged.size && !committing) load(); }, 45000);
})();
