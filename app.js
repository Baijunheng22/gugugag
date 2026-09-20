const STORAGE_KEY = 'voiceledger_02_data';
const CLOUD_OCR_ENDPOINT_KEY = 'voiceledger_cloud_ocr_endpoint';
const WORK_SETTINGS_KEY = 'voiceledger_07_work_settings';

function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function dateFromISO(iso){
  const [y,m,d]=String(iso||'').split('-').map(Number);
  return new Date(y||1970,(m||1)-1,d||1,12,0,0,0);
}
function addDaysISO(iso,days){const d=dateFromISO(iso);d.setDate(d.getDate()+days);return localISODate(d);}
function daysInMonth(year,month){return new Date(Number(year),Number(month),0).getDate();}
function loadWorkSettings(){
  try{const x=JSON.parse(localStorage.getItem(WORK_SETTINGS_KEY));if(x&&typeof x==='object')return {cutoff:x.cutoff||'06:00',dailyGoalMinutes:Number(x.dailyGoalMinutes)||0,monthlyGoalHours:Number(x.monthlyGoalHours)||0};}catch(_){}
  return {cutoff:'06:00',dailyGoalMinutes:0,monthlyGoalHours:0};
}
let workSettingsCache = loadWorkSettings();
function cutoffMinutes(){const [h,m]=String(workSettingsCache?.cutoff||'06:00').split(':').map(Number);return (h||0)*60+(m||0);}
function workDateForTimestamp(value){
  const d=value instanceof Date?new Date(value):new Date(value||Date.now());
  if(Number.isNaN(d.getTime()))return localISODate(new Date());
  const mins=d.getHours()*60+d.getMinutes();
  if(mins<cutoffMinutes())d.setDate(d.getDate()-1);
  return localISODate(d);
}
function todayISO(){return localISODate(new Date());}
function todayWorkDate(){return workDateForTimestamp(new Date());}
function currentYM(){return todayWorkDate().slice(0,7);}

const state = {
  data: loadData(),
  workSettings: workSettingsCache,
  currentView: 'home',
  bookFilter: 'all',
  platformFilter: 'all',
  clientFilter: 'all',
  statsPeriod: 'month',
  statsCustomMonth: currentYM(),
  statsYear: Number(todayWorkDate().slice(0,4)),
  statsRangeStart: todayWorkDate(),
  statsRangeEnd: todayWorkDate(),
  ocrDrafts: [],
  selectedDetailBookId: null,
};

