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
export async function runAction(mode,data,user,action,payload){if(mode==='demo'){const next=demoAction(data,user,action,payload);localStorage.setItem(key,JSON.stringify(next));return next;}const {error}=await supabase.rpc('club_action',{action,payload});if(error)throw error;return getSnapshot();}
export async function login(username,password){const email=username.includes('@')?username:`${username}@test.aimen.invalid`;const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw Error('登入失敗，請確認帳號與密碼；若帳號尚未建立，請聯絡管理者。');return data;}
