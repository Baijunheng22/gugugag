const STORAGE_KEY = 'voiceledger_02_data';
const todayISO = () => new Date().toISOString().slice(0, 10);

const state = {
  data: loadData(),
  currentView: 'home',
  bookFilter: 'all',
  ocrDrafts: [],
  selectedDetailBookId: null,
};

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.books) && Array.isArray(parsed.records) && Array.isArray(parsed.settlements)) return parsed;
  } catch (_) {}
  return { books: [], records: [], settlements: [] };
}
function saveData(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); renderAll(); }
function uid(prefix='id'){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
function money(n){ return `¥${Number(n || 0).toFixed(2)}`; }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function statusText(s){ return ({ongoing:'连载中', paused:'暂停', finished:'已完结'})[s] || '连载中'; }
function secToText(sec){
  sec = Math.max(0, Math.round(Number(sec)||0));
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  if(h) return `${h}小时${m ? ` ${m}分` : ''}`;
  if(m) return `${m}分${s ? ` ${s}秒` : ''}`;
  return `${s}秒`;
}
function secToClock(sec){
  sec=Math.max(0,Math.round(Number(sec)||0));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function parseClock(v){
  const raw=String(v||'').trim().replace(/：/g,':');
  if(!raw)return 0;
  // 纯数字按“分钟”处理：25 = 25 分钟。
  if(/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw)*60);
  const parts=raw.split(':').map(Number);
  if(parts.some(Number.isNaN)) return 0;
  if(parts.length===3){
    const [h,m,sec]=parts; if(m<0||m>59||sec<0||sec>59)return 0; return h*3600+m*60+sec;
  }
  if(parts.length===2){
    const [m,sec]=parts; if(sec<0||sec>59)return 0; return m*60+sec;
  }
  return 0;
}
function recordAmount(rec){
  const book=bookById(rec.bookId); if(!book) return 0;
  return (Number(rec.durationSec)||0)/3600*(Number(book.rate)||0);
}
function bookById(id){ return state.data.books.find(b=>b.id===id); }
function recordsForBook(id){ return state.data.records.filter(r=>r.bookId===id).sort((a,b)=>`${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)); }
function settlementsForBook(id){ return state.data.settlements.filter(s=>s.bookId===id).sort((a,b)=>`${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)); }
function bookTotals(id){
  const rs=recordsForBook(id);
  const duration=rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0);
  const receivable=rs.reduce((a,r)=>a+recordAmount(r),0);
  const received=settlementsForBook(id).reduce((a,s)=>a+(Number(s.amount)||0),0);
  const currentProgress=rs.reduce((m,r)=>Math.max(m,Number(r.episodeEnd)||0),0);
  const settledTo=settlementsForBook(id).reduce((m,s)=>Math.max(m,Number(s.settlementTo)||0),0);
  let settlement='unpaid';
  if(settledTo>0 || received>0) settlement = currentProgress>0 && settledTo>=currentProgress ? 'paid' : 'partial';
  return {duration,receivable,received,unreceived:receivable-received,currentProgress,settledTo,settlement};
}
function settlementLabel(s){ return ({unpaid:'未结算',partial:'部分结算',paid:'已结清'})[s] || '未结算'; }
function dateIsThisMonth(date){ return String(date||'').slice(0,7)===todayISO().slice(0,7); }
function dayTotals(date=todayISO()){
  const rs=state.data.records.filter(r=>r.date===date);
  return {duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),income:rs.reduce((a,r)=>a+recordAmount(r),0)};
}
function monthTotals(){
  const rs=state.data.records.filter(r=>dateIsThisMonth(r.date));
  return {duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),income:rs.reduce((a,r)=>a+recordAmount(r),0)};
}

