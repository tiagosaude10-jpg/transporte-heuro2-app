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
    let session = app.readSession();

    if (!session?.access_token || !session?.user_id) {
      window.location.replace('./login.html');
      return;
    }

    const invalidateSession = (reason = 'sessao_invalida') => {
      app.clearSession();
      window.location.replace(`./login.html?motivo=${encodeURIComponent(reason)}`);
    };

    try {
      const response = await fetch(
        app.apiUrl(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=id,display_name,status,authorized_access`),
        { headers: app.authenticatedHeaders(session.access_token) }
      );
      const profiles = await response.json().catch(() => []);

      if (!response.ok || !Array.isArray(profiles) || profiles.length === 0) {
        invalidateSession('cadastro_indisponivel');
        return;
      }

      const profile = profiles[0];
      if (profile.status !== 'aprovado' || !profile.authorized_access) {
        invalidateSession(profile.status === 'bloqueado' ? 'acesso_bloqueado' : 'acesso_nao_autorizado');
        return;
      }

      session = {
        ...session,
        display_name: profile.display_name || session.display_name || '',
        access: profile.authorized_access,
        status: profile.status
      };
      app.saveSession(session);
    } catch (_) {
      invalidateSession('falha_validacao');
      return;
    }

    const commandUserName = document.getElementById('commandUserName');
    const displayName = String(session.display_name || '').trim();
    if (commandUserName) {
      commandUserName.textContent = displayName ? `Olá, ${displayName}!` : 'Olá!';
      commandUserName.title = displayName;
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

      fetch(app.apiUrl('/auth/v1/logout'), {
        method: 'POST',
        keepalive: true,
        headers: app.authenticatedHeaders(token)
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
