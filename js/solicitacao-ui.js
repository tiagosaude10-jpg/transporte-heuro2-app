(() => {
  'use strict';

  const form = document.getElementById('transportForm');
  if (!form) return;

  const sector = document.getElementById('originSector');
  const locationInput = document.getElementById('originLocation');
  const locationLabel = document.getElementById('originLocationLabel');
  const attachments = document.getElementById('attachments');
  const attachmentSummary = document.getElementById('attachmentSummary');
  const clearAttachments = document.getElementById('clearAttachments');
  const postActions = document.getElementById('postActions');
  const oxygenDetailsLabel = document.getElementById('oxygenDetailsLabel');

  const isBoxSector = () => ['UTI', 'Sala Vermelha'].includes(sector?.value);
  const setLocationLabel = (text) => {
    if (!locationLabel) return;
    const node = [...locationLabel.childNodes].find((item) => item.nodeType === Node.TEXT_NODE);
    if (node) node.textContent = text;
  };
  const formatLocation = () => {
    if (!locationInput) return;
    const digits = String(locationInput.value || '').replace(/\D/g, '');
    const box = isBoxSector();
    locationInput.type = 'tel';
    locationInput.inputMode = 'numeric';
    locationInput.setAttribute('inputmode', 'numeric');
    locationInput.setAttribute('autocomplete', 'off');
    locationInput.setAttribute('autocorrect', 'off');
    locationInput.setAttribute('spellcheck', 'false');
    setLocationLabel(box ? 'Box' : 'Enfermaria / Leito');
    locationInput.maxLength = box ? 2 : 5;
    locationInput.pattern = box ? '[0-9]{2}' : '[0-9]{2}/[0-9]{2}';
    locationInput.placeholder = box ? '00' : '00/00';
    locationInput.value = box ? digits.slice(0, 2) : (digits.length <= 2 ? digits.slice(0, 4) : `${digits.slice(0, 2)}/${digits.slice(2, 4)}`);
    locationInput.setCustomValidity('');
  };
  sector?.addEventListener('change', () => { if (locationInput) locationInput.value = ''; formatLocation(); });
  ['focus','input','change'].forEach((eventName) => locationInput?.addEventListener(eventName, formatLocation));
  locationInput?.addEventListener('paste', () => setTimeout(formatLocation, 0));
  locationInput?.addEventListener('beforeinput', (event) => {
    if (!event.inputType?.startsWith('delete') && event.data && /\D/.test(event.data)) event.preventDefault();
  });
  locationInput?.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const allowed = ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End','Enter'];
    if (!allowed.includes(event.key) && !/^\d$/.test(event.key)) event.preventDefault();
  });
  locationInput?.addEventListener('blur', () => {
    formatLocation();
    if (!locationInput.value) return;
    const valid = isBoxSector() ? /^\d{2}$/.test(locationInput.value) : /^\d{2}\/\d{2}$/.test(locationInput.value);
    locationInput.setCustomValidity(valid ? '' : isBoxSector() ? 'Informe o box com dois dígitos.' : 'Informe enfermaria e leito no formato 00/00.');
  });
  formatLocation();

  const isFreeTextField = (element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
    if (element.classList.contains('manual') || element.classList.contains('native-picker')) return false;
    return !element.type || ['text','search','tel'].includes(element.type);
  };
  const uppercase = (element) => {
    if (!isFreeTextField(element)) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const value = element.value.toLocaleUpperCase('pt-BR');
    if (element.value === value) return;
    element.value = value;
    try { if (start !== null && end !== null) element.setSelectionRange(start, end); } catch (_) {}
  };
  form.querySelectorAll('input,textarea').forEach((element) => {
    if (!isFreeTextField(element) || element === locationInput) return;
    element.style.textTransform = 'uppercase';
    element.setAttribute('autocapitalize', 'characters');
    ['input','change'].forEach((eventName) => element.addEventListener(eventName, () => uppercase(element)));
  });
  form.addEventListener('submit', () => form.querySelectorAll('input,textarea').forEach(uppercase), true);

  let accumulatedFiles = [];
  if (attachments) {
    attachments.multiple = true;
    const nativeFilesGetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.get;
    const nativeFiles = () => { try { return nativeFilesGetter ? [...(nativeFilesGetter.call(attachments) || [])] : []; } catch (_) { return []; } };
    const key = (file) => `${file.name}|${file.size}|${file.lastModified}`;
    const renderFiles = () => {
      const total = accumulatedFiles.reduce((sum, file) => sum + file.size, 0);
      if (attachmentSummary) attachmentSummary.textContent = accumulatedFiles.length ? `${accumulatedFiles.length} ARQUIVO(S) SELECIONADO(S) — ${(total / 1048576).toFixed(1)} MB` : 'NENHUM ARQUIVO SELECIONADO.';
      clearAttachments?.classList.toggle('hidden', accumulatedFiles.length === 0);
    };
    try { Object.defineProperty(attachments, 'files', { configurable: true, get: () => accumulatedFiles }); } catch (_) {}
    attachments.addEventListener('change', () => {
      const existing = new Set(accumulatedFiles.map(key));
      nativeFiles().forEach((file) => {
        if (file.size > 20 * 1024 * 1024) { alert(`O ARQUIVO ${file.name} ULTRAPASSA 20 MB.`); return; }
        if (!existing.has(key(file))) { accumulatedFiles.push(file); existing.add(key(file)); }
      });
      renderFiles();
    }, true);
    clearAttachments?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      accumulatedFiles = [];
      try { attachments.value = ''; } catch (_) {}
      renderFiles();
    }, true);
    form.addEventListener('reset', () => { accumulatedFiles = []; try { attachments.value = ''; } catch (_) {} renderFiles(); }, true);
    renderFiles();
  }

  if (postActions) {
    let completed = false;
    const finish = () => {
      if (completed || postActions.classList.contains('hidden')) return;
      completed = true;
      form.reset();
      document.querySelectorAll('.native-picker').forEach((picker) => { picker.value = ''; });
      oxygenDetailsLabel?.classList.add('hidden');
      form.classList.add('submission-complete');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    new MutationObserver(finish).observe(postActions, { attributes: true, attributeFilter: ['class'] });
    finish();
  }
})();
