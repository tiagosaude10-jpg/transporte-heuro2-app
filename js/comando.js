(() => {
  'use strict';

  const loadConfig = () => new Promise((resolve, reject) => {
    if (window.HEURO) {
      resolve(window.HEURO);
      return;
    }
    const script = document.createElement('script');
    script.src = 'js/config.js';
    script.onload = () => window.HEURO ? resolve(window.HEURO) : reject(new Error('Configuração não carregada.'));
    script.onerror = () => reject(new Error('Falha ao carregar a configuração.'));
    document.head.appendChild(script);
  });

  const start = async () => {
    const app = await loadConfig();
    const session = app.readSession();

    if (!session?.access_token) {
      window.location.replace('./login.html');
      return;
    }

    const permissionDialog = document.getElementById('permissionDialog');
    const permissionClose = document.getElementById('permissionClose');
    const permissionMessage = document.getElementById('permissionMessage');
    const adminLink = document.getElementById('adminPanelLink');
    const logoutButton = document.getElementById('logoutButton');
    let loggingOut = false;

    const showDenied = () => {
      if (permissionMessage) {
        permissionMessage.textContent = 'Você não possui permissão para acessar esta função. Esta opção exige perfil Administrador Geral.';
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
      adminLink.classList.add('is-pressed');
      window.setTimeout(() => adminLink.classList.remove('is-pressed'), 120);

      const isAdministrator = session.status === 'aprovado' && session.access === 'administrador_geral';
      if (!isAdministrator) {
        event.preventDefault();
        showDenied();
      }
    });

    const logout = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (loggingOut) return;

      loggingOut = true;
      logoutButton?.classList.add('is-pressed');
      const token = session.access_token;
      app.clearSession();

      fetch(`${app.SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: app.SUPABASE_KEY,
          Authorization: `Bearer ${token}`
        }
      }).catch(() => {});

      window.location.replace('./login.html?logout=1');
    };

    ['click', 'pointerup', 'touchend'].forEach((type) => {
      logoutButton?.addEventListener(type, logout, { passive: false });
    });

    app.clearLegacyCaches().catch(() => {});
  };

  start().catch((error) => {
    console.error(error);
    window.location.replace('./login.html');
  });
})();
