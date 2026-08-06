(() => {
  'use strict';

  const sector = document.getElementById('originSector');
  const locationInput = document.getElementById('originLocation');
  const attachments = document.getElementById('attachments');
  const attachmentSummary = document.getElementById('attachmentSummary');
  const clearAttachments = document.getElementById('clearAttachments');
  const form = document.getElementById('transportForm');

  if (!sector || !locationInput) return;

  const isBoxSector = () => ['UTI', 'Sala Vermelha'].includes(sector.value);

  const formatLocation = () => {
    const digits = String(locationInput.value || '').replace(/\D/g, '');
    const box = isBoxSector();

    locationInput.type = 'tel';
    locationInput.inputMode = 'numeric';
    locationInput.setAttribute('inputmode', 'numeric');
    locationInput.setAttribute('autocomplete', 'off');
    locationInput.setAttribute('autocorrect', 'off');
    locationInput.setAttribute('spellcheck', 'false');

    if (box) {
      locationInput.maxLength = 3;
      locationInput.pattern = '[0-9]{1,3}';
      locationInput.placeholder = 'NÚMERO DO BOX';
      locationInput.value = digits.slice(0, 3);
    } else {
      locationInput.maxLength = 5;
      locationInput.pattern = '[0-9]{2}/[0-9]{2}';
      locationInput.placeholder = '00/00';
      const value = digits.slice(0, 4);
      locationInput.value = value.length <= 2 ? value : `${value.slice(0, 2)}/${value.slice(2)}`;
    }
  };

  const configureLocation = (clear = false) => {
    if (clear) locationInput.value = '';
    formatLocation();
  };

  sector.addEventListener('change', () => configureLocation(true), true);
  locationInput.addEventListener('input', formatLocation, true);
  locationInput.addEventListener('paste', () => setTimeout(formatLocation, 0), true);
  locationInput.addEventListener('beforeinput', (event) => {
    if (event.inputType?.startsWith('delete')) return;
    if (event.data && /\D/.test(event.data)) event.preventDefault();
  }, true);
  locationInput.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
    if (!allowed.includes(event.key) && !/^\d$/.test(event.key)) event.preventDefault();
  }, true);

  configureLocation(false);
  setTimeout(() => configureLocation(false), 0);

  if (!attachments) return;

  attachments.multiple = true;
  attachments.setAttribute('multiple', 'multiple');

  const attachmentLabel = attachments.closest('label');
  const attachmentHint = attachmentLabel?.querySelector('.hint');
  if (attachmentHint) {
    attachmentHint.textContent = 'ATÉ 20 MB POR ARQUIVO. VOCÊ PODE ADICIONAR VÁRIAS FOTOS E DOCUMENTOS, INCLUSIVE EM ETAPAS.';
  }

  const nativeFilesDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
  const nativeFilesGetter = nativeFilesDescriptor?.get;
  const actualSizes = new WeakMap();
  let accumulatedFiles = [];

  const getNativeFiles = () => {
    try {
      return nativeFilesGetter ? [...(nativeFilesGetter.call(attachments) || [])] : [];
    } catch (_) {
      return [];
    }
  };

  const getActualSize = (file) => {
    if (actualSizes.has(file)) return actualSizes.get(file);
    const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'size');
    const size = descriptor?.get ? descriptor.get.call(file) : Number(file.size || 0);
    actualSizes.set(file, size);
    return size;
  };

  const fileKey = (file) => `${file.name}|${getActualSize(file)}|${file.lastModified}`;

  const prepareForLegacyValidator = (file) => {
    const actualSize = getActualSize(file);
    if (actualSize > 10 * 1024 * 1024 && actualSize <= 20 * 1024 * 1024) {
      try {
        Object.defineProperty(file, 'size', {
          configurable: true,
          enumerable: true,
          get: () => 10 * 1024 * 1024
        });
      } catch (_) {}
    }
    return file;
  };

  const updateSummary = () => {
    if (!attachmentSummary) return;
    const total = accumulatedFiles.reduce((sum, file) => sum + getActualSize(file), 0);
    attachmentSummary.textContent = accumulatedFiles.length
      ? `${accumulatedFiles.length} ARQUIVO(S) SELECIONADO(S) — ${(total / 1048576).toFixed(1)} MB`
      : 'NENHUM ARQUIVO SELECIONADO.';
    clearAttachments?.classList.toggle('hidden', accumulatedFiles.length === 0);
  };

  try {
    Object.defineProperty(attachments, 'files', {
      configurable: true,
      enumerable: true,
      get: () => accumulatedFiles
    });
  } catch (_) {}

  attachments.addEventListener('change', () => {
    const incoming = getNativeFiles();
    const existing = new Set(accumulatedFiles.map(fileKey));

    for (const file of incoming) {
      const actualSize = getActualSize(file);
      if (actualSize > 20 * 1024 * 1024) {
        alert(`O ARQUIVO ${file.name} ULTRAPASSA 20 MB.`);
        continue;
      }

      const prepared = prepareForLegacyValidator(file);
      const key = fileKey(prepared);
      if (!existing.has(key)) {
        accumulatedFiles.push(prepared);
        existing.add(key);
      }
    }

    updateSummary();
  }, true);

  clearAttachments?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    accumulatedFiles = [];
    try { attachments.value = ''; } catch (_) {}
    updateSummary();
  }, true);

  form?.addEventListener('reset', () => {
    accumulatedFiles = [];
    try { attachments.value = ''; } catch (_) {}
    updateSummary();
  }, true);

  updateSummary();
})();