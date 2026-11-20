import test from 'node:test';
import assert from 'node:assert/strict';
import {dayEvents,FIRST_HOUR,LAST_HOUR} from '../src/calendar.js';
import {weekDays} from '../src/domain.js';

const day='2026-11-16';
const event=(id,start,end)=>({id,starts_at:day+'T'+start+':00+08:00',ends_at:day+'T'+end+':00+08:00'});
test('週一至週日，臺灣時間 07:00 至 18:00，跨界事件保留',()=>{
 assert.deepEqual(weekDays('2026-11-22'),['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22']);
 assert.deepEqual([FIRST_HOUR,LAST_HOUR],[7,18]);
 const {visible,outside}=dayEvents([event('early','06:20','07:30'),event('late','17:30','18:20'),event('night','18:30','19:00')],day);
 assert.deepEqual(visible.map(x=>x.session.id),['early','late']);
 assert.deepEqual(outside.map(x=>x.id),['early','late','night']);
 assert.equal(visible[0].top,0);
 assert.ok(Math.abs(visible[1].top+visible[1].height-100)<0.001);
});
test('重疊課程分欄，相鄰及不重疊課程恢復整欄',()=>{
 const {visible}=dayEvents([event('a','08:00','09:00'),event('b','08:30','09:15'),event('c','09:15','10:00')],day);
 assert.deepEqual(visible.map(x=>[x.left,x.width]),[[0,50],[50,50],[0,100]]);
});
