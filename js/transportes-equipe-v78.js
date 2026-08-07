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
    categoryPanel.hidden = true;
    overview.hidden = false;
    search.value = '';
    updateCounts();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  function openCategory(tab, fromSearch = false, focusId = null) {
    activeTab = tab;
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
    if (mode === 'provisional-complete') return `<button class="lifecycle-action undo compact" data-undo="${esc(request.id)}" type="button">Desfazer</button>`;
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
    return `<tr data-row-id="${esc(request.id)}" class="${provisional ? 'provisional-row' : ''}">
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

  function bindActions() {
    list.querySelectorAll('[data-details]').forEach((button) => { button.onclick = () => openDetails(button.dataset.details); });
    list.querySelectorAll('[data-stage-accept]').forEach((button) => { button.onclick = () => stageAction(button.dataset.stageAccept, 'accept'); });
    list.querySelectorAll('[data-stage-complete]').forEach((button) => { button.onclick = () => stageAction(button.dataset.stageComplete, 'complete'); });
    list.querySelectorAll('[data-undo]').forEach((button) => { button.onclick = () => undoAction(button.dataset.undo); });
    list.querySelectorAll('[data-open-tab]').forEach((button) => { button.onclick = () => openCategory(button.dataset.openTab, false, button.dataset.openId); });
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
    leaveScreen(() => location.assign(`./comando.html?v=20260807.78&fresh=${Date.now()}`));
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = norm(search.value);
    if (term.length < 2) { alert('Digite pelo menos duas letras do nome ou protocolo.'); search.focus(); return; }
    searchTerm = term;
    openCategory('pending', true);
  });
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
