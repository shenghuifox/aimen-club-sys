import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {reportHtml} from '../src/reports.js';

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

test('Chrome 實際列印 PDF，以 A4 輸出單頁完整報表',{skip:!process.env.AIMEN_TEST_CHROME},()=>{
 const root=mkdtempSync(join(tmpdir(),'aimen-report-'));
 try {
  for(const kind of ['payroll','sign']){
   const html=join(root,kind+'.html'), pdf=join(root,kind+'.pdf');
   writeFileSync(html,reportHtml(snapshot,kind));
   execFileSync(process.env.AIMEN_TEST_CHROME,['--headless','--no-sandbox','--disable-dev-shm-usage',
    '--no-pdf-header-footer','--user-data-dir='+join(root,'chrome'),'--print-to-pdf='+pdf,pathToFileURL(html).href],
    {timeout:35000,stdio:'pipe'});
   const decoded=readFileSync(pdf,'latin1');
   assert.equal([...decoded.matchAll(/\/Type\s*\/Page\b/g)].length,1,kind);
   const match=decoded.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
   assert.ok(match,'PDF 有實體紙張尺寸');
   const a=Number(match[1]),b=Number(match[2]);
   assert.ok(Math.abs(Math.min(a,b)-595)<2&&Math.abs(Math.max(a,b)-842)<2);
   assert.ok(a<b,'直式 A4');
   const text=spawnSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
   if(!text.error){
    assert.equal(text.status,0);
    assert.match(text.stdout,/版本\s*2/);
   }
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
