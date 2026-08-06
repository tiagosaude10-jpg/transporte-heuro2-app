(() => {
  'use strict';

  const sources = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
  ];

  let loadingPromise = null;

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
      throw lastError || new Error('Não foi possível carregar o gerador de PDF.');
    })();

    return loadingPromise;
  };

  window.HEURO_PDF = Object.freeze({ loadJsPdf, isReady: hasJsPdf });
  loadJsPdf().catch(() => {});
})();