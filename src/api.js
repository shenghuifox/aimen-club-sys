import {createClient} from '@supabase/supabase-js';
import {schoolEmail} from '../supabase/functions/club-account-admin/school-auth.js';
import {seed,demoAction} from './demo.js';
const env=import.meta.env;
export const configured=Boolean(env.VITE_SUPABASE_URL&&env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const authProjectUrl=env.VITE_SUPABASE_URL;
export const googleEnabled=env.VITE_GOOGLE_AUTH_ENABLED==='true';
export const supabase=configured?createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY):null;
const key='aimen-demo-v2';
export function loadDemo(){try{const saved=JSON.parse(localStorage.getItem(key));return saved?.users&&saved?.terms?saved:seed();}catch{return seed();}}
export function resetDemo(){localStorage.removeItem(key);return seed();}
export async function getSnapshot(){const {data,error}=await supabase.rpc('club_snapshot');if(error)throw error;return data;}
const RPC_ACTIONS=new Set(['batch_sessions','update_student','edit_change','import_accounts','cancel_account','batch_roster']);

export async function getLoginSnapshot() {
 const {error}=await supabase.rpc('club_claim_account');
 if (error) throw error;
 return getSnapshot();
}

const GROUPED_RPC = {
  club_operations: ['cancel','makeup','swap','fee_status','void_settlement'],
  club_manage: ['account_status','copy_term','link_guardian','unlink_guardian','guardian_leave','edit_club','create_club'],
  club_followup: ['withdraw_leave','withdraw_change','edit_account'],
};
const rpcByAction = new Map(Object.entries(GROUPED_RPC).flatMap(([rpc,actions])=>actions.map(action=>[action,rpc])));

export async function runAction(mode,data,user,action,payload) {
 if (mode==='demo') {
  if(user.active===false) throw Error('帳號已停權');
  if (action==='account_credentials') throw Error('試用模式不修改登入電子郵件或密碼。');
  const snapshot=demoAction(data,user,action,payload);
  if (action==='batch_roster'&&payload.preview) return {snapshot:data};
  localStorage.setItem(key,JSON.stringify(snapshot));
  return {snapshot};
 }
 if(action==='account_credentials'){
  const result=await callAccountService(payload);
  return {snapshot:payload.action==='create_school'?data:await getSnapshot(),result};
 }
 const dedicated=RPC_ACTIONS.has(action);
 const {data:result,error}=await supabase.rpc(dedicated?'club_'+action:rpcByAction.get(action)||'club_action',dedicated?{payload}:{action,payload});
 if (error?.code==='PGRST202') throw Error('資料庫尚未更新到目前版本，請聯絡管理者。');
 if (error) throw error;
 return {snapshot:await getSnapshot(),result};
}

export async function schoolPasswordRequired(){
 const {data,error}=await supabase.rpc('club_school_password_required');
 if(error)throw error;
 return data;
}

export async function callAccountService(payload){
 const {data,error}=await supabase.functions.invoke('club-account-admin',{body:payload});
 if(error){
  const detail=await error.context?.json?.().catch(()=>null);
  throw Error(detail?.error||'帳號服務無法使用，請聯絡學校。');
 }
 return data;
}

export async function login(username,password){
 const account=username.trim();
 const legacy=account.includes('@')?account:`${account}@test.aimen.invalid`;
 const email=schoolEmail(account)||legacy;
 let {data,error}=await supabase.auth.signInWithPassword({email,password});
 if(error?.code==='invalid_credentials'&&email!==legacy){
  ({data,error}=await supabase.auth.signInWithPassword({email:legacy,password}));
 }
 if(error)throw Error('登入失敗，請確認帳號與密碼；如需協助，請聯絡學校。');
 return data;
}

export async function getPublicCalendar(weekStart,signal){
 const {data,error}=await supabase.rpc('club_public_calendar',{p_week:weekStart},{get:true}).abortSignal(signal);
 if(error)throw error;
 return data;
}
