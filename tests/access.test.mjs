import test from 'node:test';
import assert from 'node:assert/strict';
import {canUseModule,canEditClubSchedule} from '../src/access.js';

test('模組權限對應行政、社團老師、班級導師與學生',()=>{
 const general=['home','clubs','roster','manual'];
 const staff=['calendar','attendance','leave'];
 const admin=['billing','students','permissions','settings'];
 const all=[...general,...staff,...admin,'changes','unknown'];
 for(const [roles,expected] of [
  [['admin'],[...general,...staff,...admin,'changes']], [['clubtr'],[...general,...staff,'changes']],
  [['hrtr'],[...general,...staff]], [['stu'],general], [['hrtr','clubtr'],[...general,...staff,'changes']],
 ]){
  assert.deepEqual(all.filter(module=>canUseModule({roles},module)),all.filter(module=>expected.includes(module)));
 }
 assert.equal(canUseModule(null,'home'),false);
});

test('週課表僅行政與社團負責老師可編修',()=>{
 const club={teacher_id:'owner'};
 assert.equal(canEditClubSchedule({roles:['admin'],id:'other'},club),true);
 assert.equal(canEditClubSchedule({roles:['clubtr'],id:'owner'},club),true);
 assert.equal(canEditClubSchedule({roles:['clubtr'],id:'other'},club),false);
 assert.equal(canEditClubSchedule({roles:['hrtr'],id:'owner'},club),false);
 assert.equal(canEditClubSchedule({roles:['stu'],id:'owner'},club),false);
 assert.equal(canEditClubSchedule(null,club),false);
 assert.equal(canEditClubSchedule({roles:['admin']},null),false);
});
