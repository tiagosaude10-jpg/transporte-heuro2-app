(() => {
  'use strict';

  const SUPABASE_URL = 'https://hahozrotaaqaftamvwmm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_MLu7DsPF-xoVswv9Qeb1wg_7NDET0di';

  const list = document.getElementById('userList');
  const count = document.getElementById('userCount');
  const countLabel = document.getElementById('countLabel');
  const refreshButton = document.getElementById('refreshButton');
  const message = document.getElementById('adminMessage');
  const template = document.getElementById('userCardTemplate');
  const filterButtons = Array.from(document.querySelectorAll('[data-status]'));
  const confirmDialog = document.getElementById('confirmDialog');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmText = document.getElementById('confirmText');
  const confirmActionButton = document.getElementById('confirmActionButton');
  const deleteConfirmationLabel = document.getElementById('deleteConfirmationLabel');
  const deleteConfirmation = document.getElementById('deleteConfirmation');

  let activeStatus = 'pendente';
  let pendingConfirmation = null;

  const readSession = () => {
    try {
      return JSON.parse(localStorage.getItem('heuro_session') || 'null');
    } catch (_) {
      return null;
    }
  };

  const session = readSession();

  const showMessage = (text, success = false) => {
    if (!message) return;
    message.textContent = text;
    message.style.color = success ? '#0b6b35' : '#9b1c1c';
    message.style.display = 'block';
  };

  const headers = () => ({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  });

  const labelMap = {
    heuro: 'HEURO — Servidor/Colaborador',
    empresa: 'Empresa de Transporte',
    administracao: 'Administração Geral',
    solicitante: 'Solicitante',
    executante: 'Executante',
    administrador_geral: 'Administrador Geral',
    pendente: 'Pendente',
    aprovado: 'Aprovado',
    rejeitado: 'Rejeitado',
    bloqueado: 'Bloqueado',
    arquivado: 'Arquivado'
  };

  const formatCpf = (value = '') => value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const formatDate = (value) => value ? new Date(value).toLocaleString('pt-BR') : '—';

  const protectPage = () => {
    if (!session?.access_token || session.access !== 'administrador_geral') {
      window.location.replace('./login.html');
      return false;
    }
    return true;
  };

  const requestDecision = (config) => {
    pendingConfirmation = config;
    confirmTitle.textContent = config.title;
    confirmText.textContent = config.text;
    deleteConfirmationLabel.hidden = !config.requiresDeleteWord;
    deleteConfirmation.value = '';
    confirmActionButton.textContent = config.confirmLabel || 'Confirmar';
    confirmDialog.showModal();
  };

  confirmDialog?.addEventListener('close', async () => {
    if (confirmDialog.returnValue !== 'default' || !pendingConfirmation) {
      pendingConfirmation = null;
      return;
    }

    if (pendingConfirmation.requiresDeleteWord && deleteConfirmation.value.trim().toUpperCase() !== 'EXCLUIR') {
      showMessage('Para excluir definitivamente, digite a palavra EXCLUIR.');
      pendingConfirmation = null;
      return;
    }

    const action = pendingConfirmation;
    pendingConfirmation = null;
    await action.run();
  });

  const callDecisionRpc = async (userId, decision, grantedAccess, notes, card) => {
    const buttons = card.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_decide_user`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          target_user: userId,
          decision,
          granted_access: grantedAccess || null,
          decision_notes: notes || null
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || 'Não foi possível registrar a decisão.');

      showMessage(
        decision === 'aprovar' ? 'Cadastro aprovado com sucesso.' :
        decision === 'rejeitar' ? 'Cadastro rejeitado.' :
        'Cadastro bloqueado.',
        decision === 'aprovar'
      );
      await loadUsers();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Falha ao processar a decisão.');
      buttons.forEach((button) => { button.disabled = false; });
    }
  };

  const callManageRpc = async (userId, action, notes, card) => {
    const buttons = card.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_manage_user`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ target_user: userId, action, notes: notes || null })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || 'Não foi possível executar a ação.');

      const successMessages = {
        reativar: 'Usuário reativado com sucesso.',
        reenviar: 'Cadastro devolvido para nova análise.',
        arquivar: 'Cadastro arquivado.',
        excluir: 'Cadastro excluído definitivamente.'
      };
      showMessage(successMessages[action] || 'Ação concluída.', true);
      await loadUsers();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Falha ao executar a ação.');
      buttons.forEach((button) => { button.disabled = false; });
    }
  };

  const configureActions = (card, user) => {
    const status = user.status;
    card.querySelectorAll('.pending-control,.pending-action,.block-action,.reactivate-action,.resubmit-action,.archive-action,.delete-action')
      .forEach((element) => { element.hidden = true; });

    if (status === 'pendente') {
      card.querySelectorAll('.pending-control,.pending-action,.block-action,.archive-action,.delete-action')
        .forEach((element) => { element.hidden = false; });
    } else if (status === 'aprovado') {
      card.querySelectorAll('.block-action,.archive-action,.delete-action')
        .forEach((element) => { element.hidden = false; });
    } else if (status === 'rejeitado') {
      card.querySelectorAll('.resubmit-action,.archive-action,.delete-action')
        .forEach((element) => { element.hidden = false; });
    } else if (status === 'bloqueado') {
      card.querySelectorAll('.reactivate-action,.archive-action,.delete-action')
        .forEach((element) => { element.hidden = false; });
    } else if (status === 'arquivado') {
      card.querySelectorAll('.reactivate-action,.delete-action')
        .forEach((element) => { element.hidden = false; });
    }
  };

  const renderUsers = (users) => {
    if (!list || !template || !count) return;
    list.innerHTML = '';
    count.textContent = String(users.length);
    countLabel.textContent = activeStatus === 'todos' ? 'Cadastros' : labelMap[activeStatus] || 'Cadastros';

    if (users.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<strong>Nenhum cadastro encontrado.</strong><p>Altere o filtro ou aguarde novas solicitações.</p>';
      list.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.status = user.status;
      card.querySelector('.avatar').textContent = (user.display_name || user.full_name || 'U').trim().charAt(0).toUpperCase();
      card.querySelector('.user-name').textContent = user.full_name || user.display_name || 'Usuário';
      card.querySelector('.user-email').textContent = user.email || '';
      const badge = card.querySelector('.status-badge');
      badge.textContent = labelMap[user.status] || user.status || '—';
      badge.dataset.status = user.status;
      card.querySelector('[data-field="institutional_link"]').textContent = labelMap[user.institutional_link] || user.institutional_link || '—';
      card.querySelector('[data-field="organization"]').textContent = user.heuro_sector || user.transport_company || '—';
      card.querySelector('[data-field="job_role"]').textContent = user.job_role || '—';
      card.querySelector('[data-field="requested_access"]').textContent = labelMap[user.requested_access] || user.requested_access || '—';
      card.querySelector('[data-field="authorized_access"]').textContent = labelMap[user.authorized_access] || user.authorized_access || '—';
      card.querySelector('[data-field="cpf"]').textContent = formatCpf(user.cpf || '') || '—';
      card.querySelector('[data-field="phone"]').textContent = user.phone || '—';
      card.querySelector('[data-field="created_at"]').textContent = formatDate(user.created_at);

      const accessSelect = card.querySelector('.access-select');
      if (user.requested_access === 'executante') accessSelect.value = 'executante';
      const notes = card.querySelector('.decision-notes');

      card.querySelector('.approve-button').addEventListener('click', () =>
        requestDecision({
          title: 'Aprovar cadastro',
          text: `Aprovar ${user.full_name || user.email} como ${labelMap[accessSelect.value]}?`,
          confirmLabel: 'Aprovar',
          run: () => callDecisionRpc(user.id, 'aprovar', accessSelect.value, notes.value.trim(), card)
        })
      );
      card.querySelector('.reject-button').addEventListener('click', () =>
        requestDecision({
          title: 'Rejeitar cadastro',
          text: `Rejeitar o cadastro de ${user.full_name || user.email}?`,
          confirmLabel: 'Rejeitar',
          run: () => callDecisionRpc(user.id, 'rejeitar', null, notes.value.trim(), card)
        })
      );
      card.querySelector('.block-button').addEventListener('click', () =>
        requestDecision({
          title: 'Bloquear usuário',
          text: `Bloquear o acesso de ${user.full_name || user.email}? O histórico será preservado.`,
          confirmLabel: 'Bloquear',
          run: () => callDecisionRpc(user.id, 'bloquear', null, notes.value.trim(), card)
        })
      );
      card.querySelector('.reactivate-button').addEventListener('click', () =>
        requestDecision({
          title: 'Reativar usuário',
          text: `Reativar o acesso de ${user.full_name || user.email}?`,
          confirmLabel: 'Reativar',
          run: () => callManageRpc(user.id, 'reativar', notes.value.trim(), card)
        })
      );
      card.querySelector('.resubmit-button').addEventListener('click', () =>
        requestDecision({
          title: 'Reenviar para análise',
          text: `Retornar o cadastro de ${user.full_name || user.email} para o status pendente?`,
          confirmLabel: 'Reenviar',
          run: () => callManageRpc(user.id, 'reenviar', notes.value.trim(), card)
        })
      );
      card.querySelector('.archive-button').addEventListener('click', () =>
        requestDecision({
          title: 'Arquivar cadastro',
          text: `Arquivar ${user.full_name || user.email}? O acesso será encerrado e o histórico será mantido.`,
          confirmLabel: 'Arquivar',
          run: () => callManageRpc(user.id, 'arquivar', notes.value.trim(), card)
        })
      );
      card.querySelector('.delete-button').addEventListener('click', () =>
        requestDecision({
          title: 'Excluir definitivamente',
          text: `Excluir definitivamente ${user.full_name || user.email}? Esta ação não poderá ser desfeita.`,
          confirmLabel: 'Excluir definitivamente',
          requiresDeleteWord: true,
          run: () => callManageRpc(user.id, 'excluir', notes.value.trim(), card)
        })
      );

      configureActions(card, user);
      list.appendChild(card);
    });
  };

  async function loadUsers() {
    if (!protectPage()) return;
    if (message) message.style.display = 'none';
    if (refreshButton) refreshButton.disabled = true;

    try {
      const select = [
        'id','full_name','display_name','email','cpf','phone','institutional_link',
        'heuro_sector','transport_company','job_role','requested_access','authorized_access',
        'status','created_at'
      ].join(',');
      const filter = activeStatus === 'todos' ? '' : `status=eq.${activeStatus}&`;
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?${filter}id=neq.${encodeURIComponent(session.user_id)}&select=${select}&order=created_at.desc`,
        { headers: headers() }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Não foi possível carregar os cadastros.');
      renderUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Erro ao carregar os cadastros.');
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeStatus = button.dataset.status;
      filterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
      loadUsers();
    });
  });

  refreshButton?.addEventListener('click', loadUsers);
  loadUsers();
})();
