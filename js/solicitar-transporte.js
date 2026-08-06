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
  const attachments = document.getElementById('attachments');
  const submitButton = document.getElementById('submitButton');
  const message = document.getElementById('formMessage');

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

  sector.addEventListener('change', updateOriginLabel);
  oxygenRequired.addEventListener('change', () => {
    oxygenDetailsLabel.classList.toggle('hidden', !oxygenRequired.checked);
    oxygenDetails.required = oxygenRequired.checked;
    if (!oxygenRequired.checked) oxygenDetails.value = '';
  });

  const uploadFiles = async () => {
    const files = Array.from(attachments.files || []);
    const paths = [];

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) throw new Error(`O arquivo ${file.name} ultrapassa 10 MB.`);
      const extension = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const path = `${session.user_id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const response = await fetch(app.apiUrl(`/storage/v1/object/transport-attachments/${encodeURIComponent(path)}`), {
        method: 'POST',
        headers: {
          apikey: app.SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'false'
        },
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

    if (!form.reportValidity()) return;
    submitButton.disabled = true;
    submitButton.textContent = 'Enviando...';

    try {
      const attachmentPaths = await uploadFiles();
      const payload = {
        requester_id: session.user_id,
        requester_name: session.display_name || 'Usuário',
        patient_name: document.getElementById('patientName').value.trim(),
        birth_date: document.getElementById('birthDate').value,
        origin_sector: sector.value,
        origin_location: locationInput.value.trim() || null,
        destination: document.getElementById('destination').value.trim(),
        oxygen_required: oxygenRequired.checked,
        oxygen_details: oxygenDetails.value.trim() || null,
        observations: document.getElementById('observations').value.trim() || null,
        attachment_paths: attachmentPaths
      };

      const response = await fetch(app.apiUrl('/rest/v1/transport_requests'), {
        method: 'POST',
        headers: {
          ...app.authenticatedHeaders(session.access_token),
          Prefer: 'return=representation'
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || 'Não foi possível registrar a solicitação.');

      form.reset();
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

  updateOriginLabel();
})();