function renderAll(){ renderHome(); renderBooks(); renderStats(); if(state.selectedDetailBookId && document.getElementById('bookDetailModal').classList.contains('open')) renderBookDetail(state.selectedDetailBookId); }
function renderHome(){
  const td=dayTotals(), mt=monthTotals();
  $('#todayDuration').textContent=secToText(td.duration);
  $('#todayIncome').textContent=`今日应收 ${money(td.income)}`;
  $('#monthDuration').textContent=secToText(mt.duration);
  $('#monthIncome').textContent=money(mt.income);
  const active=state.data.books.filter(b=>b.status!=='finished');
  $('#activeBooks').innerHTML=active.length?active.map(bookCard).join(''):empty('还没有正在做的书，先新建一本。');
  const rs=state.data.records.filter(r=>r.date===todayISO()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('#todayRecords').innerHTML=rs.length?rs.map(recordCard).join(''):empty('今天还没有记录。拍一张电脑屏幕就可以开始。');
}
function renderBooks(){
  const list=state.data.books.filter(b=>state.bookFilter==='all'||b.status===state.bookFilter);
  $('#bookList').innerHTML=list.length?list.map(bookCard).join(''):empty('这里还没有书籍项目。');
}
function renderStats(){
  const td=dayTotals(), mt=monthTotals();
  $('#statsTodayDuration').textContent=secToText(td.duration);
  $('#statsTodayIncome').textContent=money(td.income);
  $('#statsMonthDuration').textContent=secToText(mt.duration);
  $('#statsMonthIncome').textContent=money(mt.income);
  $('#statsBookList').innerHTML=state.data.books.length?state.data.books.map(statBookCard).join(''):empty('有记录后，这里会按书统计。');
}
function bookCard(book){
  const t=bookTotals(book.id);
  return `<button class="book-card" type="button" data-open-book="${book.id}">
    <div class="book-main"><div class="book-title">《${escapeHtml(book.title)}》</div>
      <div class="book-meta"><span>${escapeHtml(book.alias)}</span><span>·</span><span>${t.currentProgress?`录至 ${t.currentProgress} 集`:'暂无进度'}</span><span class="pill ${book.status}">${statusText(book.status)}</span></div>
      <div class="book-numbers"><div>累计成品<strong>${secToText(t.duration)}</strong></div><div>未收<strong>${money(t.unreceived)}</strong></div></div>
    </div><span class="chev">›</span></button>`;
}
function recordCard(rec){
  const b=bookById(rec.bookId);
  return `<article class="record-card"><div><strong>${b?`《${escapeHtml(b.title)}》`:'未匹配项目'}</strong><div class="small">${rec.episodeStart}-${rec.episodeEnd} 集 · ${rec.date}</div></div><div class="record-duration">${secToClock(rec.durationSec)}</div></article>`;
}
function statBookCard(book){
  const t=bookTotals(book.id);
  return `<button class="stat-book-card" type="button" data-open-book="${book.id}">
    <div class="book-title">《${escapeHtml(book.title)}》</div><div class="book-meta"><span>${secToText(t.duration)}</span><span>·</span><span>录至 ${t.currentProgress||'-'} 集</span><span class="settlement-status ${t.settlement}">${settlementLabel(t.settlement)}</span></div>
    <div class="money-row"><div><span>应收</span><strong>${money(t.receivable)}</strong></div><div><span>已收</span><strong>${money(t.received)}</strong></div><div><span>未收</span><strong>${money(t.unreceived)}</strong></div></div>
  </button>`;
}
function empty(text){return `<div class="empty-card">${escapeHtml(text)}</div>`;}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function switchView(view){
  state.currentView=view;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  window.scrollTo({top:0,behavior:'instant'});
}
function openModal(id){ const el=$(`#${id}`); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeModal(id){ const el=$(`#${id}`); el.classList.remove('open'); el.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2200); }
function $(sel){return document.querySelector(sel)}

function openBookForm(book=null){
  $('#bookModalTitle').textContent=book?'编辑书籍':'新建书籍';
  $('#bookId').value=book?.id||''; $('#bookTitle').value=book?.title||''; $('#bookAlias').value=book?.alias||'';
  $('#bookClient').value=book?.client||''; $('#bookPlatform').value=book?.platform||''; $('#bookRoleType').value=book?.roleType||'';
  $('#bookRoleName').value=book?.roleName||''; $('#bookRate').value=book?.rate??''; $('#bookStatus').value=book?.status||'ongoing';
  openModal('bookModal');
}
$('#bookForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=$('#bookId').value; const alias=$('#bookAlias').value.trim();
  const duplicate=state.data.books.find(b=>normalizeAlias(b.alias)===normalizeAlias(alias)&&b.id!==id);
  if(duplicate){toast('这个文件简称已经被其他书使用');return;}
  const payload={title:$('#bookTitle').value.trim(),alias,client:$('#bookClient').value.trim(),platform:$('#bookPlatform').value,roleType:$('#bookRoleType').value,roleName:$('#bookRoleName').value.trim(),rate:Number($('#bookRate').value||0),status:$('#bookStatus').value};
  if(id){Object.assign(bookById(id),payload);}else{state.data.books.push({id:uid('book'),...payload,createdAt:new Date().toISOString()});}
  saveData(); closeModal('bookModal'); toast(id?'项目已更新':'项目已建立');
});

