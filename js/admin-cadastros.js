(() => {
  'use strict';

  const SUPABASE_URL = 'https://hahozrotaaqaftamvwmm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_MLu7DsPF-xoVswv9Qeb1wg_7NDET0di';

  const list = document.getElementById('pendingList');
  const count = document.getElementById('pendingCount');
  const refreshButton = document.getElementById('refreshButton');
  const message = document.getElementById('adminMessage');
  const template = document.getElementById('userCardTemplate');

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
    administrador_geral: 'Administrador Geral'
  };

  const formatCpf = (value = '') => value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

  const protectPage = () => {
    if (!session?.access_token || session.access !== 'administrador_geral') {
      window.location.replace('./login.html');
      return false;
    }
    return true;
  };

  const decide = async (userId, decision, grantedAccess, notes, card) => {
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
      if (!response.ok) {
        throw new Error(data?.message || data?.error || 'Não foi possível registrar a decisão.');
      }

      showMessage(
        decision === 'aprovar' ? 'Cadastro aprovado com sucesso.' :
        decision === 'rejeitar' ? 'Cadastro rejeitado.' :
        'Cadastro bloqueado.',
        decision === 'aprovar'
      );
      await loadPendingUsers();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Falha ao processar a decisão.');
      buttons.forEach((button) => { button.disabled = false; });
    }
  };

  const renderUsers = (users) => {
    if (!list || !template || !count) return;
    list.innerHTML = '';
    count.textContent = String(users.length);

    if (users.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<strong>Nenhum cadastro pendente.</strong><p>Novas solicitações aparecerão aqui automaticamente.</p>';
      list.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.querySelector('.avatar').textContent = (user.display_name || user.full_name || 'U').trim().charAt(0).toUpperCase();
      card.querySelector('.user-name').textContent = user.full_name || user.display_name || 'Usuário';
      card.querySelector('.user-email').textContent = user.email || '';
      card.querySelector('[data-field="institutional_link"]').textContent = labelMap[user.institutional_link] || user.institutional_link || '—';
      card.querySelector('[data-field="organization"]').textContent = user.heuro_sector || user.transport_company || '—';
      card.querySelector('[data-field="job_role"]').textContent = user.job_role || '—';
      card.querySelector('[data-field="requested_access"]').textContent = labelMap[user.requested_access] || user.requested_access || '—';
      card.querySelector('[data-field="cpf"]').textContent = formatCpf(user.cpf || '') || '—';
      card.querySelector('[data-field="phone"]').textContent = user.phone || '—';

      const accessSelect = card.querySelector('.access-select');
      if (user.requested_access === 'executante') accessSelect.value = 'executante';

      const notes = card.querySelector('.decision-notes');
      card.querySelector('.approve-button').addEventListener('click', () =>
        decide(user.id, 'aprovar', accessSelect.value, notes.value.trim(), card)
      );
      card.querySelector('.reject-button').addEventListener('click', () =>
        decide(user.id, 'rejeitar', null, notes.value.trim(), card)
      );
      card.querySelector('.block-button').addEventListener('click', () =>
        decide(user.id, 'bloquear', null, notes.value.trim(), card)
      );

      list.appendChild(card);
    });
  };

  async function loadPendingUsers() {
    if (!protectPage()) return;
    if (message) message.style.display = 'none';
    if (refreshButton) refreshButton.disabled = true;

    try {
      const select = [
        'id','full_name','display_name','email','cpf','phone','institutional_link',
        'heuro_sector','transport_company','job_role','requested_access','created_at'
      ].join(',');
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?status=eq.pendente&select=${select}&order=created_at.asc`,
        { headers: headers() }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Não foi possível carregar os cadastros.');
      }
      renderUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Erro ao carregar os cadastros.');
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  refreshButton?.addEventListener('click', loadPendingUsers);
  loadPendingUsers();
})();
