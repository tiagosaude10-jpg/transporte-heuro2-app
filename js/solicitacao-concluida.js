(() => {
  'use strict';

  const form = document.getElementById('transportForm');
  const postActions = document.getElementById('postActions');
  const attachments = document.getElementById('attachments');
  const attachmentSummary = document.getElementById('attachmentSummary');
  const clearAttachments = document.getElementById('clearAttachments');
  const oxygenDetailsLabel = document.getElementById('oxygenDetailsLabel');

  if (!form || !postActions) return;

  let completed = false;

  const finishScreen = () => {
    if (completed || postActions.classList.contains('hidden')) return;
    completed = true;

    form.reset();
    document.querySelectorAll('.native-picker').forEach((picker) => { picker.value = ''; });

    if (attachments) attachments.value = '';
    if (attachmentSummary) attachmentSummary.textContent = 'Nenhum arquivo selecionado.';
    clearAttachments?.classList.add('hidden');
    oxygenDetailsLabel?.classList.add('hidden');

    form.classList.add('submission-complete');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const observer = new MutationObserver(finishScreen);
  observer.observe(postActions, { attributes: true, attributeFilter: ['class'] });
  finishScreen();
})();