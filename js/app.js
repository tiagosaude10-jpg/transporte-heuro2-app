(() => {
  'use strict';

  const passwordInput = document.getElementById('loginPassword');
  const togglePasswordButton = document.getElementById('togglePassword');
  const loginForm = document.getElementById('loginForm');
  const firstRegistrationLink = document.getElementById('firstRegistrationLink');

  togglePasswordButton?.addEventListener('click', () => {
    if (!passwordInput) return;

    const passwordIsVisible = passwordInput.type === 'text';
    passwordInput.type = passwordIsVisible ? 'password' : 'text';
    togglePasswordButton.setAttribute(
      'aria-label',
      passwordIsVisible ? 'Mostrar senha' : 'Ocultar senha'
    );
  });

  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loginForm.reportValidity();
  });

  firstRegistrationLink?.addEventListener('click', (event) => {
    event.preventDefault();

    const destination = firstRegistrationLink.href;
    firstRegistrationLink.classList.add('is-pressed');
    firstRegistrationLink.setAttribute('aria-busy', 'true');

    window.setTimeout(() => {
      window.location.assign(destination);
    }, 140);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }

  if ('caches' in window) {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => caches.delete(cacheName));
    });
  }
})();
