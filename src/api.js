import {createClient} from '@supabase/supabase-js';
import {seed,demoAction} from './demo.js';
const env=import.meta.env;
export const configured=Boolean(env.VITE_SUPABASE_URL&&env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const googleEnabled=env.VITE_GOOGLE_AUTH_ENABLED==='true';
export const supabase=configured?createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY):null;
const key='aimen-demo-v1';
export function loadDemo(){try{const saved=JSON.parse(localStorage.getItem(key));return saved?.users&&saved?.terms?saved:seed();}catch{return seed();}}
export function resetDemo(){localStorage.removeItem(key);return seed();}
export async function getSnapshot(){const {data,error}=await supabase.rpc('club_snapshot');if(error)throw error;return data;}
export async function runAction(mode,data,user,action,payload){if(mode==='demo'){const next=demoAction(data,user,action,payload);localStorage.setItem(key,JSON.stringify(next));return next;}const rpc={batch_sessions:'club_batch_sessions',update_student:'club_update_student',edit_change:'club_edit_change'}[action];const {error}=await supabase.rpc(rpc||'club_action',rpc?{payload}:{action,payload});if(error){if(error.code==='PGRST202')throw Error('資料庫尚未更新，請由管理者執行 最新升級 SQL（編修異動需 003_edit_changes.sql）後重試。');throw error;}return getSnapshot();}
export async function login(username,password){const email=username.includes('@')?username:`${username}@test.aimen.invalid`;const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw Error('登入失敗，請確認帳號與密碼；若帳號尚未建立，請聯絡管理者。');return data;}
