(() => {
  'use strict';

  const app = window.HEURO;
  const session = app?.readSession?.();
  if (!app || !session?.access_token) return;

  const input = document.getElementById('globalSearchInput');
  const clearButton = document.getElementById('globalSearchClear');
  const results = document.getElementById('globalSearchResults');
  const pendingCount = document.getElementById('menuPendingCount');
  const activeCount = document.getElementById('menuActiveCount');
  const completedCount = document.getElementById('menuCompletedCount');
  const totalCount = document.getElementById('menuTotalCount');
  const workspaceSearch = document.getElementById('searchInput');

  if (!input || !results) return;

  let requests = [];
  const terminal = new Set(['concluido', 'cancelado', 'recusado']);
  const normalize = (value) => String(value || '').trim().toLowerCase();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const executionOf = (request) => Array.isArray(request.transport_executions)
    ? request.transport_executions[0]
    : request.transport_executions;
  const categoryOf = (request) => {
    const execution = executionOf(request);
    const status = normalize(execution?.status || request.status);
    if (status === 'concluido') return 'completed';
    if (execution && !terminal.has(status)) return 'active';
    return 'pending';
  };
  const categoryLabel = {
    pending: 'Pendente',
    active: 'Aceito',
    completed: 'Concluído'
  };

  const updateCounts = () => {
    const pending = requests.filter((request) => categoryOf(request) === 'pending').length;
    const active = requests.filter((request) => categoryOf(request) === 'active').length;
    const completed = requests.filter((request) => categoryOf(request) === 'completed').length;
    if (pendingCount) pendingCount.textContent = pending;
    if (activeCount) activeCount.textContent = active;
    if (completedCount) completedCount.textContent = completed;
    if (totalCount) totalCount.textContent = requests.length;
  };

  const renderResults = () => {
    const term = normalize(input.value);
    if (term.length < 2) {
      results.hidden = true;
      results.innerHTML = '';
      return;
    }

    const matches = requests.filter((request) => normalize([
      request.patient_name,
      request.protocol,
      request.destination,
      request.origin_sector,
      request.requester_name
    ].join(' ')).includes(term)).slice(0, 20);

    results.hidden = false;
    if (!matches.length) {
      results.innerHTML = '<div class="global-results-empty">Nenhum transporte encontrado.</div>';
      return;
    }

    results.innerHTML = matches.map((request) => {
      const category = categoryOf(request);
      return `<button class="global-result" type="button" data-global-request="${escapeHtml(request.id)}" data-global-category="${category}">
        <span class="global-result__top">
          <span class="global-result__name">${escapeHtml(request.patient_name || 'Paciente não informado')}</span>
          <span class="global-result__status ${category}">${categoryLabel[category]}</span>
        </span>
        <span class="global-result__meta">${escapeHtml(request.protocol || 'Sem protocolo')} · ${escapeHtml(request.origin_sector || '')} → ${escapeHtml(request.destination || '')}</span>
      </button>`;
    }).join('');

    results.querySelectorAll('[data-global-request]').forEach((button) => {
      button.addEventListener('click', () => {
        const request = requests.find((item) => item.id === button.dataset.globalRequest);
        const category = button.dataset.globalCategory || 'pending';
        window.dispatchEvent(new CustomEvent('open-team-workspace', { detail: { tab: category } }));
        window.setTimeout(() => {
          if (workspaceSearch && request) {
            workspaceSearch.value = request.patient_name || request.protocol || '';
            workspaceSearch.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 50);
      });
    });
  };

  const load = async () => {
    try {
      const response = await fetch(app.apiUrl('/rest/v1/transport_requests?select=id,protocol,status,patient_name,origin_sector,destination,requester_name,transport_executions(status)&order=created_at.desc'), {
        headers: app.authenticatedHeaders(session.access_token)
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error('Falha ao carregar transportes.');
      requests = Array.isArray(data) ? data : [];
      updateCounts();
      renderResults();
    } catch (_) {
      results.hidden = false;
      results.innerHTML = '<div class="global-results-empty">Não foi possível carregar a pesquisa agora.</div>';
    }
  };

  input.addEventListener('input', renderResults);
  clearButton?.addEventListener('click', () => {
    input.value = '';
    input.focus();
    renderResults();
  });

  load();
  window.setInterval(() => {
    if (!document.hidden) load();
  }, 45000);
})();