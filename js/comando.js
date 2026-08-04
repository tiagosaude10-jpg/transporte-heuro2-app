(() => {
  'use strict';

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem('heuro_session') || 'null');
  } catch (_) {
    session = null;
  }

  if (!session?.access_token || !session?.access) {
    window.location.replace('./login.html');
    return;
  }

  const permissionDialog = document.getElementById('permissionDialog');
  const permissionClose = document.getElementById('permissionClose');
  const permissionMessage = document.getElementById('permissionMessage');
  const hotspots = Array.from(document.querySelectorAll('.command-hotspot'));

  const accessLabels = {
    solicitante: 'Solicitante',
    executante: 'Executante',
    administrador_geral: 'Administrador Geral'
  };

  const showPermissionDenied = (requiredAccess) => {
    if (permissionMessage) {
      const label = accessLabels[requiredAccess] || 'autorizado';
      permissionMessage.textContent =
        `Você não possui permissão para acessar esta função. Esta opção exige perfil ${label}.`;
    }
    if (permissionDialog) permissionDialog.hidden = false;
    permissionClose?.focus();
  };

  const closePermissionDialog = () => {
    if (permissionDialog) permissionDialog.hidden = true;
  };

  permissionClose?.addEventListener('click', closePermissionDialog);
  permissionDialog?.addEventListener('click', (event) => {
    if (event.target === permissionDialog) closePermissionDialog();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePermissionDialog();
  });

  hotspots.forEach((hotspot) => {
    hotspot.addEventListener('click', (event) => {
      event.preventDefault();

      const requiredAccess = hotspot.dataset.requiredAccess || '';
      const isAdministrator = session.access === 'administrador_geral';
      const hasPermission =
        isAdministrator || !requiredAccess || session.access === requiredAccess;

      hotspot.classList.add('is-pressed');
      window.setTimeout(() => hotspot.classList.remove('is-pressed'), 140);

      if (!hasPermission) {
        showPermissionDenied(requiredAccess);
        return;
      }

      const destination = hotspot.getAttribute('href');
      if (destination) {
        window.setTimeout(() => window.location.assign(destination), 140);
      }
    });
  });
})();
