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
  });

  togglePassword?.addEventListener('click', () => {
    if (!passwordInput) return;
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
  });

  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  firstRegistrationButton?.addEventListener('click', () => {
    // A tela de primeiro cadastro será ligada apenas quando for autorizada.
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
})();
