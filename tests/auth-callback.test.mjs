import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSetupLink,readAuthCallback} from '../src/auth-callback.js';
const project='https://eddaalutgxmanorbfrbm.supabase.co';
const site='https://shenghuifox.github.io/aimen-club-sys/';
const token='test_token_not_a_real_credential';
const proof={type:'invite',token_hash:token};

test('可在正式站使用舊邀請，忽略郵件中導向 localhost 的參數',()=>{
 const oldLink=project+'/auth/v1/verify?token='+token+'&type=invite&redirect_to=http%3A%2F%2Flocalhost%3A3000';
 assert.deepEqual(parseSetupLink(oldLink,project,site),proof);
 const newLink=new URL(site+'?type=invite&token_hash='+token);
 assert.deepEqual(parseSetupLink(newLink.href,project,site),proof);
 assert.deepEqual(readAuthCallback(newLink),{proof});
});
test('僅接受本專案、本網站的邀請或重設驗證連結',()=>{
 for(const bad of ['https://example.test/auth/v1/verify?type=invite&token='+token,
  project+'/other?type=invite&token='+token,site+'?type=signup&token_hash='+token,
  site+'?type=invite&token_hash=short',project+'/auth/v1/verify?type=invite&token='+token+'%20',
  'http://localhost:3000/#type=invite&access_token=x']) assert.equal(parseSetupLink(bad,project,site),null);
 assert.deepEqual(parseSetupLink(site+'?type=recovery&token_hash='+token,project,site),{type:'recovery',token_hash:token});
});
test('只在可辨識的回呼開啟密碼流程，過期和無憑證回呼要求重新驗證',()=>{
 assert.equal(readAuthCallback(new URL(site)),null);
 assert.deepEqual(readAuthCallback(new URL(site+'#type=invite')),{invalid:true});
 assert.deepEqual(readAuthCallback(new URL(site+'#error_code=otp_expired')),{invalid:true});
 assert.deepEqual(readAuthCallback(new URL(site+'#type=recovery&access_token=fake')), {accessToken:'fake'});
});
