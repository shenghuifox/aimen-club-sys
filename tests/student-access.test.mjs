import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStudentImport,parseStaffImport} from '../src/account-import.js';
import {studentHashes,studentResolver,randomHex} from '../supabase/functions/club-account-admin/student-access.js';

test('學生匯入保留文字座號和 OpenID 前導零，也可先匯入三欄',()=>{
 assert.deepEqual(parseStudentImport('班級,座號,姓名,OpenID數字\n三甲,01,王同學,000123'),
  [{class_name:'三甲',number:'01',name:'王同學',openid:'000123'}]);
 assert.equal(parseStudentImport('班級\t座號\t姓名\n六甲\t2\t測試同學')[0].openid,'');
 assert.throws(()=>parseStudentImport('班級,座號,姓名\n三甲,01,甲\n三甲,1,乙'),/重複/);
 assert.throws(()=>parseStaffImport('帳號,姓名,角色\nstaff01,姓名,學生'),/班級導師/);
});

test('匯入比對選定學期，座號前導零可核對既有同名名冊',()=>{
 const students=[{id:'p1',term_id:'active',class_name:'三甲',number:'1',name:'王同學',user_id:'u1'},
  {id:'p2',term_id:'old',class_name:'三甲',number:'1',name:'舊同學',user_id:'u2'}];
 const resolve=()=>studentResolver({students,student_links:['p1']},'active');
 assert.equal(resolve()({class_name:'三甲',number:'01',name:'王同學'}).hasLink,true);
 assert.throws(()=>resolve()({class_name:'三甲',number:'01',name:'舊同學'}),/不同學生/);
 assert.equal(resolve()({class_name:'三甲',number:'02',name:'新同學'}).alreadyBound,false);
});

test('登入連結為獨立亂數，雜湊核對連結和 OpenID 數字',async()=>{
 const a=randomHex(24),b=randomHex(24);
 assert.match(a,/^[0-9a-f]{48}$/);assert.notEqual(a,b);
 const base=await studentHashes(a,'000123');
 assert.notEqual(base.openid_hash,(await studentHashes(b,'000123')).openid_hash);
 assert.notEqual(base.openid_hash,(await studentHashes(a,'123')).openid_hash);
 assert.equal(base.card_hash,(await studentHashes(a,'123')).card_hash);
});
