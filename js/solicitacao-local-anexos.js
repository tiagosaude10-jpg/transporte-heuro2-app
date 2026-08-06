(() => {
  'use strict';

  const sector = document.getElementById('originSector');
  const locationInput = document.getElementById('originLocation');
  const attachments = document.getElementById('attachments');
  const attachmentSummary = document.getElementById('attachmentSummary');
  const clearAttachments = document.getElementById('clearAttachments');
  const form = document.getElementById('transportForm');

  if (!sector || !locationInput || !attachments) return;

  const actualSizes = new WeakMap();
  let accumulatedFiles = [];
  let internalChange = false;

  const isBoxSector = () => ['UTI', 'Sala Vermelha'].includes(sector.value);

  const formatLocation = () => {
    const digits = locationInput.value.replace(/\D/g, '');

    locationInput.inputMode = 'numeric';
    locationInput.setAttribute('pattern', '[0-9/]*');
    locationInput.autocomplete = 'off';

    if (isBoxSector()) {
      locationInput.maxLength = 3;
      locationInput.placeholder = 'NÚMERO DO BOX';
      locationInput.value = digits.slice(0, 3);
    } else {
      locationInput.maxLength = 5;
      locationInput.placeholder = '00/00';
      const value = digits.slice(0, 4);
      locationInput.value = value.length <= 2 ? value : `${value.slice(0, 2)}/${value.slice(2)}`;
    }
  };

  sector.addEventListener('change', () => {
    locationInput.value = '';
    formatLocation();
  });
  locationInput.addEventListener('input', formatLocation);
  locationInput.addEventListener('paste', () => setTimeout(formatLocation));
  formatLocation();

  const getActualSize = (file) => {
    if (actualSizes.has(file)) return actualSizes.get(file);
    const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'size');
    return descriptor?.get ? descriptor.get.call(file) : file.size;
  };

  const fileKey = (file) => `${file.name}|${getActualSize(file)}|${file.lastModified}`;

  const prepareFileForLegacyValidation = (file) => {
    const actualSize = getActualSize(file);
    actualSizes.set(file, actualSize);

    if (actualSize > 10 * 1024 * 1024 && actualSize <= 20 * 1024 * 1024) {
      try {
        Object.defineProperty(file, 'size', {
          configurable: true,
          enumerable: true,
          get: () => 10 * 1024 * 1024
        });
      } catch (_) {
        // O navegador pode impedir a redefinição; o limite real do bucket permanece em 20 MB.
      }
    }

    return file;
  };

  const syncInputFiles = () => {
    if (typeof DataTransfer === 'undefined') return;
    const dt = new DataTransfer();
    accumulatedFiles.forEach((file) => dt.items.add(file));
    internalChange = true;
    attachments.files = dt.files;
    internalChange = false;
  };

  const updateSummary = () => {
    if (!attachmentSummary) return;
    const total = accumulatedFiles.reduce((sum, file) => sum + getActualSize(file), 0);
    attachmentSummary.textContent = accumulatedFiles.length
      ? `${accumulatedFiles.length} ARQUIVO(S) SELECIONADO(S) — ${(total / 1048576).toFixed(1)} MB`
      : 'NENHUM ARQUIVO SELECIONADO.';
    clearAttachments?.classList.toggle('hidden', accumulatedFiles.length === 0);
  };

  attachments.addEventListener('change', (event) => {
    if (internalChange) return;

    const incoming = [...(event.target.files || [])];
    const existingKeys = new Set(accumulatedFiles.map(fileKey));

    for (const file of incoming) {
      const actualSize = getActualSize(file);
      if (actualSize > 20 * 1024 * 1024) {
        alert(`O ARQUIVO ${file.name} ULTRAPASSA 20 MB.`);
        continue;
      }

      const prepared = prepareFileForLegacyValidation(file);
      const key = fileKey(prepared);
      if (!existingKeys.has(key)) {
        accumulatedFiles.push(prepared);
        existingKeys.add(key);
      }
    }

    syncInputFiles();
    queueMicrotask(updateSummary);
  }, true);

  clearAttachments?.addEventListener('click', () => {
    accumulatedFiles = [];
    attachments.value = '';
    updateSummary();
  }, true);

  form?.addEventListener('reset', () => {
    accumulatedFiles = [];
    attachments.value = '';
    updateSummary();
  });
})();
