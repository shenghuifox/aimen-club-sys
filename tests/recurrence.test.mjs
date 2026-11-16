import test from 'node:test';
import assert from 'node:assert/strict';
import {recurringCandidates,recurringPreview} from '../src/recurrence.js';
import {seed,demoAction} from '../src/demo.js';
const p={club_id:'football',teacher_id:'clubtr',start_date:'2026-12-01',end_date:'2026-12-31',weekdays:[1,3],start_time:'15:30',end_time:'16:50',units:2,rate:400,exclude_dates:['2026-12-07']};
test('多星期與排除日期依臺灣時間生成',()=>{const rows=recurringCandidates(p);assert.equal(rows.length,8);assert.equal(rows[0].date,'2026-12-02');assert.equal(rows[0].starts_at,'2026-12-02T07:30:00.000Z');assert.ok(!rows.some(r=>r.date==='2026-12-07'));});
test('非法日期、空星期、跨午夜、超量均阻擋',()=>{for(const bad of [{weekdays:[]},{start_date:'2026-02-30'},{end_time:'14:00'},{exclude_dates:['明天']},{start_date:'2026-01-01',end_date:'2026-12-31',weekdays:[1,2,3,4,5,6,7]}])assert.throws(()=>recurringCandidates({...p,...bad}));});
test('相同批次重複提交略過、衝突整批失敗',()=>{const d=seed();const after=demoAction(d,d.users[0],'batch_sessions',p);assert.equal(after.sessions.length-d.sessions.length,8);assert.ok(recurringPreview(after,p).every(r=>r.result==='skip'));assert.equal(demoAction(after,after.users[0],'batch_sessions',p).sessions.length,after.sessions.length);assert.throws(()=>demoAction(after,after.users[0],'batch_sessions',{...p,rate:500}));});
test('封存與鎖定期間阻擋',()=>{const d=seed();d.settlements.push({club_id:'football',start_date:'2026-12-01',end_date:'2026-12-31'});assert.ok(recurringPreview(d,p).every(r=>r.result==='conflict'));});
