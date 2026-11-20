import test from 'node:test';
import assert from 'node:assert/strict';
import {strFromU8,unzipSync} from 'fflate';
import {parseAccountImport,ACCOUNT_HEADERS} from '../src/account-import.js';
import {csvString} from '../src/domain.js';
import {buildPayrollWorkbook,payrollDetails} from '../src/payroll.js';

test('讀取 Excel CSV、保留座號前導零、阻擋匯入管理者與重複帳號',()=>{
 const csv=csvString([ACCOUNT_HEADERS,['STU','王,"同學"','學生','三甲','01']]);
 assert.deepEqual(parseAccountImport(csv),[{email:'stu@test.aimen.invalid',name:'王,"同學"',role:'stu',class_name:'三甲',number:'01'}]);
 const tsv=ACCOUNT_HEADERS.join('\t')+'\nteacher@example.test\t教師測試\t社團老師\t\t';
 assert.equal(parseAccountImport(tsv)[0].role,'clubtr');
 assert.throws(()=>parseAccountImport(csv+'\n'+csv.split('\r\n').at(-1)),/重複/);
 assert.throws(()=>parseAccountImport(csv.replace('學生','admin')),/角色/);
 assert.ok(csvString([['　＝1+1']]).includes("'　＝1+1"));
});

const snapshot={
 school:'測試學校',
 club:{name:'社團 A & B',plan_name:'計畫 A & B'},
 start_date:'2026-11-01',end_date:'2026-11-30',
 total:5800,units:13.5,
 rows:[
  {teacher_id:'teacher-0',starts_at:'2026-11-12T02:00:00Z',rate:400,units:2},
  {teacher_id:'teacher-0',starts_at:'2026-11-12T07:00:00Z',rate:400,units:0.5},
  {teacher_id:'teacher-0',starts_at:'2026-11-15T16:00:00Z',rate:500,units:1}
 ],
 teachers:Array.from({length:8},(_,i)=>({teacher_id:'teacher-'+i,name:i===0?'=測試 & 教師':'教師 '+i,rate:400,units:2.5,amount:1000}))
};

test('憑證與清冊同頁，保留合計、逐日節數、擴列及防公式注入',()=>{
 const data=payrollDetails(snapshot);
 assert.equal(data.teachers[0].note,'11/12(2.5)');
 assert.match(data.title,/115\/11\/1 至 115\/11\/30/);
 const files=unzipSync(buildPayrollWorkbook(snapshot,true));
 const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/<c r="D5" s="\d+"><v>5800<\/v>/);
 assert.match(sheet,/<c r="B19" s="\d+" t="inlineStr">[^<]*<is><t [^>]+>=測試 &amp; 教師/);
 assert.match(sheet,/<c r="E27" s="\d+"><v>5800<\/v>/);
 assert.match(sheet,/<c r="C27" s="\d+"><v>13.5<\/v>/);
 assert.match(sheet,/<c r="B26" s="\d+" t="inlineStr">/);
 assert.match(sheet,/A27:B27/);
 assert.match(sheet,/試用資料/);
 assert.match(strFromU8(files['xl/workbook.xml']),/\$A\$1:\$G\$28/);
 assert.ok(Object.keys(files).every(name=>!name.startsWith('docProps/')&&!name.includes('printer')));
});
