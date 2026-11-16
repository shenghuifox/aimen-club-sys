// Run only on a trusted administrator workstation. Never put the service key in
// GitHub, VITE_ variables, browser code, or command-line arguments.
import {createClient} from '@supabase/supabase-js';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const url=process.env.SUPABASE_URL||'https://eddaalutgxmanorbfrbm.supabase.co';
const key=process.env.SUPABASE_SECRET_KEY;
if(!key)throw Error('請在本機環境設定 SUPABASE_SECRET_KEY 後執行。請勿傳送或提交此金鑰。');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const accounts=[['admin','行政測試',['admin']],['stu','學生測試',['stu']],['clubtr','社團老師測試',['clubtr']],['hrtr','班級導師測試',['hrtr']]];
const output=[];
for(const [username,name,roles] of accounts){
 const email=`${username}@test.aimen.invalid`,password=randomBytes(20).toString('base64url')+'aA9!';
 const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true});
 if(error)throw Error(`${username}: ${error.message}。已完成帳號不會自動重設密碼，請到 Auth 管理頁檢查。`);
 const {error:profileError}=await client.rpc('club_bootstrap_profile',{p_id:data.user.id,p_username:username,p_name:name,p_roles:roles});
 if(profileError)throw Error(`${username} Auth 已建立，但角色綁定失敗：${profileError.message}。請保留帳號並修正綁定，不要重複執行。`);
 output.push({username,email,password,roles});
 console.log(`${username} 已建立並綁定角色。`);
 // Save after each successful account; credentials remain local and gitignored.
 await fs.writeFile(path.resolve('credentials-test-accounts.json'),JSON.stringify(output,null,2),{mode:0o600});
}
console.log('帳密已儲存至本機 credentials-test-accounts.json；請妥善保管。正式啟用前另指派第二位權限管理者。');
