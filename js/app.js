(() => {
  'use strict';

  const enterButton = document.getElementById('enterButton');

  enterButton?.addEventListener('click', () => {
    alert('Tela de login será adicionada na próxima etapa.');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((error) => {
        console.error('Falha ao registrar o service worker:', error);
      });
    });
  }
})();
