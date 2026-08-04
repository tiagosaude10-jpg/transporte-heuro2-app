(() => {
  'use strict';

  const app = document.getElementById('app');

  if (!app) {
    console.error('Transporte HEURO 2: elemento principal #app não encontrado.');
    return;
  }

  document.documentElement.dataset.appReady = 'true';
  console.info('Transporte HEURO 2 — Etapa 1 carregada.');
})();