function renderBookDetail(id){
  const b=bookById(id); if(!b)return;
  state.selectedDetailBookId=id; const t=bookTotals(id), rs=recordsForBook(id), ss=settlementsForBook(id);
  $('#detailAlias').textContent=`文件简称：${b.alias}`; $('#detailTitle').textContent=`《${b.title}》`;
  $('#bookDetailContent').innerHTML=`
    <div class="detail-hero">
      <div class="status-line"><span class="pill ${b.status}">${statusText(b.status)}</span><span class="settlement-status ${t.settlement}">${settlementLabel(t.settlement)}</span></div>
      <div class="detail-grid">
        <div class="detail-metric"><span>当前进度</span><strong>${t.currentProgress?`${t.currentProgress} 集`:'—'}</strong></div>
        <div class="detail-metric"><span>累计成品</span><strong>${secToText(t.duration)}</strong></div>
        <div class="detail-metric"><span>累计应收</span><strong>${money(t.receivable)}</strong></div>
        <div class="detail-metric"><span>累计已收</span><strong>${money(t.received)}</strong></div>
        <div class="detail-metric"><span>当前未收</span><strong>${money(t.unreceived)}</strong></div>
        <div class="detail-metric"><span>已结算至</span><strong>${t.settledTo?`${t.settledTo} 集`:'—'}</strong></div>
      </div>
    </div>
    <div class="detail-actions"><button class="light" type="button" data-add-settlement="${b.id}">＋ 记一笔结算</button><button class="ghost" type="button" data-edit-book="${b.id}">编辑项目</button></div>
    <section class="section-block"><div class="section-head"><div><h2>项目资料</h2></div></div>
      <div class="info-list">
        ${infoRow('甲方',b.client||'—')}${infoRow('平台',b.platform||'—')}${infoRow('角色类型',b.roleType||'—')}${infoRow('角色名',b.roleName||'—')}${infoRow('成品小时单价',money(b.rate||0))}
      </div>
    </section>
    <section class="section-block"><div class="section-head"><div><h2>录音记录</h2><p>${rs.length} 条</p></div></div>
      <div class="history-list">${rs.length?rs.map(r=>`<div class="history-row"><div><strong>${r.episodeStart}-${r.episodeEnd} 集</strong><div class="muted">${r.date}</div></div><strong>${secToClock(r.durationSec)}</strong></div>`).join(''):empty('还没有录音记录。')}</div>
    </section>
    <section class="section-block"><div class="section-head"><div><h2>结算记录</h2><p>${ss.length} 笔</p></div></div>
      <div class="history-list">${ss.length?ss.map(s=>`<div class="history-row"><div><strong>结算至 ${s.settlementTo} 集</strong><div class="muted">${s.date}</div></div><strong>${money(s.amount)}</strong></div>`).join(''):empty('还没有结算记录。')}</div>
    </section>`;
}
function infoRow(a,b){return `<div class="info-row"><span>${a}</span><strong>${escapeHtml(b)}</strong></div>`;}
function openBookDetail(id){renderBookDetail(id);openModal('bookDetailModal');}

function openSettlement(bookId){
  const b=bookById(bookId), t=bookTotals(bookId); if(!b)return;
  $('#settlementBookId').value=bookId; $('#settlementBookName').textContent=`《${b.title}》`;
  $('#settlementTo').value=t.currentProgress||''; $('#settlementAmount').value=''; $('#settlementDate').value=todayISO();
  openModal('settlementModal');
}
$('#settlementForm').addEventListener('submit',e=>{
  e.preventDefault(); const bookId=$('#settlementBookId').value;
  state.data.settlements.push({id:uid('settle'),bookId,settlementTo:Number($('#settlementTo').value),amount:Number($('#settlementAmount').value),date:$('#settlementDate').value,createdAt:new Date().toISOString()});
  saveData(); closeModal('settlementModal'); toast('结算已记下');
});

