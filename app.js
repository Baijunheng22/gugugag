const STORE_KEY = 'shengzhang-mobile-v1';
const emptyDB = () => ({ version: 1, projects: [], recordings: [], settlements: [] });
let db = loadDB();
let pendingImports = [];
let installPrompt = null;

function loadDB(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return emptyDB();
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      recordings: Array.isArray(parsed.recordings) ? parsed.recordings : [],
      settlements: Array.isArray(parsed.settlements) ? parsed.settlements : []
    };
  }catch{ return emptyDB(); }
}
function persist(){ localStorage.setItem(STORE_KEY, JSON.stringify(db)); renderAll(); }
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function esc(v=''){ return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function today(){ const d = new Date(); const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function monthKey(){ return today().slice(0,7); }
function money(v){ return `¥${Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2})}`; }
function duration(sec){
  sec = Math.max(0, Math.round(Number(sec||0)));
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  if(h) return `${h}小时${m}分`;
  if(m) return `${m}分${s ? `${s}秒` : ''}`;
  return `${s}秒`;
}
function toast(msg){ const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),1800); }
function projectById(id){ return db.projects.find(p=>p.id===id); }
function projectRecords(id){ return db.recordings.filter(r=>r.projectId===id); }
function projectSettlements(id){ return db.settlements.filter(s=>s.projectId===id); }

function projectStats(p){
  const records = projectRecords(p.id);
  const settlements = projectSettlements(p.id);
  const sec = records.reduce((n,r)=>n+Number(r.duration||0),0);
  const earned = sec/3600 * Number(p.rate||0);
  const received = settlements.reduce((n,s)=>n+Number(s.amount||0),0);
  const progress = records.reduce((mx,r)=>Math.max(mx,Number(r.endEpisode||0)),0);
  const settledThrough = settlements.reduce((mx,s)=>Math.max(mx,Number(s.settledThrough||0)),0);
  let settlementStatus = '未结算';
  if(settlements.length){ settlementStatus = progress > 0 && settledThrough >= progress ? '已结清' : '部分结算'; }
  return { sec, earned, received, unpaid: Math.max(0, earned-received), progress, settledThrough, settlementStatus };
}
function settlementBadge(status){
  if(status==='已结清') return 'green';
  if(status==='部分结算') return 'orange';
  return 'red';
}
function projectCard(p){
  const s=projectStats(p);
  return `<button class="project-card" type="button" data-open-project="${p.id}">
    <div class="project-top">
      <div>
        <div class="project-title">《${esc(p.title)}》</div>
        <div class="project-meta">${esc(p.client||'未填写甲方')} · ${esc(p.platform||'其他')} · ${esc(p.roleType||'')} ${esc(p.roleName||'')}</div>
      </div>
      <div class="project-progress">${s.progress ? `${s.progress} 集` : '未导入'}</div>
    </div>
    <div class="project-finance">
      <div><span>累计时长</span><b>${duration(s.sec)}</b></div>
      <div><span>累计应收</span><b>${money(s.earned)}</b></div>
      <div><span>未收</span><b>${money(s.unpaid)}</b></div>
    </div>
    <div class="badges"><span class="badge ${settlementBadge(s.settlementStatus)}">${s.settlementStatus}</span><span class="badge">${esc(p.status)}</span></div>
  </button>`;
}
function renderSummary(targetId, records){
  const sec=records.reduce((n,r)=>n+Number(r.duration||0),0);
  const earned=records.reduce((n,r)=>{ const p=projectById(r.projectId); return n + (Number(r.duration||0)/3600 * Number(p?.rate||0)); },0);
  document.getElementById(targetId).innerHTML = `
    <div class="summary-card"><div class="summary-label">今日成品</div><div class="summary-value">${duration(db.recordings.filter(r=>r.recordDate===today()).reduce((n,r)=>n+Number(r.duration||0),0))}</div><div class="summary-sub">今天导入</div></div>
    <div class="summary-card"><div class="summary-label">今日应收</div><div class="summary-value">${money(db.recordings.filter(r=>r.recordDate===today()).reduce((n,r)=>{const p=projectById(r.projectId);return n+Number(r.duration||0)/3600*Number(p?.rate||0)},0))}</div><div class="summary-sub">按项目单价</div></div>
    <div class="summary-card"><div class="summary-label">本月成品</div><div class="summary-value">${duration(sec)}</div><div class="summary-sub">本月累计</div></div>
    <div class="summary-card"><div class="summary-label">本月应收</div><div class="summary-value">${money(earned)}</div><div class="summary-sub">本月累计</div></div>`;
}
function renderHome(){
  const monthRecords=db.recordings.filter(r=>r.recordDate.startsWith(monthKey()));
  renderSummary('homeSummary',monthRecords);
  const active=db.projects.filter(p=>p.status==='连载中');
  document.getElementById('activeProjectList').innerHTML=active.length?active.map(projectCard).join(''):'<div class="empty">还没有连载中的书。</div>';
  const todayRecords=[...db.recordings].filter(r=>r.recordDate===today()).sort((a,b)=>b.importedAt.localeCompare(a.importedAt));
  document.getElementById('todayRecordList').innerHTML=todayRecords.length?todayRecords.map(recordCard).join(''):'<div class="empty">今天还没有导入正式成品。</div>';
}
function recordCard(r){
  const p=projectById(r.projectId); const amount=Number(r.duration||0)/3600*Number(p?.rate||0);
  return `<div class="record-card"><div><strong>《${esc(p?.title||'未知项目')}》 ${r.startEpisode}-${r.endEpisode} 集</strong><div class="record-meta">${esc(r.fileName)}</div></div><div class="record-right"><b>${duration(r.duration)}</b><span>${money(amount)}</span></div></div>`;
}
function renderBooks(){
  const list=[...db.projects].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  document.getElementById('allProjectList').innerHTML=list.length?list.map(projectCard).join(''):'<div class="empty">先新建一本书，再导入它的正式成品。</div>';
}
function renderStats(){
  const monthRecords=db.recordings.filter(r=>r.recordDate.startsWith(monthKey()));
  renderSummary('statsSummary',monthRecords);
  const rows=db.projects.map(p=>{const rs=monthRecords.filter(r=>r.projectId===p.id);if(!rs.length)return null;const sec=rs.reduce((n,r)=>n+Number(r.duration||0),0);return{p,sec,earned:sec/3600*Number(p.rate||0)}}).filter(Boolean).sort((a,b)=>b.sec-a.sec);
  document.getElementById('monthProjectStats').innerHTML=rows.length?rows.map(x=>`<div class="record-card"><div><strong>《${esc(x.p.title)}》</strong><div class="record-meta">${duration(x.sec)}</div></div><div class="record-right"><b>${money(x.earned)}</b></div></div>`).join(''):'<div class="empty">本月还没有成品记录。</div>';
}
function renderAll(){ renderHome(); renderBooks(); renderStats(); bindProjectCards(); }
function bindProjectCards(){ document.querySelectorAll('[data-open-project]').forEach(btn=>btn.onclick=()=>openProjectDetail(btn.dataset.openProject)); }

