import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialSchoolPassword,isInitialPassword,isSchoolAccount,schoolEmail,validSchoolPassword} from '../supabase/functions/club-account-admin/school-auth.js';

test('校用帳號正規化與格式驗證',()=>{
 assert.equal(schoolEmail('  Aimen_09-1 '),'aimen_09-1@accounts.aimen.invalid');
 assert.equal(isSchoolAccount(schoolEmail('student001')),true);
 assert.equal(isSchoolAccount('teacher@example.org'),false);
 for(const value of [undefined,'a','_abc','primary@example.org','小明','a'.repeat(41)])assert.equal(schoolEmail(value),null);
});

test('密碼至少八字元，且含英文字母及數字',()=>{
 assert.equal(validSchoolPassword('teachers1'),true);
 assert.equal(validSchoolPassword('letters1'),true);
 for(const value of [null,'abc123','abcdefgh','12345678','a1'+'課'.repeat(24)])assert.equal(validSchoolPassword(value),false);
});

test('初始密碼符合規則且不能當作首次換密碼的選擇',()=>{
 const passwords=new Set(Array.from({length:32},initialSchoolPassword));
 assert.equal(passwords.size,32);
 for(const password of passwords){
  assert.equal(validSchoolPassword(password),true);
  assert.equal(isInitialPassword(password),true);
 }
 assert.equal(isInitialPassword('letters1'),false);
});
