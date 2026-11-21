import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {reportHtml} from '../src/reports.js';
import {rosterClubMemberships} from '../src/domain.js';
import {accountOrder,studentOrder} from '../src/roster-sort.js';

const rows=Array.from({length:30},()=>({
 teacher_id:'t1',teacher_name:'王老師',signed_at:'2026-11-20T07:19:00Z',
 starts_at:'2026-11-20T07:00:00Z',ends_at:'2026-11-20T08:00:00Z',
 rate:400,units:1,summary:'較長的課程摘要，用於測試簽到表縮放及換行。'.repeat(4),attendance_count:12,
}));
const snapshot={
 school:'隘門國小',club:{name:'足球小將',plan_name:'測試計畫'},start_date:'2026-11-01',end_date:'2026-11-30',
 units:30,total:12000,rows,teachers:[{teacher_id:'t1',name:'王老師',rate:400,units:30,amount:12000}],
};
test('報表保留簽章、簽到欄位與單頁 A4 版面',()=>{
 const payroll=reportHtml(snapshot,'payroll');
 assert.match(payroll,/鐘點費印領清冊/);
 assert.doesNotMatch(payroll,/黏貼憑證|憑證編號|預算科目/);
 assert.match(payroll,/@page\{size:A4 portrait/);
 const sign=reportHtml(snapshot,'sign');
 assert.match(sign,/@page\{size:A4 portrait/);
 assert.match(sign,/上課時間/);
 assert.match(sign,/課程摘要/);
 assert.match(sign,/紙本親簽/);
 assert.match(sign,/<p class="handler-seal">承辦人<\/p>/);
 assert.doesNotMatch(sign,/線上簽到時間|主任|校長|15:19/);
});

const roster={group:'足球社',teacher:'王老師',term:'115-1',students:Array.from({length:68},(_,i)=>
 ({class_name:'三年甲班',number:i+1,name:i===67?'末位同學':'學生 '+i}))};
const classRoster={...roster,group:'三年甲班',showClubs:true,students:roster.students.slice(0,20).map((student,i)=>({
 ...student,clubNames:i===19?['直排輪','桌球']:[],
}))};
const calendar={week:'2026-11-16',rows:[
 {club_name:'足球社',location:'球場',starts_at:'2026-11-16T15:00:00+08:00',ends_at:'2026-11-16T16:00:00+08:00'},
 {club_name:'書法社',location:'圖書館',starts_at:'2026-11-22T09:00:00+08:00',ends_at:'2026-11-22T10:00:00+08:00',cancelled:true},
]};
test('名冊與週課表列印包含必要欄位、跳脫文字及停課資訊',()=>{
 const rosterPage=reportHtml({...roster,teacher:'<王老師>'},'roster');
 assert.match(rosterPage,/足球社名冊/);
 assert.match(rosterPage,/&lt;王老師&gt;/);
 assert.equal(rosterPage.match(/<tbody>/g).length,3);
 assert.match(rosterPage,/末位同學/);
 const calendarPage=reportHtml(calendar,'calendar');
 for(const label of ['A4 landscape','週一 11-16','週日 11-22','【停課】書法社','圖書館'])assert.ok(calendarPage.includes(label));
 assert.doesNotMatch(calendarPage,/class="sidebar"/);
});

test('名冊依中文年級、數字座號或帳號英數自然順序排序',()=>{
 const list=[
  {class_name:'三年甲班',number:'10',username:'A10'},
  {class_name:'三年甲班',number:'2',username:'a2'},
  {class_name:'二年甲班',number:'10',username:'10'},
  {class_name:'一年甲班',number:'1',username:'2'},
  {class_name:'四年甲班',number:'1',username:''},
 ];
 const expected=['2','10','a2','A10',''];
 assert.deepEqual([...list].sort(studentOrder()).map(s=>s.username),expected);
 assert.deepEqual([...list].sort(studentOrder('account',s=>s.username)).map(s=>s.username),expected);
 assert.deepEqual([...list].sort(accountOrder).map(s=>s.username),expected);
});
test('班級名冊列出有效社團，個別社團名冊不列出其他社團',()=>{
 const clubs=[{id:'roller',name:'直排輪'},{id:'table',name:'桌球'},{id:'music',name:'烏克麗麗'}];
 const enrollment={student_id:'pupil',club_id:'roller',status:'enrolled',start_date:'2026-08-01'};
 const joined=rosterClubMemberships([
  enrollment,enrollment,{...enrollment,club_id:'table'},
  {...enrollment,club_id:'music',end_date:'2026-11-19'},
  {...enrollment,club_id:'music',start_date:'2026-12-01'},
  {...enrollment,club_id:'hidden'},{...enrollment,club_id:'music',status:'pending'},
 ],clubs,'2026-11-20').get('pupil');
 assert.deepEqual(joined.map(club=>club.name),['直排輪','桌球']);
 const page=reportHtml(classRoster,'roster');
 assert.match(page,/<th>參加社團<\/th>/);
 assert.match(page,/<td>直排輪、桌球<\/td>/);
 assert.match(page,/<td>—<\/td>/);
 assert.doesNotMatch(reportHtml(roster,'roster'),/<th>參加社團<\/th>/);
});

test('Chrome 實際列印 PDF，以 A4 輸出單頁完整報表',{skip:!process.env.AIMEN_TEST_CHROME},()=>{
 const root=mkdtempSync(join(tmpdir(),'aimen-report-'));
 try {
  for(const [kind,data] of [['payroll',snapshot],['sign',snapshot],['roster',roster],['class',classRoster],['calendar',calendar]]){
   const html=join(root,kind+'.html'), pdf=join(root,kind+'.pdf');
   writeFileSync(html,reportHtml(data,kind==='class'?'roster':kind));
   const print=profile=>execFileSync(process.env.AIMEN_TEST_CHROME,['--headless','--no-sandbox','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--disable-background-networking','--no-pdf-header-footer',
    '--user-data-dir='+join(root,profile),'--print-to-pdf='+pdf,pathToFileURL(html).href],{timeout:35000,stdio:'pipe'});
   try{print(kind+'-chrome');}catch(error){
    if(error.code!=='ETIMEDOUT')throw error;
    print(kind+'-retry');
   }
   const decoded=readFileSync(pdf,'latin1');
   assert.equal([...decoded.matchAll(/\/Type\s*\/Page\b/g)].length,1,kind);
   const match=decoded.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
   assert.ok(match,'PDF 有實體紙張尺寸');
   const a=Number(match[1]),b=Number(match[2]);
   assert.ok(Math.abs(Math.min(a,b)-595)<2&&Math.abs(Math.max(a,b)-842)<2);
   assert.equal(a>b,kind==='calendar',kind+' orientation');
   const text=spawnSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
   if(!text.error){
    assert.equal(text.status,0);
    assert.match(text.stdout,/版本\s*2/);
    if(kind==='roster')assert.match(text.stdout,/末位同學/);
    if(kind==='class')assert.match(text.stdout,/直排輪、桌球/);
    if(kind==='calendar')assert.match(text.stdout,/書法社/);
   }
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
