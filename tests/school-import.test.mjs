import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseAccountImport,parseSchoolImport,SCHOOL_HEADERS} from '../src/account-import.js';
import {submitSchoolImport} from '../src/school-import.js';
import {issueSchoolBatch,schoolBatchResolver,SCHOOL_BATCH_SIZE} from '../supabase/functions/club-account-admin/school-batch.js';
import {csvString} from '../src/domain.js';

const row=(username='pupil-001',role='stu')=>({username,role,name:'測試生',class_name:'三甲',number:'01',student_name:'測試生'});
const school={
 users:[{username:'existing'}],
 students:[
  {term_id:'other',class_name:'三甲',number:'01',name:'測試生',id:'wrong-term'},
  {term_id:'current',class_name:'三甲',number:'01',name:'測試生',id:'p1'},
  {term_id:'current',class_name:'三甲',number:'02',name:'測試生',id:'p2',user_id:'old-profile'},
 ],
};

test('校用帳號支援 CSV、試算表貼上與座號前導零，既有郵件範本仍可用',()=>{
 const text=csvString([SCHOOL_HEADERS,['STU_001','測試生','學生','三甲','01',''],['teacher-1','測試老師','班級導師','','','']]);
 const result=parseSchoolImport(text);
 assert.deepEqual(result[0],row('stu_001'));
 assert.equal(result[1].role,'hrtr');
 const tab=[SCHOOL_HEADERS,['parent001','家長甲','家長','三甲','01','測試生']].map(x=>x.join('\t')).join('\r\n');
 assert.equal(parseSchoolImport(tab)[0].student_name,'測試生');
 assert.equal(parseAccountImport('帳號,姓名,角色,班級,座號\nold@example.org,測試生,學生,三甲,01')[0].email,'old@example.org');
 assert.throws(()=>parseSchoolImport('帳號,姓名,角色,班級,座號,學生姓名\nnewuser,測試,行政管理,,,'),/核對校用帳號/);
 assert.throws(()=>parseSchoolImport(text+'\nStu_001,測試生,學生,三甲,01,'),/帳號重複/);
 assert.throws(()=>parseSchoolImport('帳號,姓名,角色,班級,座號,學生姓名\nparent001,家長甲,家長,三甲,01,'),/學生姓名/);
});

test('僅綁定指定學期唯一學生，拒絕重複學生、既有帳號及批次行政',()=>{
 const resolve=schoolBatchResolver(school,'current');
 assert.equal(resolve(row()).student_id,'p1');
 assert.throws(()=>resolve(row('pupil-002')),/重複/);
 assert.equal(resolve({...row('guardian-1','guardian'),name:'其他姓名'}).student_id,'p1');
 assert.equal(resolve({...row('guardian-2','guardian'),name:'另一位家長'}).student_id,'p1');
 assert.throws(()=>resolve(row('EXISTING')),/帳號已存在/);
 assert.throws(()=>resolve({...row('wrong-pupil'),number:'02'}),/已有帳號綁定/);
 assert.throws(()=>resolve({...row('no-seat'),number:'1'}),/找不到唯一符合/);
 assert.throws(()=>resolve({...row('manager1','admin'),class_name:'',number:'',student_name:''}),/核對校用帳號/);
 const ambiguous=schoolBatchResolver({...school,students:[...school.students,{...school.students[1],id:'p3'}]},'current');
 assert.throws(()=>ambiguous(row()),/唯一符合/);
});

test('個別失敗不影響其餘建帳，只有成功列可以取得初始密碼',async()=>{
 const entries=[row(),row('dupe'),row('guardian-1','guardian'),row('guardian-2','guardian'),row('guardian-3','guardian')];
 let called=[];
 const results=await issueSchoolBatch(entries,schoolBatchResolver(school,'current'),async entry=>{
  called.push(entry.username);
  if(entry.username==='guardian-1')throw Error('內部訊息');
  if(entry.username==='guardian-2')return {error:'無法建立帳號'};
  return {initial_password:'sample'};
 });
 assert.deepEqual(called,['pupil-001','guardian-1','guardian-2','guardian-3']);
 assert.deepEqual(results.map(x=>x.status),['created','failed','unknown','failed','created']);
 assert.deepEqual(results.map(x=>x.initial_password),['sample',undefined,undefined,undefined,'sample']);
 assert.ok(!results[2].error.includes('內部訊息'));
});

test('連線中斷時保留已取得的結果，標示待確認及未送出列',async()=>{
 const rows=Array.from({length:SCHOOL_BATCH_SIZE*2+1},(_,i)=>row('guardian-'+i,'guardian'));
 let calls=0,progress=[];
 const results=await submitSchoolImport(rows,'current',async body=>{
  calls++;
  assert.equal(body.action,'batch_create_school');
  assert.equal(body.term_id,'current');
  assert.ok(body.rows.length<=SCHOOL_BATCH_SIZE);
  if(calls>1)throw Error('網路中斷');
  return {results:body.rows.map(()=>({status:'created',initial_password:'sample'}))};
 },count=>progress.push(count));
 assert.equal(calls,2);
 assert.deepEqual(progress,[SCHOOL_BATCH_SIZE]);
 assert.equal(results.filter(x=>x.status==='created').length,SCHOOL_BATCH_SIZE);
 assert.equal(results.filter(x=>x.status==='unknown').length,SCHOOL_BATCH_SIZE);
 assert.equal(results.at(-1).status,'skipped');
 assert.equal(results[0].username,'guardian-0');
 assert.equal(results[0].initial_password,'sample');
});
