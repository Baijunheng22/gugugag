const STORAGE_KEY = 'voiceledger_02_data';

function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const todayISO = () => localISODate(new Date());
const currentYM = () => todayISO().slice(0, 7);

const state = {
  data: loadData(),
  currentView: 'home',
  bookFilter: 'all',
  platformFilter: 'all',
  clientFilter: 'all',
  statsPeriod: 'month',
  statsCustomMonth: currentYM(),
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
function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  renderAll();
}
function uid(prefix='id'){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
function money(n){ return `¥${Number(n || 0).toFixed(2)}`; }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function statusText(s){ return ({ongoing:'连载中', paused:'暂停', finished:'已完结'})[s] || '连载中'; }
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function $(sel){return document.querySelector(sel)}
function uniqueSorted(values){return [...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}

function secToText(sec){
  sec = Math.max(0, Math.round(Number(sec)||0));
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  if(h) return `${h}小时${m ? ` ${m}分` : ''}${!m && s ? ` ${s}秒` : ''}`;
  if(m) return `${m}分${s ? ` ${s}秒` : ''}`;
  return `${s}秒`;
}
function secToClock(sec){
  sec=Math.max(0,Math.round(Number(sec)||0));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function parseClock(v){
  const raw=String(v||'').trim().replace(/：/g,':').replace(/\s+/g,'');
  if(!raw)return 0;
  if(/^\d+$/.test(raw)){
    if(raw.length<=2) return Number(raw)*60; // 25 = 25 分钟（兼容 0.2.1）
    if(raw.length<=4){
      const sec=Number(raw.slice(-2)); const min=Number(raw.slice(0,-2)||0);
      if(sec>59)return 0; return min*60+sec;
    }
    if(raw.length<=6){
      const sec=Number(raw.slice(-2)); const min=Number(raw.slice(-4,-2)||0); const hour=Number(raw.slice(0,-4)||0);
      if(sec>59||min>59)return 0; return hour*3600+min*60+sec;
    }
    return 0;
  }
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
function formatDurationInput(v){
  const raw=String(v||'').trim().replace(/：/g,':').replace(/\s+/g,'');
  if(!raw)return '';
  const sec=parseClock(raw); if(!sec)return raw;
  if(raw.includes(':')) return secToClock(sec);
  if(/^\d+$/.test(raw)){
    if(raw.length<=2) return `${Number(raw)}:00`;
    if(raw.length<=4){
      const s=raw.slice(-2),m=raw.slice(0,-2)||'0';
      return `${String(Number(m)).padStart(2,'0')}:${s}`;
    }
    if(raw.length<=6){
      const s=raw.slice(-2),m=raw.slice(-4,-2),h=raw.slice(0,-4)||'0';
      return `${String(Number(h)).padStart(2,'0')}:${m}:${s}`;
    }
  }
  return secToClock(sec);
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
function dateIsThisMonth(date){ return String(date||'').slice(0,7)===currentYM(); }
function dayTotals(date=todayISO()){
  const rs=state.data.records.filter(r=>r.date===date);
  return {duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),income:rs.reduce((a,r)=>a+recordAmount(r),0)};
}
function monthTotals(){
  const rs=state.data.records.filter(r=>dateIsThisMonth(r.date));
  return {duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),income:rs.reduce((a,r)=>a+recordAmount(r),0)};
}

function lastMonthYM(){
  const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function statsPeriodLabel(){
  if(state.statsPeriod==='month')return '本月';
  if(state.statsPeriod==='lastMonth')return '上月';
  if(state.statsPeriod==='year')return `${new Date().getFullYear()} 年`;
  if(state.statsPeriod==='custom')return state.statsCustomMonth || '指定月份';
  return '全部历史';
}
function dateInStatsPeriod(date){
  const v=String(date||'');
  if(state.statsPeriod==='all')return true;
  if(state.statsPeriod==='year')return v.slice(0,4)===String(new Date().getFullYear());
  if(state.statsPeriod==='lastMonth')return v.slice(0,7)===lastMonthYM();
  if(state.statsPeriod==='custom')return v.slice(0,7)===(state.statsCustomMonth||currentYM());
  return v.slice(0,7)===currentYM();
}
function statsPeriodTotals(){
  const rs=state.data.records.filter(r=>dateInStatsPeriod(r.date));
  const ss=state.data.settlements.filter(s=>dateInStatsPeriod(s.date));
  return {
    duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),
    receivable:rs.reduce((a,r)=>a+recordAmount(r),0),
    received:ss.reduce((a,s)=>a+(Number(s.amount)||0),0),
    records:rs.length,
  };
}
function groupedPeriodStats(key){
  const groups=new Map();
  for(const book of state.data.books){
    const name=String(book[key]||'').trim() || (key==='platform'?'未填写平台':'未填写甲方');
    if(!groups.has(name))groups.set(name,{name,duration:0,receivable:0,received:0,bookIds:[]});
    groups.get(name).bookIds.push(book.id);
  }
  for(const g of groups.values()){
    const set=new Set(g.bookIds);
    const rs=state.data.records.filter(r=>set.has(r.bookId)&&dateInStatsPeriod(r.date));
    const ss=state.data.settlements.filter(s=>set.has(s.bookId)&&dateInStatsPeriod(s.date));
    g.duration=rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0);
    g.receivable=rs.reduce((a,r)=>a+recordAmount(r),0);
    g.received=ss.reduce((a,s)=>a+(Number(s.amount)||0),0);
  }
  return [...groups.values()].filter(g=>g.duration||g.receivable||g.received).sort((a,b)=>b.receivable-a.receivable||b.received-a.received);
}

function renderAll(){
  renderHome(); renderLibraryFilters(); renderBooks(); renderStats(); renderSettingsSummary();
  if(state.selectedDetailBookId && document.getElementById('bookDetailModal').classList.contains('open')) renderBookDetail(state.selectedDetailBookId);
}
function renderHome(){
  const td=dayTotals(), mt=monthTotals();
  $('#todayDuration').textContent=secToText(td.duration);
  $('#todayIncome').textContent=`今日应收 ${money(td.income)}`;
  $('#monthDuration').textContent=secToText(mt.duration);
  $('#monthIncome').textContent=money(mt.income);
  const active=state.data.books.filter(b=>b.status!=='finished');
  $('#activeBooks').innerHTML=active.length?active.map(bookCard).join(''):empty('还没有正在做的书，先新建一本。');
  const rs=state.data.records.filter(r=>r.date===todayISO()).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#todayRecords').innerHTML=rs.length?rs.map(recordCard).join(''):empty('今天还没有记录。拍照识别或手动新增都可以开始。');
}
function renderLibraryFilters(){
  const p=$('#bookPlatformFilter'), c=$('#bookClientFilter'); if(!p||!c)return;
  const platforms=uniqueSorted(state.data.books.map(b=>b.platform));
  const clients=uniqueSorted(state.data.books.map(b=>b.client));
  const pValue=state.platformFilter, cValue=state.clientFilter;
  p.innerHTML=`<option value="all">全部平台</option>${platforms.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
  c.innerHTML=`<option value="all">全部甲方</option>${clients.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
  p.value=platforms.includes(pValue)?pValue:'all'; c.value=clients.includes(cValue)?cValue:'all';
  state.platformFilter=p.value; state.clientFilter=c.value;
}
function renderBooks(){
  const list=state.data.books.filter(b=>
    (state.bookFilter==='all'||b.status===state.bookFilter) &&
    (state.platformFilter==='all'||b.platform===state.platformFilter) &&
    (state.clientFilter==='all'||b.client===state.clientFilter)
  );
  $('#bookList').innerHTML=list.length?list.map(bookCard).join(''):empty('这个分类里还没有书籍项目。');
}
function renderStats(){
  const td=dayTotals(), mt=monthTotals(), pt=statsPeriodTotals();
  $('#statsTodayDuration').textContent=secToText(td.duration);
  $('#statsTodayIncome').textContent=money(td.income);
  $('#statsMonthDuration').textContent=secToText(mt.duration);
  $('#statsMonthIncome').textContent=money(mt.income);
  $('#statsPeriodLabel').textContent=statsPeriodLabel();
  $('#statsPeriodDuration').textContent=secToText(pt.duration);
  $('#statsPeriodReceivable').textContent=money(pt.receivable);
  $('#statsPeriodReceived').textContent=money(pt.received);
  $('#statsPeriodRecords').textContent=`${pt.records} 条`;
  $('#statsCustomMonthWrap').hidden=state.statsPeriod!=='custom';
  $('#statsCustomMonth').value=state.statsCustomMonth;
  $('#statsBookList').innerHTML=state.data.books.length?state.data.books.map(statBookCard).join(''):empty('有记录后，这里会按书统计。');
  const ps=groupedPeriodStats('platform');
  const cs=groupedPeriodStats('client');
  $('#statsPlatformList').innerHTML=ps.length?ps.map(g=>groupStatCard('platform',g)).join(''):empty('这个统计周期里还没有平台数据。');
  $('#statsClientList').innerHTML=cs.length?cs.map(g=>groupStatCard('client',g)).join(''):empty('这个统计周期里还没有甲方数据。');
}
function renderSettingsSummary(){
  const el=$('#settingsDataSummary'); if(!el)return;
  el.innerHTML=`<div class="settings-summary-grid"><div><span>书籍</span><strong>${state.data.books.length}</strong></div><div><span>录音记录</span><strong>${state.data.records.length}</strong></div><div><span>结算记录</span><strong>${state.data.settlements.length}</strong></div></div>`;
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
function groupStatCard(type,g){
  const label=type==='platform'?'平台':'甲方';
  return `<button class="group-stat-card" type="button" data-group-type="${type}" data-group-name="${escapeHtml(g.name)}">
    <div><span class="group-label">${label}</span><strong>${escapeHtml(g.name)}</strong><small>${secToText(g.duration)}</small></div>
    <div class="group-money"><span>应收 ${money(g.receivable)}</span><span>到账 ${money(g.received)}</span></div><span class="chev">›</span>
  </button>`;
}
function empty(text){return `<div class="empty-card">${escapeHtml(text)}</div>`;}

function switchView(view){
  state.currentView=view;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  window.scrollTo({top:0,behavior:'instant'});
}
function openModal(id){ const el=$(`#${id}`); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeModal(id){ const el=$(`#${id}`); el.classList.remove('open'); el.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2400); }

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
  saveData(); refreshDraftBookMatches(); renderOcrDrafts(); closeModal('bookModal'); toast(id?'项目已更新':'项目已建立，可立即在识别结果里选择');
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

function normalizeAlias(s){return String(s||'').toLowerCase().replace(/\s+/g,'').replace(/[《》【】()（）\[\]_.·•!！?？:：,，'"“”‘’]/g,'');}
function levenshtein(a,b){
  a=String(a||''); b=String(b||'');
  const dp=Array.from({length:b.length+1},(_,j)=>j);
  for(let i=1;i<=a.length;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=b.length;j++){
      const old=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=old;
    }
  }
  return dp[b.length];
}
function chineseOnly(s){return String(s||'').replace(/[^\u3400-\u9fff]/g,'');}
function lcsLength(a,b){
  a=String(a||''); b=String(b||'');
  const dp=new Array(b.length+1).fill(0);
  for(let i=1;i<=a.length;i++){
    let prev=0;
    for(let j=1;j<=b.length;j++){
      const old=dp[j];
      dp[j]=a[i-1]===b[j-1]?prev+1:Math.max(dp[j],dp[j-1]);
      prev=old;
    }
  }
  return dp[b.length];
}
function fuzzyBookByAlias(alias){
  const n=normalizeAlias(alias); if(!n)return null;
  let best=null,second=null;
  for(const b of state.data.books){
    const bn=normalizeAlias(b.alias); if(!bn)continue;
    if(n===bn || n.startsWith(bn) || bn.startsWith(n))return b;
    const dist=levenshtein(n,bn), maxLen=Math.max(n.length,bn.length), minLen=Math.min(n.length,bn.length);
    const cn=chineseOnly(n), cb=chineseOnly(bn), lcs=(cn&&cb)?lcsLength(cn,cb):0;
    const allowed=maxLen<=2?1:maxLen<=4?2:maxLen<=7?2:3;
    const ratio=maxLen?1-dist/maxLen:0;
    const chineseSupport=cn&&cb&&lcs>=Math.min(2,Math.min(cn.length,cb.length));
    if(dist<=allowed && (ratio>=0.48 || chineseSupport)){
      const score=ratio+(chineseSupport?0.18:0)-(dist*0.03);
      const item={book:b,score,dist};
      if(!best||score>best.score){second=best;best=item;}else if(!second||score>second.score){second=item;}
    }
  }
  if(!best)return null;
  if(second && best.score-second.score<0.06 && best.dist>=second.dist)return null;
  return best.book;
}
function findBookByAlias(alias){return fuzzyBookByAlias(alias);}
function findKnownAliasInText(text){
  const normalized=normalizeAlias(text);
  return [...state.data.books]
    .filter(b=>b.alias)
    .sort((a,b)=>normalizeAlias(b.alias).length-normalizeAlias(a.alias).length)
    .find(b=>normalized.includes(normalizeAlias(b.alias))) || null;
}
function isIgnoredOcrLine(text){
  const t=String(text||'').replace(/\s+/g,'');
  if(/返音|反音/.test(t))return true;
  const cn=chineseOnly(t);
  if(cn && cn.length<=4 && (levenshtein(cn,'返音')<=1 || levenshtein(cn,'反音')<=1))return true;
  if((cn.includes('返')||cn.includes('反'))&&cn.includes('音'))return true;
  return false;
}
function extractDuration(text){
  const m=String(text||'').replace(/：/g,':').match(/(?:时长|duration)?\s*[:：]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})/i);
  return m?m[1]:'';
}
function extractEpisodeRange(text){
  const line=String(text||'').replace(/[—–−～~]/g,'-');
  let m=line.match(/(\d{1,5})\s*(?:-|至|到)\s*(\d{1,5})/);
  if(m)return {start:Number(m[1]),end:Number(m[2]),index:m.index||0,raw:m[0]};
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
function rawAliasFromLine(line,ep){
  const src=String(line||'');
  let cut=Number(ep?.index??0);
  if(cut<=0 && ep?.start!=null){
    const pos=src.search(new RegExp(`(?:^|\\D)${String(ep.start)}(?:\\D|$)`));
    if(pos>=0){const exact=src.indexOf(String(ep.start),pos);if(exact>0)cut=exact;}
  }
  if(cut<=0){const m=src.match(/\d{1,5}\s*(?:-|至|到|\s)\s*\d{1,5}/);if(m?.index>0)cut=m.index;}
  let before=src.slice(0,cut>0?cut:src.length).trim().replace(/^(文件名|名称|name)\s*[:：]?\s*/i,'');
  before=before.replace(/\.mp3.*$/i,'').replace(/^[^\u3400-\u9fffA-Za-z0-9]+/,'').trim();
  const chinese=before.match(/[\u3400-\u9fff]+/g);
  if(chinese?.length)return chinese.join('');
  return before.replace(/[^A-Za-z0-9_-]+/g,' ').trim();
}
function aliasFromTexts(texts,ep){
  for(const text of texts){const exact=findKnownAliasInText(text);if(exact)return {alias:exact.alias,book:exact,text};}
  let best=null;
  for(const text of texts){
    const raw=rawAliasFromLine(text,extractEpisodeRange(text)||ep);
    if(!raw)continue;
    const book=findBookByAlias(raw);
    const cn=chineseOnly(raw);
    const score=(book?200:0)+cn.length*12-Math.max(0,raw.length-14);
    if(!best||score>best.score)best={alias:book?.alias||raw,book:book||null,text,score};
  }
  return best||{alias:'',book:null,text:texts[0]||''};
}
function draftFromObservation(obs,imageDate){
  if(obs.ignored)return null;
  const ep={start:obs.episodeStart,end:obs.episodeEnd,index:0};
  const picked=aliasFromTexts(obs.texts||[],ep);
  return {id:uid('draft'),alias:picked.book?.alias||picked.alias,episodeStart:obs.episodeStart,episodeEnd:obs.episodeEnd,durationText:obs.durationText||'',date:imageDate,bookId:picked.book?.id||'',sourceLine:picked.text||'',ocrTexts:obs.texts||[]};
}
function parseOcrText(text,imageDate=todayISO()){
  const lines=String(text||'').replace(/[—–−～~]/g,'-').split(/\r?\n/).map(l=>l.replace(/\.mp3/ig,' .mp3 ').replace(/\s+/g,' ').trim()).filter(Boolean);
  const out=[]; let pending=null;
  for(const line of lines){
    const ep=extractEpisodeRange(line);
    if(ep){
      const raw={episodeStart:ep.start,episodeEnd:ep.end,durationText:extractDuration(line),texts:[line],ignored:isIgnoredOcrLine(line)};
      const d=draftFromObservation(raw,imageDate); if(d){out.push(d);pending=d;} else pending=null;
      continue;
    }
    const dur=extractDuration(line);
    if(dur&&pending&&!pending.durationText)pending.durationText=dur;
  }
  return out;
}
function parseTsvStructuredRows(tsv){
  if(!tsv)return [];
  const lines=String(tsv).split(/\r?\n/); if(lines.length<2)return [];
  const header=lines[0].split('\t'); const idx=Object.fromEntries(header.map((h,i)=>[h,i]));
  const groups=new Map();
  for(const line of lines.slice(1)){
    if(!line.trim())continue;
    const p=line.split('\t');
    if(idx.level!=null && String(p[idx.level])!=='5')continue;
    const text=(idx.text!=null?p.slice(idx.text).join('\t'):'').trim(); if(!text)continue;
    const left=Number(p[idx.left]),top=Number(p[idx.top]),width=Number(p[idx.width]),height=Number(p[idx.height]);
    if(!Number.isFinite(left+top+width+height))continue;
    const block=idx.block_num!=null?p[idx.block_num]:'0', par=idx.par_num!=null?p[idx.par_num]:'0', ln=idx.line_num!=null?p[idx.line_num]:'0';
    const key=`${block}:${par}:${ln}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({text,left,top,width,height,right:left+width,bottom:top+height,cy:top+height/2});
  }
  const rows=[];
  for(const words of groups.values()){
    words.sort((a,b)=>a.left-b.left);
    const left=Math.min(...words.map(w=>w.left)), right=Math.max(...words.map(w=>w.right));
    const top=Math.min(...words.map(w=>w.top)), bottom=Math.max(...words.map(w=>w.bottom));
    rows.push({text:words.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim(),left,right,top,bottom,cy:(top+bottom)/2,height:bottom-top});
  }
  return rows.sort((a,b)=>a.cy-b.cy||a.left-b.left);
}
function observationsFromTsv(tsv){
  const rows=parseTsvStructuredRows(tsv); if(!rows.length)return [];
  const anchors=rows.map(row=>({row,ep:extractEpisodeRange(row.text)})).filter(x=>x.ep).sort((a,b)=>a.row.cy-b.row.cy);
  const durations=rows.map(row=>({row,duration:extractDuration(row.text)})).filter(x=>x.duration);
  const out=[];
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i],prev=anchors[i-1]?.row,next=anchors[i+1]?.row;
    const lower=prev?(prev.cy+a.row.cy)/2:Math.max(0,a.row.top-a.row.height*3.2);
    const upper=next?(a.row.cy+next.cy)/2:a.row.bottom+a.row.height*5.2;
    let best=null;
    for(const d of durations){
      if(d.row.cy<lower||d.row.cy>=upper)continue;
      const dy=d.row.cy-a.row.cy;
      const score=(dy>=-a.row.height*.5?0:200)+Math.abs(dy)+(d.duration.split(':').length===3?0:8);
      if(!best||score<best.score)best={...d,score};
    }
    out.push({
      episodeStart:a.ep.start,episodeEnd:a.ep.end,durationText:best?.duration||extractDuration(a.row.text)||'',texts:[a.row.text],ignored:isIgnoredOcrLine(a.row.text),
      cy:a.row.cy,left:a.row.left,right:a.row.right,top:a.row.top,bottom:a.row.bottom,height:a.row.height
    });
  }
  return out;
}
function mergeObservations(...sets){
  const out=[];
  for(const set of sets){
    for(const obs of set){
      let same=out.find(x=>Number(x.episodeStart)===Number(obs.episodeStart)&&Number(x.episodeEnd)===Number(obs.episodeEnd)&&Math.abs((x.cy||0)-(obs.cy||0))<90);
      if(!same){out.push({...obs,texts:[...(obs.texts||[])]});continue;}
      for(const t of (obs.texts||[]))if(t&&!same.texts.includes(t))same.texts.push(t);
      if(!same.durationText&&obs.durationText)same.durationText=obs.durationText;
      same.ignored=same.ignored||obs.ignored;
      if((obs.height||0)>(same.height||0)){same.left=obs.left;same.right=obs.right;same.top=obs.top;same.bottom=obs.bottom;same.height=obs.height;same.cy=obs.cy;}
    }
  }
  return out.sort((a,b)=>(a.cy||0)-(b.cy||0));
}
async function fileToCanvas(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});
    const srcW=img.naturalWidth||img.width,srcH=img.naturalHeight||img.height;
    const targetW=Math.min(2200,Math.max(1500,srcW)); const scale=targetW/srcW; const targetH=Math.round(srcH*scale);
    const canvas=document.createElement('canvas');canvas.width=targetW;canvas.height=targetH;
    canvas.getContext('2d').drawImage(img,0,0,targetW,targetH); return canvas;
  }finally{URL.revokeObjectURL(url);}
}
function enhancedCanvas(source,contrast=1.34){
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
  const im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const y=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const c=Math.max(0,Math.min(255,(y-128)*contrast+136));d[i]=d[i+1]=d[i+2]=c;
  }
  ctx.putImageData(im,0,0);return canvas;
}
function cropCanvas(source,x0,y0,x1,y1,scale=2.25){
  x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(source.width,Math.ceil(x1));y1=Math.min(source.height,Math.ceil(y1));
  const w=Math.max(1,x1-x0),h=Math.max(1,y1-y0),out=document.createElement('canvas');
  out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));
  const ctx=out.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,x0,y0,w,h,0,0,out.width,out.height);return out;
}
function needsAliasRetry(obs){
  if(obs.ignored)return false;
  const picked=aliasFromTexts(obs.texts||[],{start:obs.episodeStart,end:obs.episodeEnd,index:0});
  if(picked.book)return false;
  const alias=String(picked.alias||'');
  return chineseOnly(alias).length<2 || alias.length>10;
}
async function improveAliasForObservation(worker,sourceCanvas,obs){
  const padX=sourceCanvas.width*.055,padRight=sourceCanvas.width*.12;
  const yPadTop=Math.max(18,(obs.height||28)*1.2),yPadBottom=Math.max(28,(obs.height||28)*1.8);
  const x0=Math.max(0,(obs.left||0)-padX),x1=Math.min(sourceCanvas.width,Math.max(sourceCanvas.width*.60,(obs.right||0)+padRight));
  const crop=cropCanvas(sourceCanvas,x0,(obs.top||0)-yPadTop,x1,(obs.bottom||0)+yPadBottom,2.5);
  const gray=enhancedCanvas(crop,1.38);
  const candidates=[];
  for(const psm of ['12','7']){
    await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:psm});
    const r=await worker.recognize(gray,{}, {text:true});
    const t=String(r.data.text||'').replace(/\s+/g,' ').trim(); if(t)candidates.push(t);
    if(isIgnoredOcrLine(t))break;
    const picked=aliasFromTexts([...(obs.texts||[]),...candidates],{start:obs.episodeStart,end:obs.episodeEnd,index:0});
    if(picked.book)break;
  }
  for(const t of candidates)if(t&&!obs.texts.includes(t))obs.texts.push(t);
  obs.ignored=obs.ignored||candidates.some(isIgnoredOcrLine);
}
async function improveMissingDuration(worker,sourceCanvas,obs,prev,next){
  const lower=prev?((prev.cy||0)+(obs.cy||0))/2:Math.max(0,(obs.top||0)-(obs.height||30)*2.5);
  const upper=next?((obs.cy||0)+(next.cy||0))/2:Math.min(sourceCanvas.height,(obs.bottom||0)+(obs.height||30)*5.5);
  const crop=cropCanvas(sourceCanvas,sourceCanvas.width*.52,lower,sourceCanvas.width*.98,upper,2.2);
  const gray=enhancedCanvas(crop,1.45);
  await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:'6'});
  const r=await worker.recognize(gray,{}, {text:true});
  const times=String(r.data.text||'').replace(/：/g,':').match(/(?:\d{1,2}:)?\d{1,2}:\d{2}/g)||[];
  const valid=times.map(t=>({t,sec:parseClock(t)})).filter(x=>x.sec>0).sort((a,b)=>b.t.split(':').length-a.t.split(':').length);
  if(valid.length)obs.durationText=valid[0].t;
}
function observationToDraft(obs,imageDate){
  if(obs.ignored)return null;
  const picked=aliasFromTexts(obs.texts||[],{start:obs.episodeStart,end:obs.episodeEnd,index:0});
  return {id:uid('draft'),alias:picked.book?.alias||picked.alias||'',episodeStart:obs.episodeStart,episodeEnd:obs.episodeEnd,durationText:obs.durationText||'',date:imageDate,bookId:picked.book?.id||'',sourceLine:picked.text||'',ocrTexts:obs.texts||[]};
}
function mergeDrafts(...lists){
  const out=[];
  const add=d=>{
    if(!d)return;
    const same=out.find(x=>Number(x.episodeStart)===Number(d.episodeStart)&&Number(x.episodeEnd)===Number(d.episodeEnd)&&normalizeAlias(x.alias)===normalizeAlias(d.alias));
    if(!same){out.push(d);return;}
    if(!same.durationText&&d.durationText)same.durationText=d.durationText;
    if(!same.bookId&&d.bookId){same.bookId=d.bookId;same.alias=d.alias;}
  };
  lists.flat().forEach(add);return out;
}
async function processImages(files){
  if(!files?.length)return;
  if(!window.Tesseract){toast('识别组件加载失败，请联网后重试');return;}
  $('#ocrProgress').hidden=false;$('#ocrPreview').hidden=true;setProgress(0,'正在准备 0.3 版式识别…');
  let worker;
  try{
    worker=await Tesseract.createWorker('chi_sim+eng',1,{logger:m=>{
      if(m.status==='recognizing text')setProgress(Math.round((m.progress||0)*100),'正在识别这一块…');
      else if(m.status)$('#ocrProgressText').textContent='正在加载识别模型…';
    }});
    let drafts=[];
    for(let fi=0;fi<files.length;fi++){
      const f=files[fi],d=new Date(f.lastModified||Date.now()),imageDate=Number.isNaN(d.getTime())?todayISO():localISODate(d);
      setProgress(2,`第 ${fi+1}/${files.length} 张：先找每条记录…`);
      const original=await fileToCanvas(f),enhanced=enhancedCanvas(original,1.34);
      await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:'11'});
      const passA=await worker.recognize(original,{}, {text:true,tsv:true});
      setProgress(18,`第 ${fi+1}/${files.length} 张：复核中文和数字…`);
      const passB=await worker.recognize(enhanced,{}, {text:true,tsv:true});
      let observations=mergeObservations(observationsFromTsv(passA.data.tsv),observationsFromTsv(passB.data.tsv));
      if(!observations.length){
        const fallback=mergeDrafts(parseOcrText(passA.data.text,imageDate),parseOcrText(passB.data.text,imageDate));
        drafts=drafts.concat(fallback);continue;
      }
      for(let i=0;i<observations.length;i++){
        const obs=observations[i];
        if(needsAliasRetry(obs)){
          setProgress(30+Math.round((i/Math.max(1,observations.length))*35),`第 ${fi+1}/${files.length} 张：逐条复核书名 ${i+1}/${observations.length}…`);
          await improveAliasForObservation(worker,original,obs);
        }
      }
      for(let i=0;i<observations.length;i++){
        const obs=observations[i]; if(obs.ignored||obs.durationText)continue;
        setProgress(68+Math.round((i/Math.max(1,observations.length))*25),`第 ${fi+1}/${files.length} 张：补识别时长 ${i+1}/${observations.length}…`);
        await improveMissingDuration(worker,original,obs,observations[i-1],observations[i+1]);
      }
      const imageDrafts=observations.map(o=>observationToDraft(o,imageDate)).filter(Boolean);
      drafts=drafts.concat(imageDrafts);
    }
    state.ocrDrafts=drafts.length?drafts:[blankDraft()];refreshDraftBookMatches();renderOcrDrafts();$('#ocrPreview').hidden=false;
    if(!drafts.length)toast('没有抓到完整记录，可以用手动入口补录');
    else toast(`识别到 ${drafts.length} 条；0.3 已按每条记录分别配对书名、集数和时长`);
  }catch(err){console.error(err);toast('识别失败了；可以先手动录入，照片保留后续继续调');}
  finally{if(worker)await worker.terminate();$('#ocrProgress').hidden=true;}
}
function setProgress(pct,text){$('#ocrProgressPct').textContent=`${clamp(pct,0,100)}%`;$('#ocrProgressBar').style.width=`${clamp(pct,0,100)}%`;if(text)$('#ocrProgressText').textContent=text;}
function blankDraft(){return {id:uid('draft'),alias:'',episodeStart:'',episodeEnd:'',durationText:'',date:todayISO(),bookId:''};}
function addManualDraft(){
  state.ocrDrafts.push(blankDraft()); renderOcrDrafts(); $('#ocrPreview').hidden=false;
  setTimeout(()=>{const rows=document.querySelectorAll('.ocr-row');rows[rows.length-1]?.scrollIntoView({behavior:'smooth',block:'center'});},50);
}
function refreshDraftBookMatches(){
  for(const d of state.ocrDrafts){
    if(d.bookId && bookById(d.bookId))continue;
    const b=findBookByAlias(d.alias);
    if(b){d.bookId=b.id;d.alias=b.alias;}
  }
}
function renderOcrDrafts(){
  const root=$('#ocrRows'); if(!root)return;
  root.innerHTML=state.ocrDrafts.map((d,i)=>{
    const matched=!!d.bookId;
    const missing=[]; if(!d.bookId)missing.push('项目'); if(!d.episodeStart||!d.episodeEnd)missing.push('集数'); if(!parseClock(d.durationText))missing.push('时长');
    const badge=missing.length?`<span class="badge-warn">待确认：${missing.join(' / ')}</span>`:`<span class="pill ongoing">信息完整</span>`;
    return `<div class="ocr-row" data-draft-id="${d.id}">
      <div class="ocr-row-top"><strong>记录 ${i+1}</strong><div>${badge} <button class="ocr-remove" data-remove-draft="${d.id}" type="button">×</button></div></div>
      <div class="ocr-fields">
        <label>归入书籍<select data-field="bookId" data-id="${d.id}"><option value="">请选择书籍</option>${state.data.books.map(b=>`<option value="${b.id}" ${b.id===d.bookId?'selected':''}>《${escapeHtml(b.title)}》 · ${escapeHtml(b.alias)}</option>`).join('')}</select></label>
        <label>文件简称<input data-field="alias" data-id="${d.id}" value="${escapeHtml(d.alias)}" placeholder="双修" /></label>
        <label>日期<input type="date" data-field="date" data-id="${d.id}" value="${d.date||todayISO()}" /></label>
        <label>起始集<input type="number" inputmode="numeric" data-field="episodeStart" data-id="${d.id}" value="${d.episodeStart??''}" placeholder="394" /></label>
        <label>结束集<input type="number" inputmode="numeric" data-field="episodeEnd" data-id="${d.id}" value="${d.episodeEnd??''}" placeholder="414" /></label>
        <label>成品时长<input inputmode="numeric" data-field="durationText" data-id="${d.id}" value="${escapeHtml(d.durationText||'')}" placeholder="012523 → 01:25:23" /></label>
      </div>
    </div>`;
  }).join('');
}
function syncDraftFromInput(el){
  const d=state.ocrDrafts.find(x=>x.id===el.dataset.id); if(!d)return;
  d[el.dataset.field]=el.value;
  if(el.dataset.field==='alias' && !d.bookId){const b=findBookByAlias(el.value);d.bookId=b?.id||'';if(b){d.alias=b.alias;renderOcrDrafts();}}
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
    if(!parseClock(d.durationText)){toast(`${label}：时长无效，可输入 012523、2523、25:23 或 01:25:23`);return;}
    valid.push(d);
  }
  if(!valid.length){toast('还没有可保存的记录');return;}
  const duplicates=valid.filter(isDuplicateDraft);
  if(duplicates.length && !confirm(`发现 ${duplicates.length} 条可能已经记录过。\n\n仍然保存这些重复记录吗？`))return;
  valid.forEach(d=>state.data.records.push({id:uid('rec'),bookId:d.bookId,episodeStart:Number(d.episodeStart),episodeEnd:Number(d.episodeEnd),durationSec:parseClock(d.durationText),date:d.date||todayISO(),createdAt:new Date().toISOString()}));
  state.ocrDrafts=[];saveData();renderOcrDrafts();$('#ocrPreview').hidden=true;toast(`已保存 ${valid.length} 条记录`);switchView('home');
}

function exportBackup(){
  const payload={app:'VoiceLedger',version:'0.3-beta',exportedAt:new Date().toISOString(),data:state.data};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`VoiceLedger-backup-${todayISO()}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000); toast('备份文件已导出');
}
async function importBackupFile(file){
  if(!file)return;
  try{
    const raw=JSON.parse(await file.text()); const data=raw?.data||raw;
    if(!data || !Array.isArray(data.books)||!Array.isArray(data.records)||!Array.isArray(data.settlements))throw new Error('bad format');
    if(!confirm(`将用备份覆盖当前数据。\n\n备份里有 ${data.books.length} 本书、${data.records.length} 条录音记录、${data.settlements.length} 条结算记录。\n\n继续吗？`))return;
    state.data={books:data.books,records:data.records,settlements:data.settlements};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state.data)); refreshDraftBookMatches(); renderOcrDrafts(); renderAll(); toast('备份已导入');
  }catch(err){console.error(err);toast('这个文件不是有效的声账备份');}
}

// Events
$('.tabbar').addEventListener('click',e=>{const btn=e.target.closest('.tab');if(btn)switchView(btn.dataset.view);});
$('#homeCameraBtn').addEventListener('click',()=>switchView('camera'));
$('#homeNewBookBtn').addEventListener('click',()=>openBookForm()); $('#newBookBtn').addEventListener('click',()=>openBookForm());
$('#takePhotoBtn').addEventListener('click',()=>$('#cameraInput').click()); $('#choosePhotoBtn').addEventListener('click',()=>$('#photoInput').click()); $('#manualRecordBtn').addEventListener('click',addManualDraft);
$('#cameraInput').addEventListener('change',e=>processImages([...e.target.files])); $('#photoInput').addEventListener('change',e=>processImages([...e.target.files]));
$('#clearOcrBtn').addEventListener('click',()=>{state.ocrDrafts=[];$('#ocrPreview').hidden=true;}); $('#saveOcrBtn').addEventListener('click',saveOcrDrafts);
$('#ocrRows').addEventListener('input',e=>{if(e.target.dataset.field)syncDraftFromInput(e.target)}); $('#ocrRows').addEventListener('change',e=>{if(e.target.dataset.field)syncDraftFromInput(e.target)});
$('#ocrRows').addEventListener('focusout',e=>{if(e.target.dataset.field==='durationText'){const formatted=formatDurationInput(e.target.value);e.target.value=formatted;syncDraftFromInput(e.target);renderOcrDrafts();}});
$('#ocrRows').addEventListener('click',e=>{const id=e.target.dataset.removeDraft;if(id){state.ocrDrafts=state.ocrDrafts.filter(d=>d.id!==id);renderOcrDrafts();if(!state.ocrDrafts.length)$('#ocrPreview').hidden=true;}});
$('#bookFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.bookFilter=b.dataset.filter;document.querySelectorAll('.filter-chip').forEach(x=>x.classList.toggle('active',x===b));renderBooks();});
$('#bookPlatformFilter').addEventListener('change',e=>{state.platformFilter=e.target.value;renderBooks();});
$('#bookClientFilter').addEventListener('change',e=>{state.clientFilter=e.target.value;renderBooks();});
$('#statsPeriodSelect').addEventListener('change',e=>{state.statsPeriod=e.target.value;renderStats();});
$('#statsCustomMonth').addEventListener('change',e=>{state.statsCustomMonth=e.target.value||currentYM();state.statsPeriod='custom';$('#statsPeriodSelect').value='custom';renderStats();});
$('#exportDataBtn').addEventListener('click',exportBackup); $('#importDataBtn').addEventListener('click',()=>$('#importDataInput').click());
$('#importDataInput').addEventListener('change',e=>{importBackupFile(e.target.files?.[0]);e.target.value='';});
document.addEventListener('click',e=>{
  const open=e.target.closest('[data-open-book]'); if(open){openBookDetail(open.dataset.openBook);return;}
  const edit=e.target.closest('[data-edit-book]'); if(edit){closeModal('bookDetailModal');openBookForm(bookById(edit.dataset.editBook));return;}
  const settle=e.target.closest('[data-add-settlement]'); if(settle){openSettlement(settle.dataset.addSettlement);return;}
  const group=e.target.closest('[data-group-type]'); if(group){
    state.bookFilter='all'; document.querySelectorAll('.filter-chip').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'));
    if(group.dataset.groupType==='platform'){state.platformFilter=group.dataset.groupName;state.clientFilter='all';}
    else{state.clientFilter=group.dataset.groupName;state.platformFilter='all';}
    renderLibraryFilters(); renderBooks(); switchView('books'); return;
  }
  const close=e.target.closest('[data-close]'); if(close)closeModal(close.dataset.close);
});

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
renderAll();
