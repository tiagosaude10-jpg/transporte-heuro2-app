(() => {
  'use strict';
  const app = window.HEURO;
  const session = app?.readSession?.();
  if (!app || !session?.access_token || !session?.user_id) { location.replace('./login.html'); return; }
  if (!['solicitante','solicitante_executante','administrador_geral'].includes(session.access)) { location.replace('./comando.html?motivo=sem_permissao_solicitar'); return; }

  const $ = (id) => document.getElementById(id);
  const form = $('transportForm'), sector = $('originSector'), locationLabel = $('originLocationLabel'), locationInput = $('originLocation');
  const oxygenRequired = $('oxygenRequired'), oxygenDetailsLabel = $('oxygenDetailsLabel'), oxygenDetails = $('oxygenDetails');
  const attachments = $('attachments'), attachmentSummary = $('attachmentSummary'), clearAttachments = $('clearAttachments');
  const submitButton = $('submitButton'), message = $('formMessage'), postActions = $('postActions');
  const sharePdfButton = $('sharePdfButton'), openWhatsappButton = $('openWhatsappButton');
  const priorityRank = Object.freeze({ emergencia:1, urgencia:2, eletivo:3 });
  const labels = {
    basico:'Suporte Básico', avancado_uti:'Suporte Avançado / UTI',
    emergencia:'Emergência', urgencia:'Urgência', eletivo:'Eletivo',
    transferencia:'Transferência', exame_procedimento:'Exame/Procedimento', consulta:'Consulta'
  };
  let lastRequest = null;

  const showMessage = (text, ok=false) => { message.textContent=text; message.className=`message ${ok?'ok':'error'}`; };
  const updateOriginLabel = () => { const box=['UTI','Sala Vermelha'].includes(sector.value); locationLabel.firstChild.textContent=box?'Box':'Enfermaria / Leito'; locationInput.placeholder=box?'Informe o box':'Informe a enfermaria e o leito'; };
  const maskDate = (v) => { const d=v.replace(/\D/g,'').slice(0,8); return d.length<=2?d:d.length<=4?`${d.slice(0,2)}/${d.slice(2)}`:`${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`; };
  const maskTime = (v) => { const d=v.replace(/\D/g,'').slice(0,4); return d.length<=2?d:`${d.slice(0,2)}:${d.slice(2)}`; };
  const dateToIso = (v) => { const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); if(!m)return null; const [,d,mo,y]=m, dt=new Date(+y,+mo-1,+d); return dt.getFullYear()===+y&&dt.getMonth()===+mo-1&&dt.getDate()===+d?`${y}-${mo}-${d}`:null; };
  const isoToDate = (v) => { const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||''); return m?`${m[3]}/${m[2]}/${m[1]}`:''; };
  const normalizeTime = (v) => { const m=/^(\d{2}):(\d{2})$/.exec(v); return m&&+m[1]<24&&+m[2]<60?v:null; };

  document.querySelectorAll('.manual').forEach(i=>i.addEventListener('input',()=>{i.value=i.id.includes('Time')?maskTime(i.value):maskDate(i.value);i.setCustomValidity('');}));
  document.querySelectorAll('[data-picker]').forEach(b=>b.addEventListener('click',()=>{const p=$(b.dataset.picker); if(typeof p?.showPicker==='function')p.showPicker(); else p?.click();}));
  document.querySelectorAll('.native-picker').forEach(p=>p.addEventListener('change',()=>{const t=$(p.id.replace('Native','Text')); if(t)t.value=p.type==='date'?isoToDate(p.value):p.value;}));
  document.querySelectorAll('[data-clear]').forEach(b=>b.addEventListener('click',()=>b.dataset.clear.split(',').forEach(id=>{const e=$(id);if(e)e.value='';})));

  const updateAttachmentSummary=()=>{const f=[...(attachments.files||[])]; attachmentSummary.textContent=f.length?`${f.length} arquivo(s) selecionado(s) — ${(f.reduce((s,x)=>s+x.size,0)/1048576).toFixed(1)} MB`:'Nenhum arquivo selecionado.'; clearAttachments.classList.toggle('hidden',!f.length);};
  attachments.addEventListener('change',updateAttachmentSummary); clearAttachments.addEventListener('click',()=>{attachments.value='';updateAttachmentSummary();});
  sector.addEventListener('change',updateOriginLabel); oxygenRequired.addEventListener('change',()=>{oxygenDetailsLabel.classList.toggle('hidden',!oxygenRequired.checked);oxygenDetails.required=oxygenRequired.checked;if(!oxygenRequired.checked)oxygenDetails.value='';});

  const uploadFiles=async()=>{const paths=[];for(const file of [...(attachments.files||[])]){if(file.size>10485760)throw new Error(`O arquivo ${file.name} ultrapassa 10 MB.`);const ext=(file.name.split('.').pop()||'bin').replace(/[^a-z0-9]/gi,'').toLowerCase();const path=`${session.user_id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;const r=await fetch(app.apiUrl(`/storage/v1/object/transport-attachments/${encodeURIComponent(path)}`),{method:'POST',headers:{apikey:app.SUPABASE_KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(!r.ok)throw new Error(`Não foi possível enviar ${file.name}.`);paths.push(path);}return paths;};
  const loadSettings=async()=>{const r=await fetch(app.apiUrl('/rest/v1/transport_app_settings?id=eq.1&select=basic_whatsapp,advanced_uti_whatsapp'),{headers:app.authenticatedHeaders(session.access_token)});const d=await r.json().catch(()=>[]);return Array.isArray(d)&&d[0]?d[0]:{};};
  const fileToDataUrl=(file)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
  const imageSize=(data)=>new Promise((res,rej)=>{const img=new Image();img.onload=()=>res({width:img.naturalWidth,height:img.naturalHeight});img.onerror=rej;img.src=data;});
  const makeProtocol=()=>{const now=new Date();const y=now.getFullYear();const m=String(now.getMonth()+1).padStart(2,'0');const d=String(now.getDate()).padStart(2,'0');return `HEURO-${y}${m}${d}-${String(Date.now()).slice(-5)}`;};
  const originText=(r)=>`${r.origin_sector}${r.origin_location?` - ${['UTI','Sala Vermelha'].includes(r.origin_sector)?'Box':'Enfermaria/Leito'} ${r.origin_location}`:''}`;
  const oxygenText=(r)=>r.oxygen_required?`Sim${r.oxygen_details?` - ${r.oxygen_details}`:''}`:'Não';
  const fileNames=(r)=>[...(r.local_files||[])].map(f=>f.name);

  const buildWhatsappText=(r)=>{
    const docs=fileNames(r);
    return `SOLICITAÇÃO DE TRANSPORTE HEURO\n\n`+
      `Protocolo:\n${r.protocol}\n`+
      `Paciente: ${r.patient_name}\n`+
      `Data de nascimento: ${isoToDate(r.birth_date)}\n`+
      `Setor de origem: ${r.origin_sector}\n`+
      `${r.origin_location?`${['UTI','Sala Vermelha'].includes(r.origin_sector)?'Box':'Enfermaria/Leito'}: ${r.origin_location}\n`:''}`+
      `Destino: ${r.destination}\n`+
      `Data: ${isoToDate(r.transport_date)} às ${r.destination_time}\n`+
      `Ambulância: ${labels[r.support_type]}\n`+
      `Prioridade: ${labels[r.priority]}\n`+
      `Motivo: ${labels[r.transfer_reason]}\n`+
      `Oxigênio: ${oxygenText(r)}\n`+
      `Solicitante: ${r.requester_name || 'Não informado'}\n`+
      `${docs.length?`Documento(s): ${docs.join(', ')}\n`:''}`+
      `Observações: ${r.observations||'Sem observações'}\n\n`+
      `Solicitação registrada no aplicativo Transporte HEURO.`;
  };

  const drawRow=(doc,{y,icon,label,value,maxWidth=121})=>{
    const navy=[5,32,88];
    doc.setDrawColor(225,229,236);doc.setLineWidth(.35);doc.line(10,y+14.5,200,y+14.5);
    doc.setDrawColor(...navy);doc.setLineWidth(.8);doc.circle(16,y+7,4.6);
    doc.setTextColor(...navy);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text(icon,16,y+8.5,{align:'center'});
    doc.setTextColor(0,0,0);doc.setFontSize(11.5);doc.setFont('helvetica','bold');doc.text(`${label}:`,28,y+9);
    doc.setFont('helvetica','normal');doc.setFontSize(11);const wrapped=doc.splitTextToSize(String(value||''),maxWidth);doc.text(wrapped,88,y+9);
    return Math.max(16,wrapped.length*5.2+8);
  };

  const createPdf=async()=>{
    if(!lastRequest)throw new Error('Envie a solicitação antes de gerar o PDF.');
    if(window.HEURO_PDF?.loadJsPdf) await window.HEURO_PDF.loadJsPdf();
    if(!window.jspdf?.jsPDF)throw new Error('O gerador de PDF não foi carregado.');
    const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
    const navy=[5,32,88];
    doc.setTextColor(...navy);doc.setFont('helvetica','bold');doc.setFontSize(21);doc.text('TRANSPORTE HEURO',105,23,{align:'center'});
    doc.setDrawColor(...navy);doc.setLineWidth(1.1);doc.line(38,28,182,28);

    let y=34;
    const rows=[
      ['PR','Protocolo',lastRequest.protocol],['ST','Status','Solicitado'],['PA','Paciente',lastRequest.patient_name],
      ['DN','Nascimento',isoToDate(lastRequest.birth_date)],['OR','Origem',originText(lastRequest)],['DE','Destino',lastRequest.destination],
      ['DH','Data e hora',`${isoToDate(lastRequest.transport_date)} às ${lastRequest.destination_time}`],['AM','Ambulância',labels[lastRequest.support_type]],
      ['PI','Prioridade',labels[lastRequest.priority]],['MO','Motivo',labels[lastRequest.transfer_reason]],['O2','Oxigênio',oxygenText(lastRequest)],
      ['SO','Solicitante',lastRequest.requester_name],['EX','Executante','Não definido'],['OB','Observações',lastRequest.observations||'Sem observações']
    ];
    for(const [icon,label,value] of rows){const h=drawRow(doc,{y,icon,label,value});y+=h;if(y>282)break;}

    const images=[...(lastRequest.local_files||[])].filter(f=>f.type.startsWith('image/'));
    let index=1;
    for(const img of images){
      const data=await fileToDataUrl(img);const size=await imageSize(data);doc.addPage();
      doc.setTextColor(...navy);doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text(`ANEXO ${index}`,105,17,{align:'center'});doc.setDrawColor(...navy);doc.line(20,22,190,22);
      const maxW=180,maxH=250,ratio=size.width/size.height;let w=maxW,h=w/ratio;if(h>maxH){h=maxH;w=h*ratio;}const x=(210-w)/2;const yy=30+(maxH-h)/2;
      doc.addImage(data,img.type.includes('png')?'PNG':'JPEG',x,yy,w,h,undefined,'FAST');
      doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(90);doc.text(img.name,105,288,{align:'center'});index++;
    }
    return doc;
  };

  const createPdfFile=async()=>{
    const doc=await createPdf();
    const fileName=`Transporte HEURO - ${lastRequest.protocol}.pdf`;
    const file=new File([doc.output('blob')],fileName,{type:'application/pdf'});
    return {doc,file,fileName};
  };

  sharePdfButton.addEventListener('click',async()=>{
    try{
      sharePdfButton.disabled=true;sharePdfButton.textContent='Gerando PDF...';
      const {doc,file,fileName}=await createPdfFile();
      if(navigator.canShare?.({files:[file]})) await navigator.share({files:[file],title:`Transporte HEURO - ${lastRequest.protocol}`});
      else doc.save(fileName);
    }catch(e){if(e?.name!=='AbortError')showMessage(e.message||'Não foi possível gerar o PDF.');}
    finally{sharePdfButton.disabled=false;sharePdfButton.textContent='Gerar / Compartilhar PDF';}
  });

  openWhatsappButton.addEventListener('click',async()=>{
    try{
      openWhatsappButton.disabled=true;openWhatsappButton.textContent='Preparando PDF e WhatsApp...';
      const settings=await loadSettings();
      const number=lastRequest.support_type==='basico'?settings.basic_whatsapp:settings.advanced_uti_whatsapp;
      if(!number)throw new Error('O número de WhatsApp deste tipo de transporte ainda não foi cadastrado.');
      const text=buildWhatsappText(lastRequest);
      const {file}=await createPdfFile();

      if(navigator.canShare?.({files:[file]})){
        await navigator.share({files:[file],title:`Transporte HEURO - ${lastRequest.protocol}`,text});
        showMessage('PDF e resumo preparados. Selecione o WhatsApp e confirme o contato do transporte.',true);
      }else{
        const phone=String(number).replace(/\D/g,'');
        location.href=`https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      }
    }catch(e){if(e?.name!=='AbortError')showMessage(e.message||'Não foi possível abrir o WhatsApp.');}
    finally{openWhatsappButton.disabled=false;openWhatsappButton.textContent='Abrir WhatsApp do transporte';}
  });

  form.addEventListener('submit',async(event)=>{
    event.preventDefault();message.className='message';postActions.classList.add('hidden');
    const bd=$('birthDateText'),td=$('transportDateText'),ti=$('destinationTimeText');const birth=dateToIso(bd.value),transport=dateToIso(td.value),time=normalizeTime(ti.value);
    bd.setCustomValidity(birth?'':'Informe uma data válida.');td.setCustomValidity(transport?'':'Informe uma data válida.');ti.setCustomValidity(time?'':'Informe um horário válido.');if(!form.reportValidity())return;
    submitButton.disabled=true;submitButton.textContent='Enviando...';
    try{
      const files=[...(attachments.files||[])];const payload={requester_id:session.user_id,requester_name:session.display_name||'Usuário',support_type:$('supportType').value,priority:$('priority').value,priority_rank:priorityRank[$('priority').value],patient_name:$('patientName').value.trim(),birth_date:birth,origin_sector:sector.value,origin_location:locationInput.value.trim()||null,destination:$('destination').value.trim(),transport_date:transport,destination_time:time,oxygen_required:oxygenRequired.checked,oxygen_details:oxygenDetails.value.trim()||null,transfer_reason:$('transferReason').value,observations:$('observations').value.trim()||null,attachment_paths:await uploadFiles()};
      const r=await fetch(app.apiUrl('/rest/v1/transport_requests'),{method:'POST',headers:{...app.authenticatedHeaders(session.access_token),Prefer:'return=representation'},body:JSON.stringify(payload)});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.message||'Não foi possível registrar a solicitação.');
      lastRequest={...payload,id:Array.isArray(d)&&d[0]?.id?d[0].id:null,protocol:makeProtocol(),local_files:files};
      showMessage('Solicitação enviada com sucesso. Agora você pode gerar o PDF ou enviar pelo WhatsApp.',true);postActions.classList.remove('hidden');window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
    }catch(e){showMessage(e.message||'Falha ao enviar a solicitação.');}
    finally{submitButton.disabled=false;submitButton.textContent='Enviar solicitação';}
  });
  updateAttachmentSummary();updateOriginLabel();
})();