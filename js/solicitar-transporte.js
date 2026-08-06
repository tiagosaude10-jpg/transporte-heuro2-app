(() => {
  'use strict';

  const app = window.HEURO;
  const session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) {
    window.location.replace('./login.html');
    return;
  }

  const allowed = ['solicitante', 'solicitante_executante', 'administrador_geral'];
  if (!allowed.includes(session.access)) {
    window.location.replace('./comando.html?motivo=sem_permissao_solicitar');
    return;
  }

  const form = document.getElementById('transportForm');
  const sector = document.getElementById('originSector');
  const locationLabel = document.getElementById('originLocationLabel');
  const locationInput = document.getElementById('originLocation');
  const oxygenRequired = document.getElementById('oxygenRequired');
  const oxygenDetailsLabel = document.getElementById('oxygenDetailsLabel');
  const oxygenDetails = document.getElementById('oxygenDetails');
  const submitButton = document.getElementById('submitButton');
  const message = document.getElementById('formMessage');
  const attachmentSheet = document.getElementById('attachmentSheet');
  const openAttachmentMenu = document.getElementById('openAttachmentMenu');
  const closeAttachmentMenu = document.getElementById('closeAttachmentMenu');
  const cameraInput = document.getElementById('cameraInput');
  const photoInput = document.getElementById('photoInput');
  const documentInput = document.getElementById('documentInput');
  const attachmentSummary = document.getElementById('attachmentSummary');
  const priorityRank = Object.freeze({ emergencia: 1, urgencia: 2, eletivo: 3 });
  let selectedFiles = [];

  const showMessage = (text, ok = false) => {
    message.textContent = text;
    message.className = `message ${ok ? 'ok' : 'error'}`;
  };

  const updateOriginLabel = () => {
    const value = sector.value;
    if (value === 'UTI' || value === 'Sala Vermelha') {
      locationLabel.firstChild.textContent = 'Box';
      locationInput.placeholder = 'Informe o box';
    } else {
      locationLabel.firstChild.textContent = 'Enfermaria / Leito';
      locationInput.placeholder = 'Informe a enfermaria e o leito';
    }
  };

  const maskDate = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const maskTime = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  };

  const dateToIso = (value) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) return null;
    const [, day, month, year] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
    return `${year}-${month}-${day}`;
  };

  const isoToDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  };

  const normalizeTime = (value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${match[1]}:${match[2]}`;
  };

  const bindSmartFields = () => {
    document.querySelectorAll('.manual').forEach((input) => {
      input.addEventListener('input', () => {
        input.value = input.id.includes('Time') ? maskTime(input.value) : maskDate(input.value);
        input.setCustomValidity('');
      });
    });

    document.querySelectorAll('[data-picker]').forEach((button) => {
      button.addEventListener('click', () => {
        const picker = document.getElementById(button.dataset.picker);
        if (!picker) return;
        if (typeof picker.showPicker === 'function') picker.showPicker();
        else picker.click();
      });
    });

    document.querySelectorAll('.native-picker').forEach((picker) => {
      picker.addEventListener('change', () => {
        const textId = picker.id.replace('Native', 'Text');
        const textInput = document.getElementById(textId);
        if (!textInput) return;
        textInput.value = picker.type === 'date' ? isoToDate(picker.value) : picker.value;
        textInput.setCustomValidity('');
      });
    });

    document.querySelectorAll('[data-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        button.dataset.clear.split(',').forEach((id) => {
          const element = document.getElementById(id);
          if (element) {
            element.value = '';
            element.setCustomValidity?.('');
          }
        });
      });
    });
  };

  const closeSheet = () => {
    attachmentSheet.hidden = true;
  };

  const updateAttachmentSummary = () => {
    if (selectedFiles.length === 0) {
      attachmentSummary.className = 'attachment-summary';
      attachmentSummary.textContent = 'Nenhum arquivo selecionado.';
      return;
    }
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const totalMb = (totalSize / (1024 * 1024)).toFixed(1);
    attachmentSummary.className = 'attachment-summary has-files';
    attachmentSummary.innerHTML = `${selectedFiles.length} arquivo(s) selecionado(s) — ${totalMb} MB <button type="button" id="clearAttachments">Limpar</button>`;
    document.getElementById('clearAttachments')?.addEventListener('click', () => {
      selectedFiles = [];
      [cameraInput, photoInput, documentInput].forEach((input) => { input.value = ''; });
      updateAttachmentSummary();
    });
  };

  const addSelectedFiles = (input) => {
    const incoming = Array.from(input.files || []);
    incoming.forEach((file) => {
      const duplicate = selectedFiles.some((current) => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified);
      if (!duplicate) selectedFiles.push(file);
    });
    updateAttachmentSummary();
    closeSheet();
  };

  openAttachmentMenu.addEventListener('click', () => {
    attachmentSheet.hidden = false;
  });
  closeAttachmentMenu.addEventListener('click', closeSheet);
  attachmentSheet.addEventListener('click', (event) => {
    if (event.target === attachmentSheet) closeSheet();
  });

  document.querySelectorAll('[data-attachment-source]').forEach((button) => {
    button.addEventListener('click', () => {
      const source = button.dataset.attachmentSource;
      if (source === 'camera') cameraInput.click();
      if (source === 'photo') photoInput.click();
      if (source === 'document') documentInput.click();
    });
  });

  cameraInput.addEventListener('change', () => addSelectedFiles(cameraInput));
  photoInput.addEventListener('change', () => addSelectedFiles(photoInput));
  documentInput.addEventListener('change', () => addSelectedFiles(documentInput));

  sector.addEventListener('change', updateOriginLabel);
  oxygenRequired.addEventListener('change', () => {
    oxygenDetailsLabel.classList.toggle('hidden', !oxygenRequired.checked);
    oxygenDetails.required = oxygenRequired.checked;
    if (!oxygenRequired.checked) oxygenDetails.value = '';
  });

  const uploadFiles = async () => {
    const paths = [];
    for (const file of selectedFiles) {
      if (file.size > 10 * 1024 * 1024) throw new Error(`O arquivo ${file.name} ultrapassa 10 MB.`);
      const extension = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const path = `${session.user_id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const response = await fetch(app.apiUrl(`/storage/v1/object/transport-attachments/${encodeURIComponent(path)}`), {
        method: 'POST',
        headers: { apikey: app.SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: file
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || `Não foi possível enviar ${file.name}.`);
      }
      paths.push(path);
    }
    return paths;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.className = 'message';

    const birthDateInput = document.getElementById('birthDateText');
    const transportDateInput = document.getElementById('transportDateText');
    const timeInput = document.getElementById('destinationTimeText');
    const birthDate = dateToIso(birthDateInput.value);
    const transportDate = dateToIso(transportDateInput.value);
    const destinationTime = normalizeTime(timeInput.value);

    birthDateInput.setCustomValidity(birthDate ? '' : 'Informe uma data válida no formato DD/MM/AAAA.');
    transportDateInput.setCustomValidity(transportDate ? '' : 'Informe uma data válida no formato DD/MM/AAAA.');
    timeInput.setCustomValidity(destinationTime ? '' : 'Informe um horário válido no formato HH:MM.');

    if (!form.reportValidity()) return;
    submitButton.disabled = true;
    submitButton.textContent = 'Enviando...';

    try {
      const supportType = form.elements.supportType.value;
      const priority = form.elements.priority.value;
      if (!supportType || !priority) throw new Error('Selecione o tipo de transporte e a prioridade.');
      const attachmentPaths = await uploadFiles();
      const payload = {
        requester_id: session.user_id,
        requester_name: session.display_name || 'Usuário',
        support_type: supportType,
        priority,
        priority_rank: priorityRank[priority],
        patient_name: document.getElementById('patientName').value.trim(),
        birth_date: birthDate,
        origin_sector: sector.value,
        origin_location: locationInput.value.trim() || null,
        destination: document.getElementById('destination').value.trim(),
        transport_date: transportDate,
        destination_time: destinationTime,
        oxygen_required: oxygenRequired.checked,
        oxygen_details: oxygenDetails.value.trim() || null,
        observations: document.getElementById('observations').value.trim() || null,
        attachment_paths: attachmentPaths
      };

      const response = await fetch(app.apiUrl('/rest/v1/transport_requests'), {
        method: 'POST',
        headers: { ...app.authenticatedHeaders(session.access_token), Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || 'Não foi possível registrar a solicitação.');

      form.reset();
      selectedFiles = [];
      [cameraInput, photoInput, documentInput].forEach((input) => { input.value = ''; });
      document.querySelectorAll('.native-picker').forEach((picker) => { picker.value = ''; });
      updateAttachmentSummary();
      updateOriginLabel();
      oxygenDetailsLabel.classList.add('hidden');
      showMessage('Solicitação enviada com sucesso para a equipe de transporte.', true);
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Falha ao enviar a solicitação.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Enviar solicitação';
    }
  });

  bindSmartFields();
  updateAttachmentSummary();
  updateOriginLabel();
})();