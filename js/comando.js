(() => {
  'use strict';
  const app = window.HEURO;
  let session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }
  const $ = (id) => document.getElementById(id);
  const fitCommandViewport = () => {
    const root = document.documentElement;
    const viewportHeight = Math.round(window.visualViewport?.height || innerHeight);
    const viewportWidth = Math.round(window.visualViewport?.width || innerWidth);
    root.style.setProperty('--app-height', `${viewportHeight}px`);
    const navigation = document.querySelector('.heuro-bottom-nav');
    const navigationTop = navigation?.getBoundingClientRect().top;
    const usableHeight = navigationTop > 0 ? navigationTop : Math.max(1, viewportHeight - 94);
    const widthByContentHeight = usableHeight * (862 / 1633);
    root.style.setProperty('--command-stage-width', `${Math.floor(Math.min(viewportWidth * 0.96, widthByContentHeight))}px`);
  };
  fitCommandViewport();
  requestAnimationFrame(fitCommandViewport);
  setTimeout(fitCommandViewport, 120);
  window.visualViewport?.addEventListener('resize', fitCommandViewport, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(fitCommandViewport, 150), { passive: true });
  const press = (element) => { element?.classList.add('is-pressed'); setTimeout(() => element?.classList.remove('is-pressed'), 150); };
  const deny = (message) => alert(message);

  async function validateProfile() {
    const response = await fetch(app.apiUrl(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=id,display_name,status,authorized_access`), { headers: app.authenticatedHeaders(session.access_token), cache: 'no-store' });
    const profiles = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(profiles) || !profiles.length || profiles[0].status !== 'aprovado' || !profiles[0].authorized_access) throw new Error('Acesso não autorizado.');
    const profile = profiles[0];
    session = { ...session, display_name: profile.display_name || session.display_name || '', access: profile.authorized_access, status: profile.status };
    app.saveSession(session);
    $('commandUserName').textContent = session.display_name ? `${session.display_name}!` : '';
  }

  function portoVelhoDayRange() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const start = new Date(`${parts}T00:00:00-04:00`);
    const end = new Date(start.getTime() + 86400000);
    return [start.toISOString(), end.toISOString()];
  }

  async function loadSummary() {
    const [start, end] = portoVelhoDayRange();
    const query = `/rest/v1/transport_requests?select=id,status,created_at,transport_executions(status)&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}`;
    const response = await fetch(app.apiUrl(query), { headers: app.authenticatedHeaders(session.access_token), cache: 'no-store' });
    const requests = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(requests)) return;
    const terminal = new Set(['concluido', 'cancelado', 'recusado', 'suspenso']);
    let pending = 0, active = 0, completed = 0;
    requests.forEach((request) => {
      const execution = Array.isArray(request.transport_executions) ? request.transport_executions[0] : request.transport_executions;
      const status = String(execution?.status || request.status || '').toLowerCase();
      if (terminal.has(status)) completed += 1;
      else if (execution && status !== 'aguardando_aceites') active += 1;
      else pending += 1;
    });
    $('summaryRequested').textContent = requests.length;
    $('summaryActive').textContent = active;
    $('summaryPending').textContent = pending;
    $('summaryCompleted').textContent = completed;
  }

  $('requestTransportLink')?.addEventListener('click', (event) => {
    event.preventDefault(); press(event.currentTarget);
    if (!['solicitante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) { deny('Seu perfil não possui permissão para criar solicitações de transporte.'); return; }
    setTimeout(() => location.assign(`./solicitar-transporte.html?v=20260808.95&fresh=${Date.now()}`), 100);
  });
  $('teamTransportLink')?.addEventListener('click', (event) => {
    event.preventDefault(); press(event.currentTarget);
    if (!['executante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) { deny('Seu perfil não possui permissão para acessar a Equipe de Transporte.'); return; }
    setTimeout(() => location.assign(`./transportes-equipe.html?v=20260808.95&fresh=${Date.now()}`), 100);
  });
  $('shiftTeamButton')?.addEventListener('click', (event) => {
    event.preventDefault(); press(event.currentTarget);
    setTimeout(() => location.assign(`./equipe-plantao.html?v=20260808.95&fresh=${Date.now()}`), 100);
  });
  $('logoutButton')?.addEventListener('click', () => { press($('logoutButton')); app.clearSession(); location.replace('./login.html?logout=1'); });

  validateProfile().then(loadSummary).catch(() => { app.clearSession(); location.replace('./login.html?motivo=sessao_invalida'); });
  app.clearLegacyCaches().catch(() => {});
})();
