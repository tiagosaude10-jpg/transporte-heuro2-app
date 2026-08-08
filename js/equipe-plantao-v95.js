(() => {
  'use strict';
  const app=window.HEURO; let session=app?.readSession?.();
  if(!app||!session?.access_token||!session?.user_id){location.replace('./login.html');return;}
  const $=id=>document.getElementById(id), headers=()=>app.authenticatedHeaders(session.access_token);
  const state={isAdmin:false,driverRequired:true,vehicles:[],profiles:[],assignments:[]};
  const roles={medico:'Médico',enfermagem:'Enfermagem',motorista:'Motorista'};
  const vehicleOrder={'UTI-01':0,'BASICA-01':1,'BASICA-02':2};
  const roleForJob=job=>{const j=String(job||'').toLowerCase();if(j.includes('médic')||j.includes('medic'))return'medico';if(j.includes('enfermeir')||j.includes('técnic')&&j.includes('enferm')||j.includes('tecnic')&&j.includes('enferm')||j.includes('auxiliar')&&j.includes('enferm'))return'enfermagem';if(j.includes('motorista')||j.includes('condutor'))return'motorista';return null};
  const localDate=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Porto_Velho',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));let date=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00-04:00`);if(Number(parts.hour)<7)date.setDate(date.getDate()-1);return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Porto_Velho',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)};
  const moveDate=days=>{const d=new Date(`${$('shiftDate').value}T12:00:00-04:00`);d.setDate(d.getDate()+days);$('shiftDate').value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Porto_Velho',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);loadRoster()};
  const api=async(path,options={})=>{const response=await fetch(app.apiUrl(path),{...options,headers:{...headers(),...(options.headers||{})},cache:'no-store'});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.message||data?.hint||'Não foi possível concluir a operação.');return data};
  const show=(text,ok=false)=>{const el=$('message');el.textContent=text;el.className=`message${ok?' ok':''}`;el.hidden=false;setTimeout(()=>{el.hidden=true},4500)};
  const requiredRoles=vehicle=>vehicle.support_type==='avancado_uti'?['medico','enfermagem',...(state.driverRequired?['motorista']:[])]:['enfermagem',...(state.driverRequired?['motorista']:[])];
  const displayedRoles=vehicle=>Array.from(new Set([...requiredRoles(vehicle),'motorista']));
  const assignmentFor=(vehicleId,role)=>state.assignments.find(a=>a.vehicle_id===vehicleId&&a.professional_role===role);
  const profileOptions=role=>state.profiles.filter(p=>roleForJob(p.job_role)===role).map(p=>`<option value="${p.id}">${escapeHtml(p.display_name||p.full_name)} — ${escapeHtml(p.job_role)}</option>`).join('');
  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function render(){
    const cards=state.vehicles.sort((a,b)=>vehicleOrder[a.code]-vehicleOrder[b.code]).map(vehicle=>{
      const isUti=vehicle.support_type==='avancado_uti';
      const assignments=displayedRoles(vehicle).map(role=>{
        const current=assignmentFor(vehicle.id,role), optional=role==='motorista'&&!state.driverRequired;
        if(state.isAdmin){return `<div class="assignment"><label>${roles[role]}${optional?' (opcional)':' *'}</label><select data-vehicle="${vehicle.id}" data-role="${role}"><option value="">${optional?'Não informado':'Selecione'}</option>${profileOptions(role)}</select></div>`}
        return current?`<div class="person"><strong>${escapeHtml(current.user_name)}</strong><span>${roles[role]}</span></div>`:(optional?'':`<div class="empty">${roles[role]} não informado</div>`);
      }).join('');
      return `<article class="vehicle-card${isUti?' uti':''}"><header class="vehicle-card__head"><span class="vehicle-card__icon">${isUti?'✚':'🚑'}</span><div><h2>${escapeHtml(vehicle.display_name)}</h2><small>${isUti?'Suporte avançado':'Suporte básico'}</small></div><span class="badge">${state.assignments.some(a=>a.vehicle_id===vehicle.id)?'Equipe definida':'Aguardando'}</span></header><div class="assignments">${assignments||'<div class="empty">Equipe ainda não cadastrada.</div>'}</div></article>`;
    }).join('');
    $('vehicleCards').innerHTML=cards;
    if(state.isAdmin){document.querySelectorAll('select[data-role]').forEach(select=>{const current=assignmentFor(select.dataset.vehicle,select.dataset.role);select.value=current?.user_id||''})}
    const hasRoster=state.assignments.length>0;$('statusBanner').textContent=hasRoster?`Equipe cadastrada para ${formatDate($('shiftDate').value)} — plantão das 07h às 07h.`:`Nenhuma equipe cadastrada para ${formatDate($('shiftDate').value)}.`;$('statusBanner').classList.toggle('active',hasRoster);
    $('adminActions').hidden=!state.isAdmin;$('driverRule').textContent=state.driverRequired?'Motorista obrigatório: cada ambulância precisa ter um motorista escalado.':'Motorista opcional: esta regra pode ser alterada nas Configurações do sistema.';
  }
  const formatDate=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Porto_Velho'}).format(new Date(`${value}T12:00:00-04:00`));
  async function loadRoster(){
    $('statusBanner').textContent='Carregando equipe...';$('vehicleCards').innerHTML='';
    try{const date=$('shiftDate').value;const roster=await api(`/rest/v1/transport_shift_rosters?shift_date=eq.${date}&select=id,shift_date,driver_required,transport_shift_assignments(id,vehicle_id,user_id,user_name,professional_role)`);const row=roster?.[0];state.assignments=row?.transport_shift_assignments||[];if(row)state.driverRequired=row.driver_required;else{const settings=await api('/rest/v1/transport_app_settings?id=eq.1&select=driver_report_enabled');state.driverRequired=settings?.[0]?.driver_report_enabled!==false}render()}catch(error){$('statusBanner').textContent=error.message;show(error.message)}
  }
  async function init(){
    try{const profiles=await api(`/rest/v1/profiles?id=eq.${session.user_id}&select=id,display_name,status,authorized_access,job_role`);const profile=profiles?.[0];if(!profile||profile.status!=='aprovado')throw new Error('Acesso não autorizado.');session={...session,access:profile.authorized_access,display_name:profile.display_name};app.saveSession(session);state.isAdmin=profile.authorized_access==='administrador_geral';const vehiclesPromise=api('/rest/v1/transport_vehicles?active=eq.true&code=in.(BASICA-01,BASICA-02,UTI-01)&select=id,code,display_name,support_type,active');const profilesPromise=state.isAdmin?api('/rest/v1/profiles?status=eq.aprovado&authorized_access=in.(executante,solicitante_executante,administrador_geral)&select=id,display_name,full_name,job_role,authorized_access&order=display_name.asc'):Promise.resolve([]);[state.vehicles,state.profiles]=await Promise.all([vehiclesPromise,profilesPromise]);$('shiftDate').value=localDate();await loadRoster()}catch(error){app.clearSession();location.replace('./login.html?motivo=sessao_invalida')}
  }
  $('previousDay').addEventListener('click',()=>moveDate(-1));$('nextDay').addEventListener('click',()=>moveDate(1));$('shiftDate').addEventListener('change',loadRoster);
  $('saveRoster').addEventListener('click',async()=>{const button=$('saveRoster');button.disabled=true;button.textContent='Salvando...';try{const assignments=[];document.querySelectorAll('select[data-role]').forEach(select=>{if(select.value)assignments.push({vehicle_id:select.dataset.vehicle,user_id:select.value,professional_role:select.dataset.role})});await api('/rest/v1/rpc/save_transport_shift_roster',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_shift_date:$('shiftDate').value,p_assignments:assignments})});show('Equipe do plantão salva com sucesso.',true);await loadRoster()}catch(error){show(error.message)}finally{button.disabled=false;button.textContent='Salvar equipe do plantão'}});
  init();app.clearLegacyCaches().catch(()=>{});
})();
