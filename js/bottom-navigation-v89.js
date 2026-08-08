(() => {
  'use strict';
  const app = window.HEURO;
  const session = app?.readSession?.();
  if (!session?.access_token || !session?.user_id || document.querySelector('.heuro-bottom-nav')) return;

  const path = location.pathname.split('/').pop() || 'index.html';
  const params = new URLSearchParams(location.search);
  const requestedTab = params.get('tab');
  const isAdmin = session.access === 'administrador_geral';
  const isTeamPage = path === 'transportes-equipe.html';
  const activeKey = path === 'comando.html' ? 'home'
    : isTeamPage && requestedTab === 'active' ? 'agenda'
      : isTeamPage && requestedTab === 'completed' ? 'history'
        : isTeamPage ? 'pending'
          : path.startsWith('admin-') ? 'admin' : '';

  const icons = {
    home: '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="hn" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5ba5ff"/><stop offset=".5" stop-color="#1263c8"/><stop offset="1" stop-color="#063576"/></linearGradient><linearGradient id="hr" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#cfe4fb"/></linearGradient></defs><path d="M5 23 24 6l19 17-4 5-3-3v17H12V25l-3 3z" fill="url(#hn)" stroke="#fff" stroke-width="1.5"/><path d="M18 42V28h12v14" fill="url(#hr)"/><path d="M10 22 24 9l14 13" fill="none" stroke="#9fd0ff" stroke-width="2.5" stroke-linecap="round"/></svg>',
    pending: '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><radialGradient id="pf"><stop stop-color="#fffef5"/><stop offset="1" stop-color="#dbe6f2"/></radialGradient><linearGradient id="pr" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff1a5"/><stop offset=".45" stop-color="#d49318"/><stop offset="1" stop-color="#7c4500"/></linearGradient></defs><circle cx="24" cy="25" r="19" fill="url(#pr)"/><circle cx="24" cy="25" r="15" fill="url(#pf)" stroke="#8c9bae"/><path d="M24 14v11l8 5" fill="none" stroke="#163b64" stroke-width="3.2" stroke-linecap="round"/><circle cx="24" cy="25" r="2.7" fill="#d42035"/><path d="M17 4h14l2 5H15z" fill="#d1941c"/></svg>',
    agenda: '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="ab" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#b9cede"/></linearGradient><linearGradient id="ag" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7ae7a9"/><stop offset="1" stop-color="#087640"/></linearGradient></defs><rect x="5" y="9" width="38" height="34" rx="7" fill="url(#ab)" stroke="#527493" stroke-width="1.5"/><path d="M5 17h38" stroke="#176bc2" stroke-width="6"/><path d="M14 5v9M34 5v9" stroke="#35546f" stroke-width="4" stroke-linecap="round"/><circle cx="33" cy="32" r="10" fill="url(#ag)" stroke="#eafff2" stroke-width="1.5"/><path d="m28 32 3 3 6-7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    history: '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="hb" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#c4d9ee"/><stop offset="1" stop-color="#779fc6"/></linearGradient><radialGradient id="hg"><stop stop-color="#73eaa5"/><stop offset="1" stop-color="#08723a"/></radialGradient></defs><rect x="8" y="6" width="31" height="37" rx="5" fill="url(#hb)" stroke="#42698f" stroke-width="1.5"/><path d="M16 16h16M16 23h14M16 30h9" stroke="#6484a2" stroke-width="2.4" stroke-linecap="round"/><circle cx="35" cy="34" r="10" fill="url(#hg)" stroke="#fff" stroke-width="1.5"/><path d="m30 34 3 3 6-7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    admin: '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><radialGradient id="ad"><stop stop-color="#8fc2ff"/><stop offset=".55" stop-color="#1767c9"/><stop offset="1" stop-color="#06377f"/></radialGradient></defs><circle cx="24" cy="24" r="20" fill="url(#ad)" stroke="#fff" stroke-width="2"/><path d="M24 13v22M13 24h22" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M12 15a17 17 0 0 1 15-8" fill="none" stroke="#cde6ff" stroke-width="2.5" stroke-linecap="round"/></svg>'
  };
  const items = [
    ['home', 'Início', './comando.html?v=20260808.96'],
    ['pending', 'Solicitações pendentes', './transportes-equipe.html?tab=pending&v=20260808.96'],
    ['agenda', 'Agenda de transportes', './transportes-equipe.html?tab=active&v=20260808.96'],
    ['history', 'Histórico de transportes', './transportes-equipe.html?tab=completed&v=20260808.96']
  ];
  if (isAdmin) items.push(['admin', 'Administrativo', './admin-central.html?v=20260808.96']);

  const nav = document.createElement('nav');
  nav.className = 'heuro-bottom-nav';
  nav.style.setProperty('--heuro-nav-count', String(items.length));
  nav.setAttribute('aria-label', 'Navegação principal');
  nav.innerHTML = items.map(([key, label, href]) => `<a class="heuro-bottom-nav__item heuro-bottom-nav__item--${key}${activeKey === key ? ' is-active' : ''}" href="${href}" data-heuro-nav="${key}"${activeKey === key ? ' aria-current="page"' : ''}><span class="heuro-bottom-nav__icon">${icons[key]}</span><span class="heuro-bottom-nav__label">${label}</span></a>`).join('');
  document.body.classList.add('heuro-has-bottom-nav');
  document.body.appendChild(nav);

  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-heuro-nav]');
    if (!link) return;
    event.preventDefault();
    if (['pending', 'agenda', 'history'].includes(link.dataset.heuroNav) && !['executante', 'solicitante_executante', 'administrador_geral'].includes(session.access)) {
      alert('Seu perfil não possui permissão para acessar os transportes da equipe.');
      return;
    }
    link.classList.add('is-pressed');
    const navigate = () => location.assign(`${link.href}${link.href.includes('?') ? '&' : '?'}fresh=${Date.now()}`);
    const navigationEvent = new CustomEvent('heuro:navigate', { cancelable: true, detail: { key: link.dataset.heuroNav, href: link.href, navigate } });
    if (document.dispatchEvent(navigationEvent)) setTimeout(navigate, 90);
  });
})();