function normalizeAlias(s){return String(s||'').toLowerCase().replace(/\s+/g,'').replace(/[《》【】()（）\[\]_.·•]/g,'');}
function findBookByAlias(alias){
  const n=normalizeAlias(alias); if(!n)return null;
  return state.data.books.find(b=>normalizeAlias(b.alias)===n) || state.data.books.find(b=>n.startsWith(normalizeAlias(b.alias))||normalizeAlias(b.alias).startsWith(n));
}
function findKnownAliasInText(text){
  const normalized=normalizeAlias(text);
  return [...state.data.books]
    .filter(b=>b.alias)
    .sort((a,b)=>normalizeAlias(b.alias).length-normalizeAlias(a.alias).length)
    .find(b=>normalized.includes(normalizeAlias(b.alias))) || null;
}
function extractDuration(text){
  const m=String(text||'').replace(/：/g,':').match(/(?:时长|duration)?\s*[:：]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})/i);
  return m?m[1]:'';
}
function extractEpisodeRange(text){
  const line=String(text||'').replace(/[—–−～~]/g,'-');
  let m=line.match(/(\d{1,5})\s*(?:-|至|到)\s*(\d{1,5})/);
  if(m)return {start:Number(m[1]),end:Number(m[2]),index:m.index||0,raw:m[0]};
  // OCR 有时会把中间的横线吃掉。只有在看起来确实像文件名/已知简称时才兜底。
  const known=findKnownAliasInText(line);
  if(known || /(?:mp3|\.mp|白珺珩)/i.test(line)){
    const afterAlias=known ? line.slice(Math.max(0,line.toLowerCase().indexOf(known.alias.toLowerCase())+known.alias.length)) : line;
    m=afterAlias.match(/(\d{1,5})\s{1,4}(\d{1,5})(?!\s*[:：])/);
    if(m){
      const index=line.indexOf(m[0]);
      return {start:Number(m[1]),end:Number(m[2]),index:index<0?0:index,raw:m[0]};
    }
  }
  return null;
}
function aliasFromLine(line,ep){
  const known=findKnownAliasInText(line); if(known)return known.alias;
  let alias=String(line||'').slice(0,ep?.index??0).trim().replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/,'');
  alias=alias.replace(/^(文件名|名称|name)\s*[:：]?\s*/i,'').replace(/\.mp3.*$/i,'').trim();
  return alias;
}
function draftFromLine(line,imageDate,durationText=''){
  const ep=extractEpisodeRange(line); if(!ep)return null;
  const alias=aliasFromLine(line,ep);
  const book=findBookByAlias(alias)||findKnownAliasInText(line);
  return {id:uid('draft'),alias:book?.alias||alias,episodeStart:ep.start,episodeEnd:ep.end,durationText:durationText||extractDuration(line),date:imageDate,bookId:book?.id||'',sourceLine:line};
}
function parseOcrText(text, imageDate=todayISO()){
  const lines=String(text||'').replace(/[—–−]/g,'-').replace(/[～~]/g,'-').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out=[]; let pending=null;
  for(const raw of lines){
    const line=raw.replace(/\.mp3/ig,' .mp3 ').replace(/\s+/g,' ').trim();
    const d=draftFromLine(line,imageDate);
    if(d){out.push(d);pending=d;continue;}
    const dur=extractDuration(line);
    if(dur && pending && !pending.durationText){pending.durationText=dur;continue;}
  }
  // OCR 把整页列顺序打乱时，至少尽可能找回“文件名 + 集数”。
  if(!out.length){
    const all=String(text||'').replace(/[—–−～~]/g,'-').replace(/\s+/g,' ');
    const global=/(.{1,40}?)(\d{1,5})\s*(?:-|至|到)\s*(\d{1,5})/g;
    let m; while((m=global.exec(all))){
      const line=`${m[1]} ${m[2]}-${m[3]}`;
      const d=draftFromLine(line,imageDate); if(d)out.push(d);
    }
  }
  return out;
}
function parseTsvRows(tsv){
  if(!tsv)return [];
  const lines=String(tsv).split(/\r?\n/); if(lines.length<2)return [];
  const header=lines[0].split('\t');
  const idx=Object.fromEntries(header.map((h,i)=>[h,i]));
  const words=[];
  for(const line of lines.slice(1)){
    if(!line.trim())continue;
    const p=line.split('\t'); const text=p.slice(idx.text).join('\t').trim(); if(!text)continue;
    const left=Number(p[idx.left]),top=Number(p[idx.top]),width=Number(p[idx.width]),height=Number(p[idx.height]),conf=Number(p[idx.conf]);
    if(!Number.isFinite(left+top+width+height) || conf<15)continue;
    words.push({text,left,top,width,height,cy:top+height/2});
  }
  words.sort((a,b)=>a.cy-b.cy||a.left-b.left);
  const rows=[];
  for(const w of words){
    const tol=Math.max(18,w.height*0.8);
    let row=rows.find(r=>Math.abs(r.cy-w.cy)<=Math.max(tol,r.avgH*0.8));
    if(!row){row={words:[],cy:w.cy,avgH:w.height};rows.push(row);}
    row.words.push(w); row.cy=row.words.reduce((a,x)=>a+x.cy,0)/row.words.length; row.avgH=row.words.reduce((a,x)=>a+x.height,0)/row.words.length;
  }
  return rows.map(r=>{r.words.sort((a,b)=>a.left-b.left);return {text:r.words.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim(),cy:r.cy,height:r.avgH,left:Math.min(...r.words.map(w=>w.left))};}).sort((a,b)=>a.cy-b.cy);
}
function parseOcrTsv(tsv,imageDate=todayISO()){
  const rows=parseTsvRows(tsv); if(!rows.length)return [];
  const durationRows=rows.map((r,i)=>({i,row:r,duration:extractDuration(r.text)})).filter(x=>x.duration);
  const usedDuration=new Set(); const out=[];
  for(const row of rows){
    const ep=extractEpisodeRange(row.text); if(!ep)continue;
    let duration=extractDuration(row.text);
    if(!duration){
      let best=null;
      for(const cand of durationRows){
        if(usedDuration.has(cand.i))continue;
        const dist=Math.abs(cand.row.cy-row.cy);
        const maxDist=Math.max(80,row.height*4,cand.row.height*4);
        if(dist<=maxDist && (!best||dist<best.dist))best={...cand,dist};
      }
      if(best){duration=best.duration;usedDuration.add(best.i);}
    }
    const d=draftFromLine(row.text,imageDate,duration); if(d)out.push(d);
  }
  return out;
}
function draftScore(list){return list.reduce((s,d)=>s+10+(d.durationText?5:0)+(d.bookId?2:0),0);}
function chooseBestDrafts(textDrafts,visualDrafts){
  if(!visualDrafts.length)return textDrafts;
  if(!textDrafts.length)return visualDrafts;
  return draftScore(visualDrafts)>=draftScore(textDrafts)?visualDrafts:textDrafts;
}
async function preprocessImage(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});
    const srcW=img.naturalWidth||img.width,srcH=img.naturalHeight||img.height;
    const targetW=Math.min(2200,Math.max(1600,srcW)); const scale=targetW/srcW; const targetH=Math.round(srcH*scale);
    const canvas=document.createElement('canvas');canvas.width=targetW;canvas.height=targetH;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,targetW,targetH);
    const im=ctx.getImageData(0,0,targetW,targetH),d=im.data;
    for(let i=0;i<d.length;i+=4){
      const y=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
      const c=Math.max(0,Math.min(255,(y-128)*1.38+138));
      d[i]=d[i+1]=d[i+2]=c;
    }
    ctx.putImageData(im,0,0); return canvas;
  }finally{URL.revokeObjectURL(url);}
}
async function processImages(files){
  if(!files?.length)return;
  if(!window.Tesseract){toast('识别组件加载失败，请联网后重试');return;}
  $('#ocrProgress').hidden=false; $('#ocrPreview').hidden=true; setProgress(0,'正在准备识别…');
  let worker;
  try{
    worker=await Tesseract.createWorker('chi_sim+eng',1,{logger:m=>{
      if(m.status==='recognizing text'){setProgress(Math.round((m.progress||0)*100),'正在识别文字…');}
      else if(m.status)$('#ocrProgressText').textContent='正在加载识别模型…';
    }});
    await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:'11'});
    let drafts=[];
    for(let i=0;i<files.length;i++){
      const f=files[i]; setProgress(0,`正在处理第 ${i+1}/${files.length} 张…`);
      let source=f; try{source=await preprocessImage(f);}catch(err){console.warn('preprocess failed',err);}
      const result=await worker.recognize(source,{}, {text:true,tsv:true});
      const d=new Date(f.lastModified||Date.now());
      const imageDate=Number.isNaN(d.getTime())?todayISO():d.toISOString().slice(0,10);
      const textDrafts=parseOcrText(result.data.text,imageDate);
      const visualDrafts=parseOcrTsv(result.data.tsv,imageDate);
      drafts=drafts.concat(chooseBestDrafts(textDrafts,visualDrafts));
    }
    state.ocrDrafts=drafts.length?drafts:[blankDraft()];
    renderOcrDrafts(); $('#ocrPreview').hidden=false;
    if(!drafts.length)toast('这张图没抓到完整记录，可以直接手动补');
    else toast(`识别到 ${drafts.length} 条，先检查一下再保存`);
  }catch(err){console.error(err);toast('识别失败了；你可以换张更清楚的照片，或直接手动新增');}
  finally{if(worker)await worker.terminate();$('#ocrProgress').hidden=true;}
}
function setProgress(pct,text){$('#ocrProgressPct').textContent=`${clamp(pct,0,100)}%`;$('#ocrProgressBar').style.width=`${clamp(pct,0,100)}%`;if(text)$('#ocrProgressText').textContent=text;}
function blankDraft(){return {id:uid('draft'),alias:'',episodeStart:'',episodeEnd:'',durationText:'',date:todayISO(),bookId:''};}
function addManualDraft(){
  state.ocrDrafts.push(blankDraft()); renderOcrDrafts(); $('#ocrPreview').hidden=false;
  setTimeout(()=>{const rows=document.querySelectorAll('.ocr-row');rows[rows.length-1]?.scrollIntoView({behavior:'smooth',block:'center'});},50);
}
function renderOcrDrafts(){
  $('#ocrRows').innerHTML=state.ocrDrafts.map((d,i)=>{
    const matched=!!d.bookId;
    return `<div class="ocr-row" data-draft-id="${d.id}">
      <div class="ocr-row-top"><strong>记录 ${i+1}</strong><div>${matched?`<span class="pill ongoing">已匹配项目</span>`:`<span class="badge-warn">需要确认项目</span>`} <button class="ocr-remove" data-remove-draft="${d.id}" type="button">×</button></div></div>
      <div class="ocr-fields">
        <label>归入书籍<select data-field="bookId" data-id="${d.id}"><option value="">请选择书籍</option>${state.data.books.map(b=>`<option value="${b.id}" ${b.id===d.bookId?'selected':''}>《${escapeHtml(b.title)}》 · ${escapeHtml(b.alias)}</option>`).join('')}</select></label>
        <label>文件简称<input data-field="alias" data-id="${d.id}" value="${escapeHtml(d.alias)}" placeholder="双修" /></label>
        <label>日期<input type="date" data-field="date" data-id="${d.id}" value="${d.date||todayISO()}" /></label>
        <label>起始集<input type="number" inputmode="numeric" data-field="episodeStart" data-id="${d.id}" value="${d.episodeStart??''}" placeholder="394" /></label>
        <label>结束集<input type="number" inputmode="numeric" data-field="episodeEnd" data-id="${d.id}" value="${d.episodeEnd??''}" placeholder="414" /></label>
        <label>成品时长<input inputmode="decimal" data-field="durationText" data-id="${d.id}" value="${escapeHtml(d.durationText||'')}" placeholder="25 / 25:23 / 01:25:23" /></label>
      </div>
    </div>`;
  }).join('');
}
function syncDraftFromInput(el){
  const d=state.ocrDrafts.find(x=>x.id===el.dataset.id); if(!d)return;
  d[el.dataset.field]=el.value;
  if(el.dataset.field==='alias' && !d.bookId){const b=findBookByAlias(el.value);d.bookId=b?.id||'';if(b)renderOcrDrafts();}
  if(el.dataset.field==='bookId' && d.bookId){const b=bookById(d.bookId);if(b){d.alias=b.alias;renderOcrDrafts();}}
}
function isDuplicateDraft(d){
  const sec=parseClock(d.durationText);
  return state.data.records.some(r=>r.bookId===d.bookId && Number(r.episodeStart)===Number(d.episodeStart)&&Number(r.episodeEnd)===Number(d.episodeEnd)&&Number(r.durationSec)===Number(sec));
}
function saveOcrDrafts(){
  const valid=[];
  for(let i=0;i<state.ocrDrafts.length;i++){
    const d=state.ocrDrafts[i],label=`记录 ${i+1}`;
    if(!d.bookId){toast(`${label}：请选择归入书籍`);return;}
    if(!String(d.episodeStart).trim()){toast(`${label}：请填写起始集`);return;}
    if(!String(d.episodeEnd).trim()){toast(`${label}：请填写结束集`);return;}
    if(Number(d.episodeEnd)<Number(d.episodeStart)){toast(`${label}：结束集不能小于起始集`);return;}
    if(!parseClock(d.durationText)){toast(`${label}：成品时长格式不对，可填 25、25:23 或 01:25:23`);return;}
    valid.push(d);
  }
  if(!valid.length){toast('还没有可保存的记录');return;}
  const duplicates=valid.filter(isDuplicateDraft);
  if(duplicates.length && !confirm(`发现 ${duplicates.length} 条可能已经记录过。\n\n仍然保存这些重复记录吗？`))return;
  valid.forEach(d=>state.data.records.push({id:uid('rec'),bookId:d.bookId,episodeStart:Number(d.episodeStart),episodeEnd:Number(d.episodeEnd),durationSec:parseClock(d.durationText),date:d.date||todayISO(),createdAt:new Date().toISOString()}));
  state.ocrDrafts=[];saveData();renderOcrDrafts();$('#ocrPreview').hidden=true;toast(`已保存 ${valid.length} 条记录`);switchView('home');
}