function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));

function openSheet(id){ const el=document.getElementById(id); el.classList.add('open'); el.setAttribute('aria-hidden','false'); }
function closeSheet(id){ const el=document.getElementById(id); el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeSheet(btn.dataset.close)));
document.querySelectorAll('.sheet-backdrop').forEach(bg=>bg.addEventListener('click',e=>{ if(e.target===bg) closeSheet(bg.id); }));

function openProjectForm(id=null){
  const p=id?projectById(id):null;
  document.getElementById('projectSheetTitle').textContent=p?'编辑有声书':'新建有声书';
  projectId.value=p?.id||'';
  projectTitle.value=p?.title||'';
  projectAliases.value=(p?.aliases||[]).join('，');
  projectClient.value=p?.client||'';
  projectPlatform.value=p?.platform||'其他';
  projectStatus.value=p?.status||'连载中';
  projectRoleType.value=p?.roleType||'男主';
  projectRoleName.value=p?.roleName||'';
  projectRate.value=p?.rate??'';
  openSheet('projectSheet');
}
document.getElementById('newProjectBtn').onclick=()=>openProjectForm();
document.getElementById('newProjectFromHome').onclick=()=>openProjectForm();

document.getElementById('projectForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=projectId.value;
  const aliases=projectAliases.value.split(/[，,、;；]/).map(x=>x.trim()).filter(Boolean);
  if(!aliases.length){ toast('至少填一个文件名简称'); return; }
  const collision=db.projects.find(p=>p.id!==id&&(p.aliases||[]).some(a=>aliases.some(x=>x.toLowerCase()===String(a).toLowerCase())));
  if(collision){ toast(`简称和《${collision.title}》重复了`); return; }
  const data={title:projectTitle.value.trim(),aliases,client:projectClient.value.trim(),platform:projectPlatform.value,status:projectStatus.value,roleType:projectRoleType.value,roleName:projectRoleName.value.trim(),rate:Number(projectRate.value||0)};
  if(id) Object.assign(projectById(id),data); else db.projects.push({id:uid(),createdAt:new Date().toISOString(),...data});
  persist(); closeSheet('projectSheet'); toast(id?'项目已更新':'项目已建立');
});

