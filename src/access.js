import {has} from './domain.js';

const shared=['home','clubs','roster','manual'];
const staff=['calendar','attendance','leave'];
const office=['billing','students','permissions','settings'];

export function canUseModule(user,module){
 if(!user)return false;
 const admin=has(user,'admin'),instructor=has(user,'clubtr');
 return shared.includes(module)
  || (staff.includes(module)&&(admin||instructor||has(user,'hrtr')))
  || (module==='changes'&&(admin||instructor))
  || (office.includes(module)&&admin);
}

export function canEditClubSchedule(user,club){
 return Boolean(user&&club&&(has(user,'admin')||(has(user,'clubtr')&&club.teacher_id===user.id)));
}
