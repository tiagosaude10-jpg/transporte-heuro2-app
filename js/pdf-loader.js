(() => {
  'use strict';

  const sources = [
    './vendor/jspdf.umd.min.js?v=20260807.82',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
  ];

  let loadingPromise = null;
  let replayingClick = false;

  const hasJsPdf = () => Boolean(window.jspdf && window.jspdf.jsPDF);

  const loadSource = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => hasJsPdf() ? resolve(window.jspdf.jsPDF) : reject(new Error('Biblioteca carregada sem jsPDF.'));
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });

  const loadJsPdf = async () => {
    if (hasJsPdf()) return window.jspdf.jsPDF;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      let lastError = null;
      for (const src of sources) {
        try {
          return await loadSource(src);
        } catch (error) {
          lastError = error;
        }
      }
      loadingPromise = null;
      throw lastError || new Error('Não foi possível carregar o gerador de PDF.');
    })();

    return loadingPromise;
  };

  const showLoadingMessage = (text, error = false) => {
    const message = document.getElementById('formMessage');
    if (!message) return;
    message.textContent = text;
    message.className = `message ${error ? 'error' : 'ok'}`;
  };

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('#sharePdfButton');
    if (!button || hasJsPdf() || replayingClick) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Carregando gerador de PDF...';
    showLoadingMessage('Preparando o gerador de PDF. Aguarde alguns segundos.');

    try {
      await loadJsPdf();
      replayingClick = true;
      button.disabled = false;
      button.textContent = originalText;
      button.click();
    } catch (_) {
      button.disabled = false;
      button.textContent = originalText;
      showLoadingMessage('Não foi possível carregar o gerador de PDF. Verifique a internet e tente novamente.', true);
    } finally {
      window.setTimeout(() => { replayingClick = false; }, 50);
    }
  }, true);

  window.HEURO_PDF = Object.freeze({ loadJsPdf, isReady: hasJsPdf });
  loadJsPdf().catch(() => {});
})();