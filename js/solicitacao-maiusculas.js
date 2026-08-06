(() => {
  'use strict';

  const form = document.getElementById('transportForm');
  if (!form) return;

  const isFreeTextField = (element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
    if (element.classList.contains('manual') || element.classList.contains('native-picker')) return false;
    if (element.type && !['text', 'search', 'tel'].includes(element.type)) return false;
    return true;
  };

  const toUpperCase = (element) => {
    if (!isFreeTextField(element)) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const upper = element.value.toLocaleUpperCase('pt-BR');
    if (element.value === upper) return;
    element.value = upper;
    try {
      if (start !== null && end !== null) element.setSelectionRange(start, end);
    } catch (_) {}
  };

  form.querySelectorAll('input, textarea').forEach((element) => {
    if (!isFreeTextField(element)) return;
    element.style.textTransform = 'uppercase';
    element.setAttribute('autocapitalize', 'characters');
    element.addEventListener('input', () => toUpperCase(element));
    element.addEventListener('change', () => toUpperCase(element));
  });

  form.addEventListener('submit', () => {
    form.querySelectorAll('input, textarea').forEach(toUpperCase);
  }, true);
})();