// Events
$('.tabbar').addEventListener('click',e=>{const btn=e.target.closest('.tab');if(btn)switchView(btn.dataset.view);});
$('#homeCameraBtn').addEventListener('click',()=>switchView('camera'));
$('#homeNewBookBtn').addEventListener('click',()=>openBookForm()); $('#newBookBtn').addEventListener('click',()=>openBookForm());
$('#takePhotoBtn').addEventListener('click',()=>$('#cameraInput').click()); $('#choosePhotoBtn').addEventListener('click',()=>$('#photoInput').click()); $('#manualRecordBtn').addEventListener('click',addManualDraft);
$('#cameraInput').addEventListener('change',e=>processImages([...e.target.files])); $('#photoInput').addEventListener('change',e=>processImages([...e.target.files]));
$('#clearOcrBtn').addEventListener('click',()=>{state.ocrDrafts=[];$('#ocrPreview').hidden=true;}); $('#saveOcrBtn').addEventListener('click',saveOcrDrafts);
$('#ocrRows').addEventListener('input',e=>{if(e.target.dataset.field)syncDraftFromInput(e.target)}); $('#ocrRows').addEventListener('change',e=>{if(e.target.dataset.field)syncDraftFromInput(e.target)});
$('#ocrRows').addEventListener('click',e=>{const id=e.target.dataset.removeDraft;if(id){state.ocrDrafts=state.ocrDrafts.filter(d=>d.id!==id);renderOcrDrafts();if(!state.ocrDrafts.length)$('#ocrPreview').hidden=true;}});
$('#bookFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.bookFilter=b.dataset.filter;document.querySelectorAll('.filter-chip').forEach(x=>x.classList.toggle('active',x===b));renderBooks();});
document.addEventListener('click',e=>{
  const open=e.target.closest('[data-open-book]'); if(open){openBookDetail(open.dataset.openBook);return;}
  const edit=e.target.closest('[data-edit-book]'); if(edit){closeModal('bookDetailModal');openBookForm(bookById(edit.dataset.editBook));return;}
  const settle=e.target.closest('[data-add-settlement]'); if(settle){openSettlement(settle.dataset.addSettlement);return;}
  const close=e.target.closest('[data-close]'); if(close)closeModal(close.dataset.close);
});

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
renderAll();