function normalizeDataShape(data){
  const out=data&&typeof data==='object'?data:{};
  out.books=Array.isArray(out.books)?out.books:[];
  out.records=Array.isArray(out.records)?out.records:[];
  out.settlements=Array.isArray(out.settlements)?out.settlements:[];
  out.trashRecords=Array.isArray(out.trashRecords)?out.trashRecords:[];
  out.meta=out.meta&&typeof out.meta==='object'?out.meta:{};
  for(const r of out.records){
    if(!r.workDate)r.workDate=r.date||todayISO();
    if(!r.date)r.date=r.workDate;
    if(r.workDateManual==null)r.workDateManual=true; // 0.6 及更早记录保持原日期，避免升级后跳日
  }
  return out;
}
function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.books) && Array.isArray(parsed.records) && Array.isArray(parsed.settlements)) return normalizeDataShape(parsed);
  } catch (_) {}
  return normalizeDataShape({ books: [], records: [], settlements: [], trashRecords: [], meta:{} });
}
function saveData(){
  state.data=normalizeDataShape(state.data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  renderAll();
}
function saveWorkSettings(){workSettingsCache={...state.workSettings};localStorage.setItem(WORK_SETTINGS_KEY,JSON.stringify(state.workSettings));}
function recordWorkDate(rec){
  if(rec?.workDateManual!==false)return rec?.workDate||rec?.date||todayWorkDate();
  if(rec?.sourceTimestamp)return workDateForTimestamp(rec.sourceTimestamp);
  return rec?.workDate||rec?.date||todayWorkDate();
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
  const rate=Number.isFinite(Number(rec.rateSnapshot))?Number(rec.rateSnapshot):Number(book.rate)||0;
  return (Number(rec.durationSec)||0)/3600*rate;
}
function bookById(id){ return state.data.books.find(b=>b.id===id); }
function recordsForBook(id){ return state.data.records.filter(r=>r.bookId===id).sort((a,b)=>`${recordWorkDate(b)}${b.createdAt||''}`.localeCompare(`${recordWorkDate(a)}${a.createdAt||''}`)); }
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
function dayTotals(date=todayWorkDate()){
  const rs=state.data.records.filter(r=>recordWorkDate(r)===date);
  return {duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),income:rs.reduce((a,r)=>a+recordAmount(r),0)};
}
function monthTotals(ym=currentYM()){
  const rs=state.data.records.filter(r=>recordWorkDate(r).slice(0,7)===ym);
  return {duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),income:rs.reduce((a,r)=>a+recordAmount(r),0)};
}
function availableYears(){
  const years=[];
  for(const r of state.data.records)years.push(Number(recordWorkDate(r).slice(0,4)));
  for(const s of state.data.settlements)years.push(Number(String(s.date||'').slice(0,4)));
  years.push(Number(todayWorkDate().slice(0,4)));
  return [...new Set(years.filter(Number.isFinite))].sort((a,b)=>b-a);
}
function statsPeriodBounds(){
  const workToday=todayWorkDate(); const currentYear=Number(workToday.slice(0,4)); const currentMonth=Number(workToday.slice(5,7));
  if(state.statsPeriod==='all')return {start:null,end:null,label:'全部历史'};
  if(state.statsPeriod==='year')return {start:`${currentYear}-01-01`,end:`${currentYear}-12-31`,label:`${currentYear} 年`};
  if(state.statsPeriod==='yearPick')return {start:`${state.statsYear}-01-01`,end:`${state.statsYear}-12-31`,label:`${state.statsYear} 年`};
  if(state.statsPeriod==='customMonth'){
    const ym=state.statsCustomMonth||currentYM(); const [y,m]=ym.split('-').map(Number);
    return {start:`${ym}-01`,end:`${ym}-${String(daysInMonth(y,m)).padStart(2,'0')}`,label:ym};
  }
  if(state.statsPeriod==='customRange'){
    const a=state.statsRangeStart||workToday,b=state.statsRangeEnd||workToday;
    return {start:a<=b?a:b,end:a<=b?b:a,label:`${a<=b?a:b} 至 ${a<=b?b:a}`};
  }
  const ym=`${currentYear}-${String(currentMonth).padStart(2,'0')}`;
  return {start:`${ym}-01`,end:`${ym}-${String(daysInMonth(currentYear,currentMonth)).padStart(2,'0')}`,label:'本月'};
}
function statsPeriodLabel(){return statsPeriodBounds().label;}
function dateInBounds(date,bounds=statsPeriodBounds()){
  const v=String(date||''); if(!v)return false;
  if(bounds.start&&v<bounds.start)return false; if(bounds.end&&v>bounds.end)return false; return true;
}
function dateInStatsPeriod(date){return dateInBounds(date);}
function outstandingAsOf(endDate=null){
  const rs=state.data.records.filter(r=>!endDate||recordWorkDate(r)<=endDate);
  const ss=state.data.settlements.filter(s=>!endDate||String(s.date||'')<=endDate);
  const receivable=rs.reduce((a,r)=>a+recordAmount(r),0), received=ss.reduce((a,s)=>a+(Number(s.amount)||0),0);
  return receivable-received;
}
function statsPeriodTotals(){
  const bounds=statsPeriodBounds();
  const rs=state.data.records.filter(r=>dateInBounds(recordWorkDate(r),bounds));
  const ss=state.data.settlements.filter(s=>dateInBounds(s.date,bounds));
  return {
    duration:rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),
    receivable:rs.reduce((a,r)=>a+recordAmount(r),0),
    received:ss.reduce((a,s)=>a+(Number(s.amount)||0),0),
    outstanding:outstandingAsOf(bounds.end),
    records:rs.length,
  };
}
function groupedPeriodStats(key){
  const groups=new Map(),bounds=statsPeriodBounds();
  for(const book of state.data.books){
    const name=String(book[key]||'').trim() || (key==='platform'?'未填写平台':'未填写甲方');
    if(!groups.has(name))groups.set(name,{name,duration:0,receivable:0,received:0,bookIds:[]});
    groups.get(name).bookIds.push(book.id);
  }
  for(const g of groups.values()){
    const set=new Set(g.bookIds);
    const rs=state.data.records.filter(r=>set.has(r.bookId)&&dateInBounds(recordWorkDate(r),bounds));
    const ss=state.data.settlements.filter(s=>set.has(s.bookId)&&dateInBounds(s.date,bounds));
    g.duration=rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0);
    g.receivable=rs.reduce((a,r)=>a+recordAmount(r),0);
    g.received=ss.reduce((a,s)=>a+(Number(s.amount)||0),0);
  }
  return [...groups.values()].filter(g=>g.duration||g.receivable||g.received).sort((a,b)=>b.receivable-a.receivable||b.received-a.received);
}
function annualYearFromSelection(){
  if(state.statsPeriod==='yearPick')return Number(state.statsYear);
  if(state.statsPeriod==='customMonth')return Number((state.statsCustomMonth||currentYM()).slice(0,4));
  if(state.statsPeriod==='customRange')return Number((state.statsRangeEnd||todayWorkDate()).slice(0,4));
  return Number(todayWorkDate().slice(0,4));
}
function annualReportData(year=annualYearFromSelection()){
  const prefix=String(year), rs=state.data.records.filter(r=>recordWorkDate(r).startsWith(prefix)), ss=state.data.settlements.filter(s=>String(s.date||'').startsWith(prefix));
  const duration=rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0), receivable=rs.reduce((a,r)=>a+recordAmount(r),0), received=ss.reduce((a,s)=>a+(Number(s.amount)||0),0);
  const workDays=[...new Set(rs.map(recordWorkDate))];
  const monthMap=Array.from({length:12},(_,i)=>({month:i+1,duration:0,receivable:0}));
  for(const r of rs){const m=Number(recordWorkDate(r).slice(5,7));monthMap[m-1].duration+=Number(r.durationSec)||0;monthMap[m-1].receivable+=recordAmount(r);}
  const activeMonths=monthMap.filter(x=>x.duration>0||x.receivable>0);
  const busiest=activeMonths.slice().sort((a,b)=>b.duration-a.duration)[0]||null;
  const bestIncome=activeMonths.slice().sort((a,b)=>b.receivable-a.receivable)[0]||null;
  const byClient=new Map(),byBook=new Map();
  for(const r of rs){const b=bookById(r.bookId);if(!b)continue;const client=b.client||'未填写甲方';byClient.set(client,(byClient.get(client)||0)+recordAmount(r));const x=byBook.get(b.id)||{name:b.title,duration:0};x.duration+=Number(r.durationSec)||0;byBook.set(b.id,x);}
  const topClient=[...byClient].sort((a,b)=>b[1]-a[1])[0]||null;
  const topBook=[...byBook.values()].sort((a,b)=>b.duration-a.duration)[0]||null;
  const finishedBooks=state.data.books.filter(b=>b.status==='finished'&&rs.some(r=>r.bookId===b.id)).length;
  return {year,duration,receivable,received,outstanding:outstandingAsOf(`${year}-12-31`),workDays:workDays.length,avgDay:workDays.length?duration/workDays.length:0,avgMonth:activeMonths.length?receivable/activeMonths.length:0,finishedBooks,busiest,bestIncome,topClient,topBook,monthMap};
}
function overallFinanceTotals(){
  const receivable=state.data.records.reduce((a,r)=>a+recordAmount(r),0),received=state.data.settlements.reduce((a,s)=>a+(Number(s.amount)||0),0);
  return {receivable,received,unreceived:receivable-received};
}
function settlementClientGroups(){
  const map=new Map();
  for(const b of state.data.books){const client=String(b.client||'未填写甲方').trim()||'未填写甲方';const t=bookTotals(b.id);if(!map.has(client))map.set(client,{client,receivable:0,received:0,unreceived:0,books:[]});const g=map.get(client);g.receivable+=t.receivable;g.received+=t.received;g.unreceived+=t.unreceived;g.books.push({book:b,totals:t});}
  return [...map.values()].filter(g=>Math.abs(g.unreceived)>0.005).sort((a,b)=>b.unreceived-a.unreceived);
}
function renderAll(){
  renderHome(); renderLibraryFilters(); renderBooks(); renderSettlementCenter(); renderStats(); renderSettingsSummary(); renderCloudOcrSettings(); renderWorkSettings(); renderExportOptions();
  if(state.selectedDetailBookId && document.getElementById('bookDetailModal').classList.contains('open')) renderBookDetail(state.selectedDetailBookId);
}
function renderGoals(td,mt){
  const dailySec=(Number(state.workSettings.dailyGoalMinutes)||0)*60, monthlySec=(Number(state.workSettings.monthlyGoalHours)||0)*3600;
  const dayPct=dailySec?clamp(td.duration/dailySec*100,0,100):0, monthPct=monthlySec?clamp(mt.duration/monthlySec*100,0,100):0;
  $('#todayGoalText').textContent=dailySec?`${secToText(td.duration)} / ${secToText(dailySec)} · ${Math.round(dayPct)}%`:'未设置';
  $('#monthGoalText').textContent=monthlySec?`${secToText(mt.duration)} / ${secToText(monthlySec)} · ${Math.round(monthPct)}%`:'未设置';
  $('#todayGoalBar').style.width=`${dayPct}%`; $('#monthGoalBar').style.width=`${monthPct}%`;
}
function renderHome(){
  const td=dayTotals(), mt=monthTotals();
  $('#todayDuration').textContent=secToText(td.duration);
  $('#todayIncome').textContent=`今日应收 ${money(td.income)}`;
  $('#monthDuration').textContent=secToText(mt.duration);
  $('#monthIncome').textContent=money(mt.income);
  renderGoals(td,mt);
  const active=state.data.books.filter(b=>b.status!=='finished');
  $('#activeBooks').innerHTML=active.length?active.map(bookCard).join(''):empty('还没有正在做的书，先新建一本。');
  const rs=state.data.records.filter(r=>recordWorkDate(r)===todayWorkDate()).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#todayRecords').innerHTML=rs.length?rs.map(recordCard).join(''):empty('今天还没有记录。拍照识别或手动新增都可以开始。');
  const undo=$('#undoLastImportBtn'),meta=state.data.meta?.lastImport;
  if(undo){const canUndo=!!meta&&(meta.createdRecordIds?.some(id=>state.data.records.some(r=>r.id===id))||meta.replacements?.length);undo.hidden=!canUndo;}
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
function renderSettlementCenter(){
  const t=overallFinanceTotals();
  if($('#settleTotalReceivable'))$('#settleTotalReceivable').textContent=money(t.receivable);
  if($('#settleTotalReceived'))$('#settleTotalReceived').textContent=money(t.received);
  if($('#settleTotalUnreceived'))$('#settleTotalUnreceived').textContent=money(t.unreceived);
  const groups=settlementClientGroups();
  if($('#settlementClientList'))$('#settlementClientList').innerHTML=groups.length?groups.map(g=>`<button class="settlement-client-card" type="button" data-settle-client="${escapeHtml(g.client)}"><div><span>甲方 / 工作室</span><strong>${escapeHtml(g.client)}</strong><small>${g.books.filter(x=>Math.abs(x.totals.unreceived)>0.005).length} 本未结清</small></div><div><span>未收</span><strong>${money(g.unreceived)}</strong><small>已收 ${money(g.received)}</small></div><span class="chev">›</span></button>`).join(''):empty('目前没有未收款。');
  const books=state.data.books.map(b=>({book:b,t:bookTotals(b.id)})).filter(x=>x.t.unreceived>0.005).sort((a,b)=>b.t.unreceived-a.t.unreceived);
  if($('#settlementBookList'))$('#settlementBookList').innerHTML=books.length?books.map(({book,t})=>`<article class="settlement-book-card"><button type="button" data-open-book="${book.id}"><div class="book-title">《${escapeHtml(book.title)}》</div><div class="book-meta"><span>${escapeHtml(book.client||'未填写甲方')}</span><span>·</span><span>${t.settledTo?`结至 ${t.settledTo} 集`:'尚未结算'}</span></div></button><div class="settlement-book-money"><span>未收</span><strong>${money(t.unreceived)}</strong><button type="button" data-add-settlement="${book.id}">记结算</button></div></article>`).join(''):empty('全部已结清。');
}
function renderYearOptions(){
  const years=availableYears();
  const ysel=$('#statsYearSelect'); if(ysel){ysel.innerHTML=years.map(y=>`<option value="${y}">${y} 年</option>`).join('');if(!years.includes(Number(state.statsYear)))state.statsYear=years[0];ysel.value=String(state.statsYear);}
}
function renderAnnualReport(){
  const d=annualReportData(); const el=$('#annualReport'); if(!el)return;
  $('#annualReportSub').textContent=`${d.year} 年全年工作概览`;
  const maxDur=Math.max(1,...d.monthMap.map(x=>x.duration));
  el.innerHTML=`<div class="annual-kpis"><div><span>全年成品</span><strong>${secToText(d.duration)}</strong></div><div><span>全年应收</span><strong>${money(d.receivable)}</strong></div><div><span>全年到账</span><strong>${money(d.received)}</strong></div><div><span>年末未收</span><strong>${money(d.outstanding)}</strong></div><div><span>工作天数</span><strong>${d.workDays} 天</strong></div><div><span>日均成品</span><strong>${secToText(d.avgDay)}</strong></div><div><span>月均应收</span><strong>${money(d.avgMonth)}</strong></div><div><span>涉及已完结</span><strong>${d.finishedBooks} 本</strong></div></div>
  <div class="annual-highlights"><div><span>最忙月份</span><strong>${d.busiest?`${d.busiest.month} 月 · ${secToText(d.busiest.duration)}`:'—'}</strong></div><div><span>收入最高月份</span><strong>${d.bestIncome?`${d.bestIncome.month} 月 · ${money(d.bestIncome.receivable)}`:'—'}</strong></div><div><span>合作最多收入甲方</span><strong>${d.topClient?`${escapeHtml(d.topClient[0])} · ${money(d.topClient[1])}`:'—'}</strong></div><div><span>投入最多的书</span><strong>${d.topBook?`《${escapeHtml(d.topBook.name)}》 · ${secToText(d.topBook.duration)}`:'—'}</strong></div></div>
  <div class="month-bars">${d.monthMap.map(m=>`<div class="month-bar" title="${m.month}月 ${secToText(m.duration)}"><i style="height:${Math.max(3,m.duration/maxDur*100)}%"></i><span>${m.month}</span></div>`).join('')}</div>`;
}
function renderStats(){
  renderYearOptions();
  const td=dayTotals(), mt=monthTotals(), pt=statsPeriodTotals();
  if($('#statsPeriodSelect'))$('#statsPeriodSelect').value=state.statsPeriod;
  $('#statsTodayDuration').textContent=secToText(td.duration);
  $('#statsTodayIncome').textContent=money(td.income);
  $('#statsMonthDuration').textContent=secToText(mt.duration);
  $('#statsMonthIncome').textContent=money(mt.income);
  $('#statsPeriodLabel').textContent=statsPeriodLabel();
  $('#statsPeriodDuration').textContent=secToText(pt.duration);
  $('#statsPeriodReceivable').textContent=money(pt.receivable);
  $('#statsPeriodReceived').textContent=money(pt.received);
  $('#statsPeriodOutstanding').textContent=money(pt.outstanding);
  $('#statsPeriodRecords').textContent=`${pt.records} 条`;
  $('#statsYearWrap').hidden=state.statsPeriod!=='yearPick';
  $('#statsCustomMonthWrap').hidden=state.statsPeriod!=='customMonth';
  $('#statsCustomRangeWrap').hidden=state.statsPeriod!=='customRange';
  $('#statsCustomMonth').value=state.statsCustomMonth; $('#statsRangeStart').value=state.statsRangeStart; $('#statsRangeEnd').value=state.statsRangeEnd;
  const quick=$('#statsMonthQuick'); if(quick){const show=state.statsPeriod==='year'||state.statsPeriod==='yearPick';quick.hidden=!show;if(show){const y=state.statsPeriod==='yearPick'?state.statsYear:Number(todayWorkDate().slice(0,4));quick.innerHTML=Array.from({length:12},(_,i)=>`<button type="button" data-quick-month="${y}-${String(i+1).padStart(2,'0')}">${i+1}月</button>`).join('');}}
  const bounds=statsPeriodBounds();
  const books=state.data.books.filter(b=>state.data.records.some(r=>r.bookId===b.id&&dateInBounds(recordWorkDate(r),bounds))||state.data.settlements.some(x=>x.bookId===b.id&&dateInBounds(x.date,bounds)));
  $('#statsBookList').innerHTML=books.length?books.map(b=>statBookCard(b,bounds)).join(''):empty('这个统计周期里还没有按书数据。');
  const ps=groupedPeriodStats('platform'), cs=groupedPeriodStats('client');
  $('#statsPlatformList').innerHTML=ps.length?ps.map(g=>groupStatCard('platform',g)).join(''):empty('这个统计周期里还没有平台数据。');
  $('#statsClientList').innerHTML=cs.length?cs.map(g=>groupStatCard('client',g)).join(''):empty('这个统计周期里还没有甲方数据。');
  renderAnnualReport();
}
function renderSettingsSummary(){
  const el=$('#settingsDataSummary'); if(!el)return;
  el.innerHTML=`<div class="settings-summary-grid"><div><span>书籍</span><strong>${state.data.books.length}</strong></div><div><span>录音记录</span><strong>${state.data.records.length}</strong></div><div><span>结算记录</span><strong>${state.data.settlements.length}</strong></div></div>`;
}
function renderWorkSettings(){
  if($('#workdayCutoff'))$('#workdayCutoff').value=state.workSettings.cutoff||'06:00';
  if($('#dailyGoalMinutes'))$('#dailyGoalMinutes').value=state.workSettings.dailyGoalMinutes||'';
  if($('#monthlyGoalHours'))$('#monthlyGoalHours').value=state.workSettings.monthlyGoalHours||'';
}
function renderExportOptions(){
  const years=availableYears(),clients=uniqueSorted(state.data.books.map(b=>b.client)),books=state.data.books.slice().sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
  if($('#csvYear'))$('#csvYear').innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');
  if($('#csvMonth')&&!$('#csvMonth').value)$('#csvMonth').value=currentYM();
  if($('#csvClient'))$('#csvClient').innerHTML=clients.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if($('#csvBook'))$('#csvBook').innerHTML=books.map(b=>`<option value="${b.id}">《${escapeHtml(b.title)}》</option>`).join('');
  updateCsvScopeUI();
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
  return `<button class="record-card record-card-btn" type="button" data-edit-record="${rec.id}"><div><strong>${b?`《${escapeHtml(b.title)}》`:'未匹配项目'}</strong><div class="small">${rec.episodeStart}-${rec.episodeEnd} 集 · ${recordWorkDate(rec)}</div></div><div class="record-duration">${secToClock(rec.durationSec)}</div></button>`;
}
function statBookCard(book,bounds=null){
  if(!bounds){const t=bookTotals(book.id);return `<button class="stat-book-card" type="button" data-open-book="${book.id}"><div class="book-title">《${escapeHtml(book.title)}》</div><div class="book-meta"><span>${secToText(t.duration)}</span><span>·</span><span>录至 ${t.currentProgress||'-'} 集</span><span class="settlement-status ${t.settlement}">${settlementLabel(t.settlement)}</span></div><div class="money-row"><div><span>应收</span><strong>${money(t.receivable)}</strong></div><div><span>已收</span><strong>${money(t.received)}</strong></div><div><span>未收</span><strong>${money(t.unreceived)}</strong></div></div></button>`;}
  const rs=state.data.records.filter(r=>r.bookId===book.id&&dateInBounds(recordWorkDate(r),bounds));
  const ss=state.data.settlements.filter(x=>x.bookId===book.id&&dateInBounds(x.date,bounds));
  const duration=rs.reduce((a,r)=>a+(Number(r.durationSec)||0),0),receivable=rs.reduce((a,r)=>a+recordAmount(r),0),received=ss.reduce((a,x)=>a+(Number(x.amount)||0),0);
  const total=bookTotals(book.id);
  return `<button class="stat-book-card" type="button" data-open-book="${book.id}"><div class="book-title">《${escapeHtml(book.title)}》</div><div class="book-meta"><span>${secToText(duration)}</span><span>·</span><span>录至 ${total.currentProgress||'-'} 集</span><span class="settlement-status ${total.settlement}">${settlementLabel(total.settlement)}</span></div><div class="money-row"><div><span>周期应收</span><strong>${money(receivable)}</strong></div><div><span>周期到账</span><strong>${money(received)}</strong></div><div><span>当前未收</span><strong>${money(total.unreceived)}</strong></div></div></button>`;
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
  const trash=state.data.trashRecords.filter(x=>x.record?.bookId===id).sort((a,b)=>String(b.deletedAt||'').localeCompare(String(a.deletedAt||'')));
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
    <section class="section-block"><div class="section-head"><div><h2>录音记录</h2><p>${rs.length} 条 · 可修改或删除</p></div></div>
      <div class="history-list">${rs.length?rs.map(r=>`<button class="history-row history-row-btn" type="button" data-edit-record="${r.id}"><div><strong>${r.episodeStart}-${r.episodeEnd} 集</strong><div class="muted">工作日 ${recordWorkDate(r)}</div></div><div class="history-right"><strong>${secToClock(r.durationSec)}</strong><span>编辑 ›</span></div></button>`).join(''):empty('还没有录音记录。')}</div>
    </section>
    <section class="section-block"><div class="section-head"><div><h2>结算记录</h2><p>${ss.length} 笔</p></div></div>
      <div class="history-list">${ss.length?ss.map(s=>`<div class="history-row"><div><strong>结算至 ${s.settlementTo} 集</strong><div class="muted">${s.date}</div></div><strong>${money(s.amount)}</strong></div>`).join(''):empty('还没有结算记录。')}</div>
    </section>
    <section class="section-block"><div class="section-head"><div><h2>最近删除</h2><p>${trash.length} 条，可恢复</p></div></div>
      <div class="history-list">${trash.length?trash.slice(0,20).map(x=>`<div class="history-row"><div><strong>${x.record.episodeStart}-${x.record.episodeEnd} 集 · ${secToClock(x.record.durationSec)}</strong><div class="muted">删除于 ${String(x.deletedAt||'').replace('T',' ').slice(0,16)}</div></div><button class="restore-btn" type="button" data-restore-record="${x.id}">恢复</button></div>`).join(''):empty('没有已删除记录。')}</div>
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

function openRecordEditor(recordId){
  const r=state.data.records.find(x=>x.id===recordId);if(!r)return;
  $('#recordId').value=r.id;
  $('#recordBookId').innerHTML=state.data.books.map(b=>`<option value="${b.id}" ${b.id===r.bookId?'selected':''}>《${escapeHtml(b.title)}》 · ${escapeHtml(b.alias)}</option>`).join('');
  $('#recordEpisodeStart').value=r.episodeStart||'';$('#recordEpisodeEnd').value=r.episodeEnd||'';$('#recordDuration').value=secToClock(r.durationSec);$('#recordWorkDate').value=recordWorkDate(r);
  openModal('recordModal');
}
function moveRecordToTrash(recordId,reason='manual'){
  const idx=state.data.records.findIndex(r=>r.id===recordId);if(idx<0)return false;
  const [record]=state.data.records.splice(idx,1);state.data.trashRecords.unshift({id:uid('trash'),record,deletedAt:new Date().toISOString(),reason});return true;
}
function restoreTrashRecord(trashId){
  const idx=state.data.trashRecords.findIndex(x=>x.id===trashId);if(idx<0)return;
  const item=state.data.trashRecords[idx],rec=item.record;
  const duplicate=state.data.records.some(r=>r.bookId===rec.bookId&&Number(r.episodeStart)===Number(rec.episodeStart)&&Number(r.episodeEnd)===Number(rec.episodeEnd)&&Number(r.durationSec)===Number(rec.durationSec));
  if(duplicate&&!confirm('当前已经有一条完全相同的记录。仍然恢复吗？'))return;
  state.data.trashRecords.splice(idx,1);if(state.data.records.some(r=>r.id===rec.id))rec.id=uid('rec');state.data.records.push(rec);saveData();toast('记录已恢复');
}
function undoLastImport(){
  const meta=state.data.meta?.lastImport;if(!meta){toast('没有可撤销的导入');return;}
  const created=(meta.createdRecordIds||[]).filter(id=>state.data.records.some(r=>r.id===id));
  if(!created.length&&!(meta.replacements||[]).length){toast('上次导入已经无法撤销');return;}
  if(!confirm(`撤销上次导入？\n\n将撤销 ${created.length} 条新增记录${(meta.replacements||[]).length?`，并恢复 ${(meta.replacements||[]).length} 条被替换记录`:''}。`))return;
  for(const id of created)moveRecordToTrash(id,'undo-import');
  for(const rep of (meta.replacements||[])){const current=state.data.records.find(r=>r.id===rep.recordId);if(current)Object.assign(current,rep.before);else state.data.records.push(rep.before);}
  delete state.data.meta.lastImport;saveData();toast('已撤销上次导入');
}
$('#recordForm').addEventListener('submit',e=>{
  e.preventDefault();const r=state.data.records.find(x=>x.id===$('#recordId').value);if(!r)return;
  const a=Number($('#recordEpisodeStart').value),b=Number($('#recordEpisodeEnd').value),sec=parseClock($('#recordDuration').value),bookId=$('#recordBookId').value,workDate=$('#recordWorkDate').value;
  if(!bookId||!a||!b||b<a||!sec||!workDate){toast('请检查书籍、集数、日期和时长');return;}
  const exact=state.data.records.find(x=>x.id!==r.id&&x.bookId===bookId&&Number(x.episodeStart)===a&&Number(x.episodeEnd)===b&&Number(x.durationSec)===sec);
  if(exact&&!confirm('已有完全相同的记录。仍然保存修改吗？'))return;
  Object.assign(r,{bookId,episodeStart:a,episodeEnd:b,durationSec:sec,rateSnapshot:Number(bookById(bookId)?.rate||0),date:workDate,workDate,workDateManual:true,updatedAt:new Date().toISOString()});saveData();closeModal('recordModal');toast('录音记录已更新');
});
$('#deleteRecordBtn').addEventListener('click',()=>{const id=$('#recordId').value;if(!id)return;if(!confirm('删除这条录音记录？它会先进入“最近删除”，可以恢复。'))return;moveRecordToTrash(id);saveData();closeModal('recordModal');toast('记录已移到最近删除');});
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
  const raw=String(text||''),t=raw.replace(/\s+/g,'');
  if(/返音|反音/.test(t))return true;
  const ep=extractEpisodeRange(raw),prefix=ep?raw.slice(0,Math.max(0,ep.index||0)):raw;
  const pcn=chineseOnly(prefix),known=findKnownAliasInText(raw);
  if(!known && (pcn==='音'||pcn==='返音'||pcn==='反音'||(pcn.length<=3&&(levenshtein(pcn,'返音')<=1||levenshtein(pcn,'反音')<=1))))return true;
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
  let m=line.match(/(\d(?:\s*\d){0,4})\s*(?:-|至|到)\s*(\d(?:\s*\d){0,4})/);
  if(m){const a=Number(m[1].replace(/\s+/g,'')),b=Number(m[2].replace(/\s+/g,''));return {start:a,end:b,index:m.index||0,raw:m[0]};}
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
async function fileToDataUrl(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});
    const srcW=img.naturalWidth||img.width,srcH=img.naturalHeight||img.height;
    const maxSide=2200,scale=Math.min(1,maxSide/Math.max(srcW,srcH));
    const w=Math.max(1,Math.round(srcW*scale)),h=Math.max(1,Math.round(srcH*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL('image/jpeg',0.9);
  }finally{URL.revokeObjectURL(url);}
}
function cloudEndpoint(){return String(localStorage.getItem(CLOUD_OCR_ENDPOINT_KEY)||'').trim().replace(/\/+$/,'');}
function normalizeCloudDuration(v){
  const raw=String(v||'').trim().replace(/：/g,':');
  if(!raw)return '';
  const m=raw.match(/\d{1,3}:\d{2}:\d{2}|\d{1,3}:\d{2}/);
  if(!m)return '';
  const sec=parseClock(m[0]); return sec?secToClock(sec):'';
}
function resolveCloudBook(rec){
  const exact=String(rec.matched_alias||'').trim();
  if(exact){
    const b=state.data.books.find(x=>normalizeAlias(x.alias)===normalizeAlias(exact) || normalizeAlias(x.title)===normalizeAlias(exact));
    if(b)return b;
  }
  const raw=String(rec.raw_alias||'').trim();
  return raw?findBookByAlias(raw):null;
}
function cloudRecordsToDrafts(records,imageDate,sourceTimestamp=null){
  const drafts=[]; const seen=new Set();
  for(const rec of Array.isArray(records)?records:[]){
    if(rec?.ignored)continue;
    let a=Number(rec?.episode_start)||0,b=Number(rec?.episode_end)||0;
    if(a<1||b<a||b-a>5000){a=0;b=0;}
    const durationText=normalizeCloudDuration(rec?.duration);
    const book=resolveCloudBook(rec);
    const rawAlias=String(rec?.raw_alias||'').trim();
    const alias=book?.alias||String(rec?.matched_alias||'').trim()||rawAlias;
    if(!alias&&!a&&!b&&!durationText)continue;
    const key=[normalizeAlias(alias),a,b,durationText].join('|');
    if(seen.has(key))continue;seen.add(key);
    drafts.push({
      id:uid('draft'),alias,episodeStart:a||'',episodeEnd:b||'',durationText,date:imageDate,sourceTimestamp,workDateManual:false,
      bookId:book?.id||'',sourceLine:String(rec?.raw_filename||'').trim(),ocrTexts:[String(rec?.raw_filename||'').trim()].filter(Boolean),
      cloudConfidence:String(rec?.confidence||''),conflictAction:''
    });
  }
  return drafts;
}
async function callCloudOcr(imageDataUrl){
  const endpoint=cloudEndpoint();
  if(!endpoint)throw new Error('NO_ENDPOINT');
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await fetch(`${endpoint}/ocr`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({
        image_data_url:imageDataUrl,
        books:state.data.books.map(b=>({title:b.title,alias:b.alias})),
      })
    });
    let data={};try{data=await response.json();}catch(_){ }
    if(!response.ok)throw new Error(data?.error||`HTTP_${response.status}`);
    if(!Array.isArray(data.records))throw new Error('BAD_RESPONSE');
    return data;
  }finally{clearTimeout(timer);}
}
async function processImages(files){
  if(!files?.length)return;
  if(!cloudEndpoint()){
    toast('先到“设置”填写云端视觉 OCR 地址');switchView('settings');return;
  }
  $('#ocrProgress').hidden=false;$('#ocrPreview').hidden=true;setProgress(2,'正在准备照片…');
  try{
    let drafts=[],ignoredCount=0;
    for(let fi=0;fi<files.length;fi++){
      const f=files[fi],d=new Date(f.lastModified||Date.now()),sourceTimestamp=Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(),imageDate=workDateForTimestamp(sourceTimestamp);
      setProgress(8+Math.round(fi/files.length*72),`第 ${fi+1}/${files.length} 张：正在上传给火山云 OCR…`);
      const imageDataUrl=await fileToDataUrl(f);
      setProgress(16+Math.round(fi/files.length*72),`第 ${fi+1}/${files.length} 张：正在识别文字并配对书名、集数和时长…`);
      const result=await callCloudOcr(imageDataUrl);
      ignoredCount+=Number(result.ignored_count)||0;
      drafts=drafts.concat(cloudRecordsToDrafts(result.records,imageDate,sourceTimestamp));
    }
    state.ocrDrafts=drafts.length?drafts:[blankDraft()];refreshDraftBookMatches();renderOcrDrafts();$('#ocrPreview').hidden=false;
    setProgress(100,'识别完成');
    if(!drafts.length)toast('云端没有抓到可用记录，可以手动补录');
    else toast(`云端识别到 ${drafts.length} 条${ignoredCount?`，过滤 ${ignoredCount} 条返音`:''}`);
  }catch(err){
    console.error(err);
    if(err?.name==='AbortError')toast('云端识别超时，请检查网络后重试');
    else if(err?.message==='NO_ENDPOINT')toast('先在设置里配置云端识别地址');
    else toast(`云端识别失败：${String(err?.message||'请检查服务设置')}`);
  }finally{$('#ocrProgress').hidden=true;}
}
function setProgress(pct,text){$('#ocrProgressPct').textContent=`${clamp(pct,0,100)}%`;$('#ocrProgressBar').style.width=`${clamp(pct,0,100)}%`;if(text)$('#ocrProgressText').textContent=text;}
function blankDraft(){return {id:uid('draft'),alias:'',episodeStart:'',episodeEnd:'',durationText:'',date:todayWorkDate(),bookId:'',sourceTimestamp:new Date().toISOString(),workDateManual:true,conflictAction:''};}
function addManualDraft(){
  state.ocrDrafts.push(blankDraft()); renderOcrDrafts(); $('#ocrPreview').hidden=false;
  setTimeout(()=>{const rows=document.querySelectorAll('.ocr-row');rows[rows.length-1]?.scrollIntoView({behavior:'smooth',block:'center'});},50);
}
function draftDuplicateInfo(d){
  if(!d.bookId||!d.episodeStart||!d.episodeEnd)return {type:'none',record:null};
  const sec=parseClock(d.durationText);
  const sameRange=state.data.records.filter(r=>r.bookId===d.bookId&&Number(r.episodeStart)===Number(d.episodeStart)&&Number(r.episodeEnd)===Number(d.episodeEnd));
  if(!sameRange.length)return {type:'none',record:null};
  const exact=sameRange.find(r=>sec&&Number(r.durationSec)===Number(sec));
  if(exact)return {type:'exact',record:exact};
  if(sec)return {type:'conflict',record:sameRange[0]};
  return {type:'none',record:sameRange[0]};
}
function refreshDraftBookMatches(){
  for(const d of state.ocrDrafts){
    if(!d.bookId || !bookById(d.bookId)){
      const b=findBookByAlias(d.alias);
      if(b){d.bookId=b.id;d.alias=b.alias;}
    }
    const info=draftDuplicateInfo(d);d.duplicateType=info.type;d.duplicateRecordId=info.record?.id||'';
    if(info.type!=='conflict')d.conflictAction='';
  }
}
function renderOcrDrafts(){
  refreshDraftBookMatches();
  const root=$('#ocrRows'); if(!root)return;
  root.innerHTML=state.ocrDrafts.map((d,i)=>{
    const missing=[]; if(!d.bookId)missing.push('项目'); if(!d.episodeStart||!d.episodeEnd)missing.push('集数'); if(!parseClock(d.durationText))missing.push('时长');
    let badge=missing.length?`<span class="badge-warn">待确认：${missing.join(' / ')}</span>`:`<span class="pill ongoing">信息完整</span>`;
    if(d.duplicateType==='exact')badge='<span class="badge-duplicate">已记录 · 保存时自动跳过</span>';
    if(d.duplicateType==='conflict')badge='<span class="badge-conflict">同集数已存在，但时长不同</span>';
    const conflict=d.duplicateType==='conflict'?`<div class="conflict-box"><div>已有记录：${secToClock(state.data.records.find(r=>r.id===d.duplicateRecordId)?.durationSec||0)} · 本次：${escapeHtml(formatDurationInput(d.durationText)||d.durationText)}</div><div><button type="button" class="${d.conflictAction==='replace'?'active':''}" data-conflict-action="replace" data-id="${d.id}">替换旧记录</button><button type="button" class="${d.conflictAction==='add'?'active':''}" data-conflict-action="add" data-id="${d.id}">仍然新增</button></div></div>`:'';
    return `<div class="ocr-row ${d.duplicateType==='exact'?'duplicate-row':''}" data-draft-id="${d.id}">
      <div class="ocr-row-top"><strong>记录 ${i+1}</strong><div>${badge} <button class="ocr-remove" data-remove-draft="${d.id}" type="button">×</button></div></div>
      <div class="ocr-fields">
        <label>归入书籍<select data-field="bookId" data-id="${d.id}"><option value="">请选择书籍</option>${state.data.books.map(b=>`<option value="${b.id}" ${b.id===d.bookId?'selected':''}>《${escapeHtml(b.title)}》 · ${escapeHtml(b.alias)}</option>`).join('')}</select></label>
        <label>文件简称<input data-field="alias" data-id="${d.id}" value="${escapeHtml(d.alias)}" placeholder="双修" /></label>
        <label>工作日期<input type="date" data-field="date" data-id="${d.id}" value="${d.date||todayWorkDate()}" /></label>
        <label>起始集<input type="number" inputmode="numeric" data-field="episodeStart" data-id="${d.id}" value="${d.episodeStart??''}" placeholder="394" /></label>
        <label>结束集<input type="number" inputmode="numeric" data-field="episodeEnd" data-id="${d.id}" value="${d.episodeEnd??''}" placeholder="414" /></label>
        <label>成品时长<input inputmode="numeric" data-field="durationText" data-id="${d.id}" value="${escapeHtml(d.durationText||'')}" placeholder="012523 → 01:25:23" /></label>
      </div>${conflict}
    </div>`;
  }).join('');
  const exact=state.ocrDrafts.filter(d=>d.duplicateType==='exact').length;
  if(exact&&state.ocrDrafts.length)$('#saveOcrBtn').textContent=`确认保存（将自动跳过 ${exact} 条重复）`;else $('#saveOcrBtn').textContent='确认保存';
}
function syncDraftFromInput(el,rerender=false){
  const d=state.ocrDrafts.find(x=>x.id===el.dataset.id); if(!d)return;
  d[el.dataset.field]=el.value;
  if(el.dataset.field==='date')d.workDateManual=true;
  if(el.dataset.field==='alias' && !d.bookId){const b=findBookByAlias(el.value);d.bookId=b?.id||'';if(b)d.alias=b.alias;rerender=true;}
  if(el.dataset.field==='bookId' && d.bookId){const b=bookById(d.bookId);if(b)d.alias=b.alias;rerender=true;}
  d.conflictAction=''; refreshDraftBookMatches(); if(rerender)renderOcrDrafts();
}
function setDraftConflictAction(id,action){const d=state.ocrDrafts.find(x=>x.id===id);if(!d)return;d.conflictAction=action;renderOcrDrafts();}
function saveOcrDrafts(){
  refreshDraftBookMatches();
  const candidates=[];let skipped=0;
  for(let i=0;i<state.ocrDrafts.length;i++){
    const d=state.ocrDrafts[i],label=`记录 ${i+1}`;
    if(d.duplicateType==='exact'){skipped++;continue;}
    if(!d.bookId){toast(`${label}：请选择归入书籍`);return;}
    if(!String(d.episodeStart).trim()){toast(`${label}：请填写起始集`);return;}
    if(!String(d.episodeEnd).trim()){toast(`${label}：请填写结束集`);return;}
    if(Number(d.episodeEnd)<Number(d.episodeStart)){toast(`${label}：结束集不能小于起始集`);return;}
    if(!parseClock(d.durationText)){toast(`${label}：时长无效，可输入 012523、2523、25:23 或 01:25:23`);return;}
    if(d.duplicateType==='conflict'&&!['replace','add'].includes(d.conflictAction)){toast(`${label}：同集数已有记录，请先选择“替换旧记录”或“仍然新增”`);return;}
    candidates.push(d);
  }
  if(!candidates.length){toast(skipped?`没有新记录，已跳过 ${skipped} 条重复`:'还没有可保存的记录');return;}
  const batchId=uid('batch'),createdRecordIds=[],replacements=[];
  for(const d of candidates){
    const payload={bookId:d.bookId,episodeStart:Number(d.episodeStart),episodeEnd:Number(d.episodeEnd),durationSec:parseClock(d.durationText),rateSnapshot:Number(bookById(d.bookId)?.rate||0),date:d.date||todayWorkDate(),workDate:d.date||todayWorkDate(),workDateManual:d.workDateManual!==false,sourceTimestamp:d.sourceTimestamp||new Date().toISOString(),createdAt:new Date().toISOString(),importBatchId:batchId};
    if(d.duplicateType==='conflict'&&d.conflictAction==='replace'){
      const old=state.data.records.find(r=>r.id===d.duplicateRecordId);
      if(old){replacements.push({recordId:old.id,before:JSON.parse(JSON.stringify(old))});Object.assign(old,payload,{id:old.id,updatedAt:new Date().toISOString()});continue;}
    }
    const rec={id:uid('rec'),...payload};state.data.records.push(rec);createdRecordIds.push(rec.id);
  }
  state.data.meta.lastImport={batchId,createdAt:new Date().toISOString(),createdRecordIds,replacements};
  state.ocrDrafts=[];saveData();renderOcrDrafts();$('#ocrPreview').hidden=true;
  toast(`已保存 ${candidates.length} 条新记录${skipped?`，跳过 ${skipped} 条重复`:''}`);switchView('home');
}
function renderCloudOcrSettings(){
  const input=$('#cloudOcrEndpoint'),status=$('#cloudOcrStatus'); if(!input||!status)return;
  const ep=cloudEndpoint(); if(document.activeElement!==input)input.value=ep;
  status.textContent=ep?'已保存识别服务地址':'尚未配置'; status.className=`cloud-status ${ep?'ok':''}`;
}
function saveCloudOcrEndpoint(){
  const input=$('#cloudOcrEndpoint'); if(!input)return;
  const value=String(input.value||'').trim().replace(/\/+$/,'');
  if(value && !/^https:\/\//i.test(value)){toast('识别服务地址需要以 https:// 开头');return;}
  if(value)localStorage.setItem(CLOUD_OCR_ENDPOINT_KEY,value);else localStorage.removeItem(CLOUD_OCR_ENDPOINT_KEY);
  renderCloudOcrSettings();toast(value?'云端识别地址已保存':'已清除云端识别地址');
}
async function testCloudOcrEndpoint(){
  const input=$('#cloudOcrEndpoint'),status=$('#cloudOcrStatus'); if(!input||!status)return;
  const value=String(input.value||'').trim().replace(/\/+$/,'');
  if(!value){toast('先填写识别服务地址');return;}
  status.textContent='正在测试连接…';status.className='cloud-status';
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
    const r=await fetch(`${value}/health`,{signal:controller.signal});clearTimeout(timer);
    const data=await r.json();if(!r.ok||!data.ok)throw new Error(data?.error||`HTTP_${r.status}`);
    localStorage.setItem(CLOUD_OCR_ENDPOINT_KEY,value);status.textContent=`连接正常 · ${data.provider||data.model||'云端 OCR'}`;status.className='cloud-status ok';toast('火山云 OCR 已连接');
  }catch(err){status.textContent=`连接失败：${String(err?.message||'无法访问')}`;status.className='cloud-status bad';toast('云端识别服务没有连通');}
}

