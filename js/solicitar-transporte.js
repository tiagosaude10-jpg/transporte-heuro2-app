(() => {
  'use strict';

  const app = window.HEURO;
  const session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }
  if (!['solicitante','solicitante_executante','administrador_geral'].includes(session.access)) { location.replace('./comando.html?motivo=sem_permissao_solicitar'); return; }

  const $ = (id) => document.getElementById(id);
  const form = $('transportForm');
  const sector = $('originSector');
  const locationLabel = $('originLocationLabel');
  const locationInput = $('originLocation');
  const oxygenRequired = $('oxygenRequired');
  const oxygenDetailsLabel = $('oxygenDetailsLabel');
  const oxygenDetails = $('oxygenDetails');
  const attachments = $('attachments');
  const attachmentSummary = $('attachmentSummary');
  const clearAttachments = $('clearAttachments');
  const submitButton = $('submitButton');
  const message = $('formMessage');
  const postActions = $('postActions');
  const sharePdfButton = $('sharePdfButton');
  const openWhatsappButton = $('openWhatsappButton');

  const priorityRank = Object.freeze({ emergencia: 1, urgencia: 2, eletivo: 3 });
  const labels = {
    basico: 'Suporte Básico', avancado_uti: 'Suporte Avançado / UTI',
    emergencia: 'Emergência', urgencia: 'Urgência', eletivo: 'Eletivo',
    transferencia: 'Transferência', exame_procedimento: 'Exame/Procedimento', consulta: 'Consulta'
  };
  let lastRequest = null;

  const showMessage = (text, ok = false) => {
    message.textContent = text;
    message.className = `message ${ok ? 'ok' : 'error'}`;
  };

  const updateOriginLabel = () => {
    const box = ['UTI', 'Sala Vermelha'].includes(sector.value);
    locationLabel.firstChild.textContent = box ? 'Box' : 'Enfermaria / Leito';
    locationInput.placeholder = box ? 'Informe o box' : 'Informe a enfermaria e o leito';
  };

  const maskDate = (value) => {
    const d = value.replace(/\D/g, '').slice(0, 8);
    return d.length <= 2 ? d : d.length <= 4 ? `${d.slice(0,2)}/${d.slice(2)}` : `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`;
  };
  const maskTime = (value) => {
    const d = value.replace(/\D/g, '').slice(0, 4);
    return d.length <= 2 ? d : `${d.slice(0,2)}:${d.slice(2)}`;
  };
  const dateToIso = (value) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!m) return null;
    const [, d, mo, y] = m;
    const dt = new Date(+y, +mo - 1, +d);
    return dt.getFullYear() === +y && dt.getMonth() === +mo - 1 && dt.getDate() === +d ? `${y}-${mo}-${d}` : null;
  };
  const isoToDate = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const normalizeTime = (value) => {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    return m && +m[1] < 24 && +m[2] < 60 ? value : null;
  };

  document.querySelectorAll('.manual').forEach((input) => input.addEventListener('input', () => {
    input.value = input.id.includes('Time') ? maskTime(input.value) : maskDate(input.value);
    input.setCustomValidity('');
  }));
  document.querySelectorAll('[data-picker]').forEach((button) => button.addEventListener('click', () => {
    const picker = $(button.dataset.picker);
    if (typeof picker?.showPicker === 'function') picker.showPicker(); else picker?.click();
  }));
  document.querySelectorAll('.native-picker').forEach((picker) => picker.addEventListener('change', () => {
    const text = $(picker.id.replace('Native', 'Text'));
    if (text) text.value = picker.type === 'date' ? isoToDate(picker.value) : picker.value;
  }));
  document.querySelectorAll('[data-clear]').forEach((button) => button.addEventListener('click', () => {
    button.dataset.clear.split(',').forEach((id) => { const element = $(id); if (element) element.value = ''; });
  }));

  const updateAttachmentSummary = () => {
    const files = [...(attachments.files || [])];
    attachmentSummary.textContent = files.length
      ? `${files.length} arquivo(s) selecionado(s) — ${(files.reduce((sum, file) => sum + file.size, 0) / 1048576).toFixed(1)} MB`
      : 'Nenhum arquivo selecionado.';
    clearAttachments.classList.toggle('hidden', !files.length);
  };
  attachments.addEventListener('change', updateAttachmentSummary);
  clearAttachments.addEventListener('click', () => { attachments.value = ''; updateAttachmentSummary(); });
  sector.addEventListener('change', updateOriginLabel);
  oxygenRequired.addEventListener('change', () => {
    oxygenDetailsLabel.classList.toggle('hidden', !oxygenRequired.checked);
    oxygenDetails.required = oxygenRequired.checked;
    if (!oxygenRequired.checked) oxygenDetails.value = '';
  });

  const uploadFiles = async () => {
    const paths = [];
    for (const file of [...(attachments.files || [])]) {
      if (file.size > 10485760) throw new Error(`O arquivo ${file.name} ultrapassa 10 MB.`);
      const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const path = `${session.user_id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const response = await fetch(app.apiUrl(`/storage/v1/object/transport-attachments/${encodeURIComponent(path)}`), {
        method: 'POST',
        headers: { apikey: app.SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: file
      });
      if (!response.ok) throw new Error(`Não foi possível enviar ${file.name}.`);
      paths.push(path);
    }
    return paths;
  };

  const loadSettings = async () => {
    const response = await fetch(app.apiUrl('/rest/v1/transport_app_settings?id=eq.1&select=basic_whatsapp,advanced_uti_whatsapp'), { headers: app.authenticatedHeaders(session.access_token) });
    const data = await response.json().catch(() => []);
    return Array.isArray(data) && data[0] ? data[0] : {};
  };
  const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  const imageSize = (data) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = reject; img.src = data; });
  const makeProtocol = () => { const now = new Date(); return `HEURO-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(Date.now()).slice(-5)}`; };
  const originText = (r) => `${r.origin_sector}${r.origin_location ? ` - ${['UTI','Sala Vermelha'].includes(r.origin_sector) ? 'Box' : 'Enfermaria/Leito'} ${r.origin_location}` : ''}`;
  const oxygenText = (r) => r.oxygen_required ? `Sim${r.oxygen_details ? ` - ${r.oxygen_details}` : ''}` : 'Não';
  const fileNames = (r) => [...(r.local_files || [])].map((file) => file.name);

  const buildWhatsappText = (r) => {
    const docs = fileNames(r);
    return `SOLICITAÇÃO DE TRANSPORTE HEURO\n\n` +
      `Protocolo:\n${r.protocol}\n` +
      `Paciente: ${r.patient_name}\n` +
      `Data de nascimento: ${isoToDate(r.birth_date)}\n` +
      `Setor de origem: ${r.origin_sector}\n` +
      `${r.origin_location ? `${['UTI','Sala Vermelha'].includes(r.origin_sector) ? 'Box' : 'Enfermaria/Leito'}: ${r.origin_location}\n` : ''}` +
      `Destino: ${r.destination}\n` +
      `Data e hora no destino: ${isoToDate(r.transport_date)} às ${r.destination_time}\n` +
      `Ambulância: ${labels[r.support_type]}\n` +
      `Prioridade: ${labels[r.priority]}\n` +
      `Motivo: ${labels[r.transfer_reason]}\n` +
      `Oxigênio: ${oxygenText(r)}\n` +
      `Solicitante: ${r.requester_name || 'Não informado'}\n` +
      `${docs.length ? `Documento(s): ${docs.join(', ')}\n` : ''}` +
      `Observações: ${r.observations || 'Sem observações'}\n\n` +
      `Solicitação registrada no aplicativo Transporte HEURO.`;
  };

  const iconColors = {
    protocol: [34, 87, 180], status: [22, 156, 89], patient: [92, 73, 183], birth: [234, 105, 34],
    origin: [40, 132, 166], destination: [220, 53, 69], datetime: [242, 153, 28], ambulance: [25, 118, 210],
    priority: [220, 53, 69], reason: [126, 87, 194], oxygen: [0, 150, 199], requester: [17, 139, 95],
    executor: [75, 85, 99], observations: [72, 102, 173]
  };

  const drawIcon = (doc, type, x, y) => {
    const color = iconColors[type] || [34, 87, 180];
    doc.setFillColor(...color); doc.setDrawColor(...color); doc.roundedRect(x - 5.5, y - 5.5, 11, 11, 2.3, 2.3, 'F');
    doc.setDrawColor(255,255,255); doc.setTextColor(255,255,255); doc.setLineWidth(.75);
    const L = (x1,y1,x2,y2) => doc.line(x1,y1,x2,y2);
    if (type === 'protocol') { doc.rect(x-2.7,y-3.2,5.4,6.7); doc.roundedRect(x-1.5,y-4.2,3,1.6,.4,.4); L(x-1.6,y-.8,x+1.8,y-.8); L(x-1.6,y+1,x+1.8,y+1); }
    else if (type === 'status') { doc.circle(x,y,3.4); L(x-2,y,x-.5,y+1.6); L(x-.5,y+1.6,x+2.3,y-1.8); }
    else if (type === 'patient' || type === 'requester' || type === 'executor') { doc.circle(x,y-2.1,1.7); doc.ellipse(x,y+2,3.1,2.1); }
    else if (type === 'birth' || type === 'datetime') { doc.rect(x-3.3,y-3,6.6,6); L(x-3.3,y-1.2,x+3.3,y-1.2); L(x-1.9,y-4,x-1.9,y-2.3); L(x+1.9,y-4,x+1.9,y-2.3); if(type==='datetime'){doc.circle(x+1.7,y+1.5,1.5);L(x+1.7,y+1.5,x+1.7,y+.5);L(x+1.7,y+1.5,x+2.6,y+1.5);} }
    else if (type === 'origin') { doc.rect(x-3.5,y-3.8,7,7.3); for(let i=-2;i<=2;i+=2){L(x+i,y-2.5,x+i,y-1.4);L(x+i,y-.3,x+i,y+.8);} L(x,y+1.8,x,y+3.5); }
    else if (type === 'destination') { doc.circle(x,y-1.4,2.4); doc.circle(x,y-1.4,.7); L(x-1.8,y+.2,x,y+3.6); L(x+1.8,y+.2,x,y+3.6); }
    else if (type === 'ambulance') { doc.rect(x-4,y-2.7,5.2,4.6); doc.rect(x+1.2,y-.9,2.7,2.8); doc.circle(x-2.5,y+2.4,.9); doc.circle(x+2.4,y+2.4,.9); L(x-1.4,y-.4,x+.2,y-.4); L(x-.6,y-1.2,x-.6,y+.4); }
    else if (type === 'priority') { doc.triangle(x,y-4,x-4,y+3.5,x+4,y+3.5,'S'); L(x,y-1.8,x,y+1); doc.circle(x,y+2.3,.35,'F'); }
    else if (type === 'reason') { L(x-3,y-1.8,x+2,y-1.8); L(x+2,y-1.8,x+.6,y-3.1); L(x+2,y-1.8,x+.6,y-.5); L(x+3,y+1.8,x-2,y+1.8); L(x-2,y+1.8,x-.6,y+.5); L(x-2,y+1.8,x-.6,y+3.1); }
    else if (type === 'oxygen') { doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.text('O2',x,y+2,{align:'center'}); }
    else if (type === 'observations') { doc.roundedRect(x-3.6,y-2.8,7.2,5.2,1.1,1.1); L(x-1.8,y+2.4,x-2.8,y+3.6); L(x-1.8,y-.8,x+1.8,y-.8); L(x-1.8,y+.8,x+.8,y+.8); }
  };

  const drawRow = (doc, { y, type, label, value, maxWidth = 105 }) => {
    doc.setDrawColor(226,231,239); doc.setLineWidth(.35); doc.line(10, y + 14.5, 200, y + 14.5);
    drawIcon(doc, type, 17, y + 7);
    doc.setTextColor(9, 29, 65); doc.setFontSize(11.2); doc.setFont('helvetica','bold'); doc.text(`${label}:`, 27, y + 9);
    doc.setFont('helvetica','normal'); doc.setFontSize(10.8);
    const wrapped = doc.splitTextToSize(String(value || ''), maxWidth);
    doc.text(wrapped, 92, y + 9);
    return Math.max(16, wrapped.length * 5.1 + 8);
  };

  const createPdf = async () => {
    if (!lastRequest) throw new Error('Envie a solicitação antes de gerar o PDF.');
    if (window.HEURO_PDF?.loadJsPdf) await window.HEURO_PDF.loadJsPdf();
    if (!window.jspdf?.jsPDF) throw new Error('O gerador de PDF não foi carregado.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4', compress:true });
    const navy = [5,32,88];
    doc.setTextColor(...navy); doc.setFont('helvetica','bold'); doc.setFontSize(21); doc.text('TRANSPORTE HEURO',105,23,{align:'center'});
    doc.setDrawColor(...navy); doc.setLineWidth(1.1); doc.line(38,28,182,28);

    let y = 34;
    const rows = [
      ['protocol','Protocolo',lastRequest.protocol], ['status','Status','Solicitado'], ['patient','Paciente',lastRequest.patient_name],
      ['birth','Nascimento',isoToDate(lastRequest.birth_date)], ['origin','Origem',originText(lastRequest)], ['destination','Destino',lastRequest.destination],
      ['datetime','Data e hora no destino',`${isoToDate(lastRequest.transport_date)} às ${lastRequest.destination_time}`],
      ['ambulance','Ambulância',labels[lastRequest.support_type]], ['priority','Prioridade',labels[lastRequest.priority]],
      ['reason','Motivo',labels[lastRequest.transfer_reason]], ['oxygen','Oxigênio',oxygenText(lastRequest)],
      ['requester','Solicitante',lastRequest.requester_name], ['executor','Executante','Não definido'],
      ['observations','Observações',lastRequest.observations || 'Sem observações']
    ];
    for (const [type,label,value] of rows) { y += drawRow(doc,{y,type,label,value}); if (y > 282) break; }

    const images = [...(lastRequest.local_files || [])].filter((file) => file.type.startsWith('image/'));
    let index = 1;
    for (const img of images) {
      const data = await fileToDataUrl(img); const size = await imageSize(data); doc.addPage();
      doc.setTextColor(...navy); doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text(`ANEXO ${index}`,105,17,{align:'center'}); doc.setDrawColor(...navy); doc.line(20,22,190,22);
      const maxW=180,maxH=250,ratio=size.width/size.height; let w=maxW,h=w/ratio; if(h>maxH){h=maxH;w=h*ratio;} const x=(210-w)/2, yy=30+(maxH-h)/2;
      doc.addImage(data,img.type.includes('png')?'PNG':'JPEG',x,yy,w,h,undefined,'FAST');
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90); doc.text(img.name,105,288,{align:'center'}); index++;
    }
    return doc;
  };

  const createPdfFile = async () => {
    const doc = await createPdf();
    const fileName = `Transporte HEURO - ${lastRequest.protocol}.pdf`;
    return { doc, file: new File([doc.output('blob')],fileName,{type:'application/pdf'}), fileName };
  };

  sharePdfButton.addEventListener('click', async () => {
    try {
      sharePdfButton.disabled=true; sharePdfButton.textContent='Gerando PDF...';
      const {doc,file,fileName}=await createPdfFile();
      if(navigator.canShare?.({files:[file]})) await navigator.share({files:[file],title:`Transporte HEURO - ${lastRequest.protocol}`}); else doc.save(fileName);
    } catch(error) { if(error?.name!=='AbortError') showMessage(error.message||'Não foi possível gerar o PDF.'); }
    finally { sharePdfButton.disabled=false; sharePdfButton.textContent='Gerar / Compartilhar PDF'; }
  });

  openWhatsappButton.addEventListener('click', async () => {
    try {
      openWhatsappButton.disabled=true; openWhatsappButton.textContent='Preparando PDF e WhatsApp...';
      const settings=await loadSettings();
      const number=lastRequest.support_type==='basico'?settings.basic_whatsapp:settings.advanced_uti_whatsapp;
      if(!number) throw new Error('O número de WhatsApp deste tipo de transporte ainda não foi cadastrado.');
      const text=buildWhatsappText(lastRequest); const {file}=await createPdfFile();
      if(navigator.canShare?.({files:[file]})) {
        await navigator.share({files:[file],title:`Transporte HEURO - ${lastRequest.protocol}`,text});
        showMessage('PDF e resumo preparados. Selecione o WhatsApp e confirme o contato do transporte.',true);
      } else {
        const phone=String(number).replace(/\D/g,''); location.href=`https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      }
    } catch(error) { if(error?.name!=='AbortError') showMessage(error.message||'Não foi possível abrir o WhatsApp.'); }
    finally { openWhatsappButton.disabled=false; openWhatsappButton.textContent='Enviar PDF pelo WhatsApp'; }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); message.className='message'; postActions.classList.add('hidden');
    const bd=$('birthDateText'), td=$('transportDateText'), ti=$('destinationTimeText');
    const birth=dateToIso(bd.value), transport=dateToIso(td.value), time=normalizeTime(ti.value);
    bd.setCustomValidity(birth?'':'Informe uma data válida.'); td.setCustomValidity(transport?'':'Informe uma data válida.'); ti.setCustomValidity(time?'':'Informe um horário válido.');
    if(!form.reportValidity()) return;
    submitButton.disabled=true; submitButton.textContent='Enviando...';
    try {
      const files=[...(attachments.files||[])];
      const payload={requester_id:session.user_id,requester_name:session.display_name||'Usuário',support_type:$('supportType').value,priority:$('priority').value,priority_rank:priorityRank[$('priority').value],patient_name:$('patientName').value.trim(),birth_date:birth,origin_sector:sector.value,origin_location:locationInput.value.trim()||null,destination:$('destination').value.trim(),transport_date:transport,destination_time:time,oxygen_required:oxygenRequired.checked,oxygen_details:oxygenDetails.value.trim()||null,transfer_reason:$('transferReason').value,observations:$('observations').value.trim()||null,attachment_paths:await uploadFiles()};
      const response=await fetch(app.apiUrl('/rest/v1/transport_requests'),{method:'POST',headers:{...app.authenticatedHeaders(session.access_token),Prefer:'return=representation'},body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>null); if(!response.ok) throw new Error(data?.message||'Não foi possível registrar a solicitação.');
      lastRequest={...payload,id:Array.isArray(data)&&data[0]?.id?data[0].id:null,protocol:makeProtocol(),local_files:files};
      showMessage('Solicitação enviada com sucesso. Agora você pode gerar o PDF ou enviar pelo WhatsApp.',true); postActions.classList.remove('hidden'); window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
    } catch(error) { showMessage(error.message||'Falha ao enviar a solicitação.'); }
    finally { submitButton.disabled=false; submitButton.textContent='Enviar solicitação'; }
  });

  updateAttachmentSummary(); updateOriginLabel();
})();