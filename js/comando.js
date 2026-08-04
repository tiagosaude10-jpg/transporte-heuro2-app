(() => {
  'use strict';

  const SUPABASE_URL = 'https://hahozrotaaqaftamvwmm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_MLu7DsPF-xoVswv9Qeb1wg_7NDET0di';

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem('heuro_session') || 'null');
  } catch (_) {
    session = null;
  }

  if (!session?.access_token || !session?.user_id) {
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

  const saveSession = () => {
    localStorage.setItem('heuro_session', JSON.stringify(session));
  };

  const refreshProfile = async () => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=status,authorized_access,display_name`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${session.access_token}`,
            Accept: 'application/json'
          }
        }
      );

      const profiles = await response.json();
      if (!response.ok || !Array.isArray(profiles) || profiles.length === 0) return;

      const profile = profiles[0];
      session.status = profile.status || session.status || '';
      session.access = profile.authorized_access || session.access || '';
      session.display_name = profile.display_name || session.display_name || '';
      saveSession();
    } catch (_) {
      // Mantém a sessão existente se a consulta momentaneamente falhar.
    }
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

  const activateHotspots = () => {
    hotspots.forEach((hotspot) => {
      hotspot.addEventListener('click', (event) => {
        event.preventDefault();

        const requiredAccess = hotspot.dataset.requiredAccess || '';
        const isAdministrator = session.access === 'administrador_geral';
        const hasPermission =
          session.status === 'aprovado' &&
          (isAdministrator || !requiredAccess || session.access === requiredAccess);

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
  };

  refreshProfile().finally(activateHotspots);
})();