function saveWorkSettingsFromUI(){
  const cutoff=$('#workdayCutoff').value||'06:00',daily=Math.max(0,Number($('#dailyGoalMinutes').value||0)),monthly=Math.max(0,Number($('#monthlyGoalHours').value||0));
  state.workSettings={cutoff,dailyGoalMinutes:daily,monthlyGoalHours:monthly};saveWorkSettings();renderAll();toast(`工作日将在 ${cutoff} 切换`);
}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportBackup(){
  const payload={app:'VoiceLedger',version:'0.7-beta',exportedAt:new Date().toISOString(),workSettings:state.workSettings,data:state.data};
  downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),`VoiceLedger-backup-${todayISO()}.json`); toast('JSON 备份已导出');
}
async function importBackupFile(file){
  if(!file)return;
  try{
    const raw=JSON.parse(await file.text()); const data=raw?.data||raw;
    if(!data || !Array.isArray(data.books)||!Array.isArray(data.records)||!Array.isArray(data.settlements))throw new Error('bad format');
    if(!confirm(`将用备份覆盖当前数据。\n\n备份里有 ${data.books.length} 本书、${data.records.length} 条录音记录、${data.settlements.length} 条结算记录。\n\n继续吗？`))return;
    state.data=normalizeDataShape(data);
    if(raw?.workSettings){state.workSettings={...state.workSettings,...raw.workSettings};saveWorkSettings();}
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state.data)); refreshDraftBookMatches(); renderOcrDrafts(); renderAll(); toast('备份已导入');
  }catch(err){console.error(err);toast('这个文件不是有效的声账备份');}
}
function updateCsvScopeUI(){
  const scope=$('#csvScope')?.value||'all';
  for(const [id,type] of [['csvYearWrap','year'],['csvMonthWrap','month'],['csvClientWrap','client'],['csvBookWrap','book']]){const el=$(`#${id}`);if(el)el.hidden=scope!==type;}
}
function csvRecordsForScope(){
  const scope=$('#csvScope')?.value||'all'; let rs=state.data.records.slice();
  if(scope==='year'){const y=String($('#csvYear').value);rs=rs.filter(r=>recordWorkDate(r).startsWith(y));}
  if(scope==='month'){const ym=$('#csvMonth').value;rs=rs.filter(r=>recordWorkDate(r).startsWith(ym));}
  if(scope==='client'){const client=$('#csvClient').value;const ids=new Set(state.data.books.filter(b=>b.client===client).map(b=>b.id));rs=rs.filter(r=>ids.has(r.bookId));}
  if(scope==='book'){const id=$('#csvBook').value;rs=rs.filter(r=>r.bookId===id);}
  return rs.sort((a,b)=>recordWorkDate(a).localeCompare(recordWorkDate(b))||(a.createdAt||'').localeCompare(b.createdAt||''));
}
function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function exportCsv(){
  const rs=csvRecordsForScope();if(!rs.length){toast('这个范围没有可导出的录音记录');return;}
  const headers=['工作日期','实际记录时间','书名','文件简称','甲方','平台','起始集','结束集','成品时长','小时单价','应收金额','当前结算状态','已结算至'];
  const rows=rs.map(r=>{const b=bookById(r.bookId),t=b?bookTotals(b.id):{settlement:'',settledTo:''};return [recordWorkDate(r),r.sourceTimestamp||r.createdAt||'',b?.title||'',b?.alias||'',b?.client||'',b?.platform||'',r.episodeStart,r.episodeEnd,secToClock(r.durationSec),Number(Number.isFinite(Number(r.rateSnapshot))?r.rateSnapshot:(b?.rate||0)).toFixed(2),recordAmount(r).toFixed(2),settlementLabel(t.settlement),t.settledTo||''];});
  const text='\uFEFF'+[headers,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n');
  const scope=$('#csvScope')?.value||'all';downloadBlob(new Blob([text],{type:'text/csv;charset=utf-8'}),`VoiceLedger-${scope}-${todayISO()}.csv`);toast(`已导出 ${rs.length} 条 CSV 流水`);
}
// Events
$('.tabbar').addEventListener('click',e=>{const btn=e.target.closest('.tab');if(btn)switchView(btn.dataset.view);});
$('#homeCameraBtn').addEventListener('click',()=>switchView('camera'));
$('#homeNewBookBtn').addEventListener('click',()=>openBookForm()); $('#newBookBtn').addEventListener('click',()=>openBookForm());
$('#takePhotoBtn').addEventListener('click',()=>$('#cameraInput').click()); $('#choosePhotoBtn').addEventListener('click',()=>$('#photoInput').click()); $('#manualRecordBtn').addEventListener('click',addManualDraft);
$('#cameraInput').addEventListener('change',e=>{processImages([...e.target.files]);e.target.value='';}); $('#photoInput').addEventListener('change',e=>{processImages([...e.target.files]);e.target.value='';});
$('#clearOcrBtn').addEventListener('click',()=>{state.ocrDrafts=[];$('#ocrPreview').hidden=true;}); $('#saveOcrBtn').addEventListener('click',saveOcrDrafts);
$('#ocrRows').addEventListener('input',e=>{if(e.target.dataset.field)syncDraftFromInput(e.target,false)}); $('#ocrRows').addEventListener('change',e=>{if(e.target.dataset.field)syncDraftFromInput(e.target,true)});
$('#ocrRows').addEventListener('focusout',e=>{if(e.target.dataset.field==='durationText'){const formatted=formatDurationInput(e.target.value);e.target.value=formatted;syncDraftFromInput(e.target,true);}});
$('#ocrRows').addEventListener('click',e=>{const id=e.target.dataset.removeDraft;if(id){state.ocrDrafts=state.ocrDrafts.filter(d=>d.id!==id);renderOcrDrafts();if(!state.ocrDrafts.length)$('#ocrPreview').hidden=true;return;}const action=e.target.dataset.conflictAction;if(action)setDraftConflictAction(e.target.dataset.id,action);});
$('#bookFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.bookFilter=b.dataset.filter;document.querySelectorAll('.filter-chip').forEach(x=>x.classList.toggle('active',x===b));renderBooks();});
$('#bookPlatformFilter').addEventListener('change',e=>{state.platformFilter=e.target.value;renderBooks();});
$('#bookClientFilter').addEventListener('change',e=>{state.clientFilter=e.target.value;renderBooks();});
$('#statsPeriodSelect').addEventListener('change',e=>{state.statsPeriod=e.target.value;renderStats();});
$('#statsYearSelect').addEventListener('change',e=>{state.statsYear=Number(e.target.value);state.statsPeriod='yearPick';renderStats();});
$('#statsCustomMonth').addEventListener('change',e=>{state.statsCustomMonth=e.target.value||currentYM();state.statsPeriod='customMonth';$('#statsPeriodSelect').value='customMonth';renderStats();});
$('#statsRangeStart').addEventListener('change',e=>{state.statsRangeStart=e.target.value||todayWorkDate();state.statsPeriod='customRange';$('#statsPeriodSelect').value='customRange';renderStats();});
$('#statsRangeEnd').addEventListener('change',e=>{state.statsRangeEnd=e.target.value||todayWorkDate();state.statsPeriod='customRange';$('#statsPeriodSelect').value='customRange';renderStats();});
$('#saveCloudOcrBtn').addEventListener('click',saveCloudOcrEndpoint); $('#testCloudOcrBtn').addEventListener('click',testCloudOcrEndpoint);
$('#saveWorkSettingsBtn').addEventListener('click',saveWorkSettingsFromUI);
$('#undoLastImportBtn').addEventListener('click',undoLastImport);
$('#exportDataBtn').addEventListener('click',exportBackup); $('#importDataBtn').addEventListener('click',()=>$('#importDataInput').click());
$('#importDataInput').addEventListener('change',e=>{importBackupFile(e.target.files?.[0]);e.target.value='';});
$('#csvScope').addEventListener('change',updateCsvScopeUI);$('#exportCsvBtn').addEventListener('click',exportCsv);
document.addEventListener('click',e=>{
  const editRecord=e.target.closest('[data-edit-record]'); if(editRecord){openRecordEditor(editRecord.dataset.editRecord);return;}
  const restore=e.target.closest('[data-restore-record]'); if(restore){restoreTrashRecord(restore.dataset.restoreRecord);return;}
  const open=e.target.closest('[data-open-book]'); if(open){openBookDetail(open.dataset.openBook);return;}
  const edit=e.target.closest('[data-edit-book]'); if(edit){closeModal('bookDetailModal');openBookForm(bookById(edit.dataset.editBook));return;}
  const settle=e.target.closest('[data-add-settlement]'); if(settle){openSettlement(settle.dataset.addSettlement);return;}
  const settleClient=e.target.closest('[data-settle-client]'); if(settleClient){state.bookFilter='all';state.clientFilter=settleClient.dataset.settleClient;state.platformFilter='all';renderLibraryFilters();renderBooks();switchView('books');return;}
  const qm=e.target.closest('[data-quick-month]'); if(qm){state.statsCustomMonth=qm.dataset.quickMonth;state.statsPeriod='customMonth';renderStats();return;}
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