function openProjectDetail(id){
  const p=projectById(id); if(!p) return;
  const s=projectStats(p);
  const settlements=[...projectSettlements(id)].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const records=[...projectRecords(id)].sort((a,b)=>b.recordDate.localeCompare(a.recordDate)||b.importedAt.localeCompare(a.importedAt));
  const detail=document.getElementById('projectDetail');
  detail.innerHTML=`
    <div class="detail-head"><div><div class="detail-title" id="detailTitle">《${esc(p.title)}》</div><div class="detail-sub">简称：${esc((p.aliases||[]).join(' / '))}</div></div><button class="close-btn" type="button" data-detail-close>关闭</button></div>
    <div class="detail-summary">
      <div class="detail-stat"><span>当前进度</span><b>${s.progress?s.progress+' 集':'—'}</b></div>
      <div class="detail-stat"><span>累计成品</span><b>${duration(s.sec)}</b></div>
      <div class="detail-stat"><span>累计应收</span><b>${money(s.earned)}</b></div>
      <div class="detail-stat"><span>未收金额</span><b>${money(s.unpaid)}</b></div>
    </div>
    <div class="info-card">甲方：${esc(p.client||'未填写')}<br>平台：${esc(p.platform||'其他')}<br>角色：${esc(p.roleType||'')} ${esc(p.roleName||'')}<br>单价：${money(p.rate)} / 成品小时<br>项目状态：${esc(p.status)}<br>结算状态：${s.settlementStatus}${s.settledThrough?` · 已结算至 ${s.settledThrough} 集`:''}<br>已收：${money(s.received)}</div>
    <button class="primary-wide" type="button" data-settle-project="${p.id}">新增结算</button>
    <div class="detail-actions"><button class="secondary-btn" type="button" data-edit-project="${p.id}">编辑项目</button><button class="danger-btn" type="button" data-delete-project="${p.id}">删除项目</button></div>
    <div class="detail-section"><h4>结算记录</h4>${settlements.length?settlements.map(x=>`<div class="settlement-row"><div><strong>结算至 ${x.settledThrough} 集</strong><div class="row-sub">${x.date}</div></div><div class="row-amount">${money(x.amount)}<button class="row-delete" data-delete-settlement="${x.id}" type="button">删除</button></div></div>`).join(''):'<div class="empty">还没有结算记录。</div>'}</div>
    <div class="detail-section"><h4>录音记录</h4>${records.length?records.map(r=>`<div class="detail-record-row"><div><strong>${r.startEpisode}-${r.endEpisode} 集</strong><div class="row-sub">${esc(r.fileName)} · ${r.recordDate}</div></div><div class="row-amount">${duration(r.duration)}<button class="row-delete" data-delete-record="${r.id}" type="button">删除</button></div></div>`).join(''):'<div class="empty">还没有正式成品。</div>'}</div>`;
  detail.querySelector('[data-detail-close]').onclick=()=>closeSheet('detailSheet');
  detail.querySelector('[data-settle-project]').onclick=()=>openSettlement(id);
  detail.querySelector('[data-edit-project]').onclick=()=>{closeSheet('detailSheet');openProjectForm(id)};
  detail.querySelector('[data-delete-project]').onclick=()=>deleteProject(id);
  detail.querySelectorAll('[data-delete-settlement]').forEach(b=>b.onclick=()=>deleteSettlement(b.dataset.deleteSettlement,id));
  detail.querySelectorAll('[data-delete-record]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.deleteRecord,id));
  openSheet('detailSheet');
}
function deleteProject(id){
  const p=projectById(id); if(!p||!confirm(`确定删除《${p.title}》吗？\n它的录音记录和结算记录也会一起删除。`)) return;
  db.projects=db.projects.filter(x=>x.id!==id); db.recordings=db.recordings.filter(x=>x.projectId!==id); db.settlements=db.settlements.filter(x=>x.projectId!==id); persist(); closeSheet('detailSheet'); toast('项目已删除');
}
function deleteSettlement(id,projectId){ if(!confirm('删除这条结算记录？'))return; db.settlements=db.settlements.filter(x=>x.id!==id); persist(); openProjectDetail(projectId); }
function deleteRecord(id,projectId){ if(!confirm('删除这条录音记录？'))return; db.recordings=db.recordings.filter(x=>x.id!==id); persist(); openProjectDetail(projectId); }

function openSettlement(projectId){
  settlementProjectId.value=projectId;
  const s=projectStats(projectById(projectId));
  settledThrough.value=s.progress||'';
  settledAmount.value='';
  settledDate.value=today();
  openSheet('settlementSheet');
}
document.getElementById('settlementForm').addEventListener('submit',e=>{
  e.preventDefault();
  const projectId=settlementProjectId.value;
  db.settlements.push({id:uid(),projectId,settledThrough:Number(settledThrough.value),amount:Number(settledAmount.value),date:settledDate.value,createdAt:new Date().toISOString()});
  persist(); closeSheet('settlementSheet'); closeSheet('detailSheet'); openProjectDetail(projectId); toast('结算已记录');
});

function matchFile(fileName){
  const stem=fileName.replace(/\.mp3$/i,'').trim();
  const candidates=[];
  for(const p of db.projects){
    for(const alias of (p.aliases||[])){
      const a=String(alias).trim();
      if(a && stem.toLowerCase().startsWith(a.toLowerCase())) candidates.push({p,alias:a});
    }
  }
  candidates.sort((a,b)=>b.alias.length-a.alias.length);
  const hit=candidates[0];
  if(!hit) return {error:'没有找到对应的书名简称'};
  const rest=stem.slice(hit.alias.length);
  let m=rest.match(/(\d+)\s*[-–—~～至到]\s*(\d+)/);
  if(!m) m=rest.match(/(?:^|\s)(\d+)(?:\s|$)/);
  if(!m) return {error:'没有识别到集数',project:hit.p};
  return {project:hit.p,start:Number(m[1]),end:Number(m[2]||m[1])};
}
function audioDuration(file){
  return new Promise((resolve,reject)=>{
    const audio=document.createElement('audio'); const url=URL.createObjectURL(file); audio.preload='metadata';
    const clean=()=>URL.revokeObjectURL(url);
    audio.onloadedmetadata=()=>{const d=audio.duration;clean();Number.isFinite(d)?resolve(d):reject(new Error('无法读取音频时长'));};
    audio.onerror=()=>{clean();reject(new Error('无法读取音频时长'));};
    audio.src=url;
  });
}
async function prepareFiles(files){
  pendingImports=[];
  const preview=document.getElementById('importPreview');
  preview.innerHTML='<div class="empty">正在读取音频信息…</div>';
  for(const file of files.filter(f=>f.name.toLowerCase().endsWith('.mp3'))){
    const fileKey=`${file.name}|${file.size}|${file.lastModified}`;
    const duplicate=db.recordings.some(r=>r.fileKey===fileKey);
    const match=matchFile(file.name);
    let dur=0, error=match.error||'';
    if(!duplicate&&!error){ try{dur=await audioDuration(file);}catch(err){error=err.message;} }
    pendingImports.push({file,fileKey,duplicate,match,duration:dur,error,recordDate:today()});
  }
  renderImportPreview();
}
function renderImportPreview(){
  const el=document.getElementById('importPreview');
  if(!pendingImports.length){el.innerHTML='';confirmImportBtn.hidden=true;return;}
  el.innerHTML=pendingImports.map(x=>{
    let info='';
    if(x.duplicate) info='<span class="err">这个文件已经导入过，会跳过</span>';
    else if(x.error) info=`<span class="err">${esc(x.error)}</span>`;
    else info=`<span class="ok">《${esc(x.match.project.title)}》 · ${x.match.start}-${x.match.end} 集 · ${duration(x.duration)}</span>`;
    return `<div class="import-item"><div class="import-name">${esc(x.file.name)}</div><div class="import-info">${info}</div></div>`;
  }).join('');
  confirmImportBtn.hidden=!pendingImports.some(x=>!x.duplicate&&!x.error);
}
chooseAudioBtn.onclick=()=>audioInput.click();
audioInput.addEventListener('change',e=>prepareFiles([...e.target.files]));
confirmImportBtn.onclick=()=>{
  let count=0;
  pendingImports.forEach(x=>{
    if(x.duplicate||x.error)return;
    db.recordings.push({id:uid(),projectId:x.match.project.id,fileName:x.file.name,fileKey:x.fileKey,fileSize:x.file.size,duration:x.duration,startEpisode:x.match.start,endEpisode:x.match.end,recordDate:x.recordDate,importedAt:new Date().toISOString()}); count++;
  });
  persist(); pendingImports=[]; audioInput.value=''; renderImportPreview(); toast(`已导入 ${count} 个成品`); switchView('home');
};

window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installPrompt=e; installBtn.hidden=false; });
installBtn.addEventListener('click',async()=>{ if(!installPrompt)return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt=null; installBtn.hidden=true; });
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }

renderAll();
