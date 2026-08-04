(() => {
  'use strict';

  const welcomeScreen = document.getElementById('welcomeScreen');
  const loginScreen = document.getElementById('loginScreen');
  const enterButton = document.getElementById('enterButton');
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('loginPassword');
  const togglePassword = document.getElementById('togglePassword');
  const firstRegistrationButton = document.getElementById('firstRegistrationButton');

  enterButton?.addEventListener('click', () => {
    if (welcomeScreen) welcomeScreen.hidden = true;
    if (loginScreen) loginScreen.hidden = false;
    document.getElementById('loginIdentifier')?.focus();
  });

  togglePassword?.addEventListener('click', () => {
    if (!passwordInput) return;
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
  });

  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!loginForm.checkValidity()) {
      loginForm.reportValidity();
      return;
    }
    alert('Login preparado. A autenticação será ligada ao banco de dados na etapa correspondente.');
  });

  firstRegistrationButton?.addEventListener('click', () => {
    alert('O primeiro cadastro será conectado na próxima etapa.');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((error) => {
        console.error('Falha ao registrar o service worker:', error);
      });
    });
  }
})();
