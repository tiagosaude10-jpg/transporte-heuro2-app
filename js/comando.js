(() => {
  'use strict';

  const adminLink = document.getElementById('adminPanelLink');

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

  if (session.access !== 'administrador_geral') {
    adminLink?.setAttribute('hidden', '');
    return;
  }

  adminLink?.addEventListener('click', (event) => {
    event.preventDefault();
    const destination = adminLink.href;
    adminLink.classList.add('is-pressed');
    window.setTimeout(() => window.location.assign(destination), 140);
  });
})();
