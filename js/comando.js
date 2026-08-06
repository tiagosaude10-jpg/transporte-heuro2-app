(() => {
  'use strict';

  const IMAGE_WIDTH = 768;
  const IMAGE_HEIGHT = 1664;
  const IMAGE_RATIO = IMAGE_WIDTH / IMAGE_HEIGHT;

  const fitCommandStage = () => {
    const stage = document.getElementById('commandStage');
    const screen = document.getElementById('commandScreen');
    if (!stage || !screen) return;
    const viewport = window.visualViewport;
    const availableWidth = Math.max(1, Math.floor(viewport?.width || window.innerWidth || document.documentElement.clientWidth));
    const availableHeight = Math.max(1, Math.floor((viewport?.height || window.innerHeight || document.documentElement.clientHeight) - 8));
    let stageWidth = availableWidth;
    let stageHeight = stageWidth / IMAGE_RATIO;
    if (stageHeight > availableHeight) { stageHeight = availableHeight; stageWidth = stageHeight * IMAGE_RATIO; }
    stage.style.width = `${Math.floor(stageWidth)}px`;
    stage.style.height = `${Math.floor(stageHeight)}px`;
    screen.style.width = `${availableWidth}px`;
    screen.style.height = `${availableHeight + 8}px`;
    screen.style.left = `${Math.floor(viewport?.offsetLeft || 0)}px`;
    screen.style.top = `${Math.floor(viewport?.offsetTop || 0)}px`;
  };

  const loadConfig = () => new Promise((resolve, reject) => {
    if (window.HEURO) { resolve(window.HEURO); return; }
    const script = document.createElement('script');
    script.src = `js/config.js?ts=${Date.now()}`;
    script.onload = () => window.HEURO ? resolve(window.HEURO) : reject(new Error('Configuração não carregada.'));
    script.onerror = () => reject(new Error('Falha ao carregar a configuração.'));
    document.head.appendChild(script);
  });

  const start = async () => {
    fitCommandStage();
    window.addEventListener('resize', fitCommandStage, { passive: true });
    window.addEventListener('orientationchange', () => window.setTimeout(fitCommandStage, 120), { passive: true });
    window.visualViewport?.addEventListener('resize', fitCommandStage, { passive: true });
    window.visualViewport?.addEventListener('scroll', fitCommandStage, { passive: true });

    const app = await loadConfig();
    let session = app.readSession();
    if (!session?.access_token || !session?.user_id) { window.location.replace('./login.html'); return; }

    const invalidateSession = (reason = 'sessao_invalida') => {
      app.clearSession();
      window.location.replace(`./login.html?motivo=${encodeURIComponent(reason)}`);
    };

    try {
      const response = await fetch(app.apiUrl(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=id,display_name,status,authorized_access`), { headers: app.authenticatedHeaders(session.access_token) });
      const profiles = await response.json().catch(() => []);
      if (!response.ok || !Array.isArray(profiles) || profiles.length === 0) { invalidateSession('cadastro_indisponivel'); return; }
      const profile = profiles[0];
      if (profile.status !== 'aprovado' || !profile.authorized_access) { invalidateSession(profile.status === 'bloqueado' ? 'acesso_bloqueado' : 'acesso_nao_autorizado'); return; }
      session = { ...session, display_name: profile.display_name || session.display_name || '', access: profile.authorized_access, status: profile.status };
      app.saveSession(session);
    } catch (_) { invalidateSession('falha_validacao'); return; }

    const commandUserName = document.getElementById('commandUserName');
    const displayName = String(session.display_name || '').trim();
    if (commandUserName) { commandUserName.textContent = displayName ? `${displayName}!` : ''; commandUserName.title = displayName; }

    const permissionDialog = document.getElementById('permissionDialog');
    const permissionClose = document.getElementById('permissionClose');
    const permissionMessage = document.getElementById('permissionMessage');
    const requestLink = document.getElementById('requestTransportLink');
    const teamLink = document.getElementById('teamTransportLink');
    const adminLink = document.getElementById('adminPanelLink');
    const logoutButton = document.getElementById('logoutButton');
    let loggingOut = false;

    const showDenied = (text) => { if (permissionMessage) permissionMessage.textContent = text; if (permissionDialog) permissionDialog.hidden = false; };
    const press = (element, delay = 140) => { element?.classList.add('is-pressed'); window.setTimeout(() => element?.classList.remove('is-pressed'), delay); };

    permissionClose?.addEventListener('click', () => { if (permissionDialog) permissionDialog.hidden = true; });
    permissionDialog?.addEventListener('click', (event) => { if (event.target === permissionDialog) permissionDialog.hidden = true; });

    requestLink?.addEventListener('click', (event) => {
      event.preventDefault(); press(requestLink);
      if (!['solicitante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) { showDenied('Seu perfil não possui permissão para criar solicitações de transporte.'); return; }
      window.setTimeout(() => window.location.assign(`./solicitar-transporte.html?fresh=${Date.now()}`), 100);
    });

    teamLink?.addEventListener('click', (event) => {
      event.preventDefault(); press(teamLink);
      if (!['executante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) { showDenied('Seu perfil não possui permissão para acessar os Transportes da Equipe.'); return; }
      window.setTimeout(() => window.location.assign(`./transportes-equipe.html?fresh=${Date.now()}`), 100);
    });

    adminLink?.addEventListener('click', (event) => {
      press(adminLink, 120);
      if (!(session.status === 'aprovado' && session.access === 'administrador_geral')) { event.preventDefault(); showDenied('Você não possui permissão para acessar esta função. Esta opção exige perfil Administrador Geral.'); }
    });

    const logout = (event) => {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (loggingOut) return;
      loggingOut = true; press(logoutButton, 180);
      const token = session.access_token;
      window.setTimeout(() => {
        app.clearSession();
        fetch(app.apiUrl('/auth/v1/logout'), { method: 'POST', keepalive: true, headers: app.authenticatedHeaders(token) }).catch(() => {});
        window.location.replace('./login.html?logout=1');
      }, 180);
    };
    ['click', 'pointerup', 'touchend'].forEach((type) => logoutButton?.addEventListener(type, logout, { passive: false }));
    app.clearLegacyCaches().catch(() => {});
  };

  start().catch((error) => { console.error(error); window.location.replace('./login.html'); });
})();