(() => {
  'use strict';

  const IMAGE_WIDTH = 768;
  const IMAGE_HEIGHT = 1664;
  const IMAGE_RATIO = IMAGE_WIDTH / IMAGE_HEIGHT;
  let navigating = false;

  const fitCommandStage = () => {
    const stage = document.getElementById('commandStage');
    const screen = document.getElementById('commandScreen');
    if (!stage || !screen) return;
    const viewport = window.visualViewport;
    const availableWidth = Math.max(1, Math.floor(viewport?.width || window.innerWidth || document.documentElement.clientWidth));
    const availableHeight = Math.max(1, Math.floor((viewport?.height || window.innerHeight || document.documentElement.clientHeight) - 8));
    let stageWidth = availableWidth;
    let stageHeight = stageWidth / IMAGE_RATIO;
    if (stageHeight > availableHeight) {
      stageHeight = availableHeight;
      stageWidth = stageHeight * IMAGE_RATIO;
    }
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
    script.src = `js/config.js?fresh=${Date.now()}`;
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
    if (!session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }

    try {
      const response = await fetch(app.apiUrl(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=id,display_name,status,authorized_access`), { headers: app.authenticatedHeaders(session.access_token) });
      const profiles = await response.json().catch(() => []);
      if (!response.ok || !Array.isArray(profiles) || profiles.length === 0) throw new Error('Perfil indisponível');
      const profile = profiles[0];
      if (profile.status !== 'aprovado' || !profile.authorized_access) throw new Error('Acesso não autorizado');
      session = { ...session, display_name: profile.display_name || session.display_name || '', access: profile.authorized_access, status: profile.status };
      app.saveSession(session);
    } catch (_) {
      app.clearSession();
      location.replace('./login.html?motivo=falha_validacao');
      return;
    }

    const $ = (id) => document.getElementById(id);
    const stage = $('commandStage');
    const requestLink = $('requestTransportLink');
    const teamLink = $('teamTransportLink');
    const adminLink = $('adminPanelLink');
    const logoutButton = $('logoutButton');
    const permissionDialog = $('permissionDialog');
    const permissionMessage = $('permissionMessage');
    const permissionClose = $('permissionClose');
    const commandUserName = $('commandUserName');

    const displayName = String(session.display_name || '').trim();
    if (commandUserName) commandUserName.textContent = displayName ? `${displayName}!` : '';

    const press = (element, delay = 160) => {
      element?.classList.add('is-pressed');
      setTimeout(() => element?.classList.remove('is-pressed'), delay);
    };
    const showDenied = (text) => {
      if (permissionMessage) permissionMessage.textContent = text;
      if (permissionDialog) permissionDialog.hidden = false;
    };
    const go = (url, element) => {
      if (navigating) return;
      navigating = true;
      press(element);
      setTimeout(() => location.assign(`${url}${url.includes('?') ? '&' : '?'}fresh=${Date.now()}`), 90);
      setTimeout(() => { navigating = false; }, 1200);
    };

    const openRequest = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!['solicitante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) {
        showDenied('Seu perfil não possui permissão para criar solicitações de transporte.');
        return;
      }
      go('./solicitar-transporte.html', requestLink);
    };

    const openTeam = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!['executante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) {
        showDenied('Seu perfil não possui permissão para acessar os Transportes da Equipe.');
        return;
      }
      go('./transportes-equipe.html', teamLink);
    };

    requestLink?.addEventListener('click', openRequest, { passive: false });
    teamLink?.addEventListener('click', openTeam, { passive: false });

    // Fallback específico para iPhone: captura o toque pelas coordenadas reais da imagem.
    const coordinateFallback = (event) => {
      if (navigating || !stage) return;
      const point = event.changedTouches?.[0] || event;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (point.clientX - rect.left) / rect.width;
      const y = (point.clientY - rect.top) / rect.height;
      if (x < 0.025 || x > 0.975) return;
      if (y >= 0.278 && y <= 0.397) openRequest(event);
      else if (y >= 0.397 && y <= 0.526) openTeam(event);
    };
    document.addEventListener('pointerup', coordinateFallback, { passive: false, capture: true });
    document.addEventListener('touchend', coordinateFallback, { passive: false, capture: true });

    adminLink?.addEventListener('click', (event) => {
      if (session.access !== 'administrador_geral') {
        event.preventDefault();
        showDenied('Esta opção exige perfil Administrador Geral.');
        return;
      }
      event.preventDefault();
      go('./admin-central.html', adminLink);
    }, { passive: false });

    permissionClose?.addEventListener('click', () => { if (permissionDialog) permissionDialog.hidden = true; });
    permissionDialog?.addEventListener('click', (event) => { if (event.target === permissionDialog) permissionDialog.hidden = true; });

    let loggingOut = false;
    logoutButton?.addEventListener('click', (event) => {
      event.preventDefault();
      if (loggingOut) return;
      loggingOut = true;
      press(logoutButton, 180);
      const token = session.access_token;
      setTimeout(() => {
        app.clearSession();
        fetch(app.apiUrl('/auth/v1/logout'), { method: 'POST', keepalive: true, headers: app.authenticatedHeaders(token) }).catch(() => {});
        location.replace('./login.html?logout=1');
      }, 180);
    }, { passive: false });

    app.clearLegacyCaches().catch(() => {});
  };

  start().catch((error) => {
    console.error(error);
    location.replace('./login.html');
  });
})();
