(() => {
  'use strict';

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem('heuro_session') || 'null');
  } catch (_) {
    session = null;
  }

  if (!session?.access_token) {
    window.location.replace('./login.html');
    return;
  }

  const permissionDialog = document.getElementById('permissionDialog');
  const permissionClose = document.getElementById('permissionClose');
  const permissionMessage = document.getElementById('permissionMessage');
  const adminLink = document.getElementById('adminPanelLink');

  const showDenied = () => {
    if (permissionMessage) {
      permissionMessage.textContent =
        'Você não possui permissão para acessar esta função. Esta opção exige perfil Administrador Geral.';
    }
    if (permissionDialog) permissionDialog.hidden = false;
  };

  permissionClose?.addEventListener('click', () => {
    if (permissionDialog) permissionDialog.hidden = true;
  });

  permissionDialog?.addEventListener('click', (event) => {
    if (event.target === permissionDialog) permissionDialog.hidden = true;
  });

  adminLink?.addEventListener('click', (event) => {
    const isAdministrator =
      session.status === 'aprovado' &&
      session.access === 'administrador_geral';

    adminLink.classList.add('is-pressed');
    window.setTimeout(() => adminLink.classList.remove('is-pressed'), 120);

    if (!isAdministrator) {
      event.preventDefault();
      showDenied();
    }
    // Para o Administrador Geral, o link segue nativamente para admin-cadastros.html.
  });
})();
