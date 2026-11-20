import {addDays} from './domain.js';

export const FIRST_HOUR=7;
export const LAST_HOUR=18;
const minute=60000;
const first=FIRST_HOUR*60;
const last=LAST_HOUR*60;
const duration=last-first;

export function dayEvents(sessions,day){
 const start=Date.parse(day+'T00:00:00+08:00');
 const end=Date.parse(addDays(day,1)+'T00:00:00+08:00');
 const visible=[];
 const outside=[];
 for(const session of sessions){
  const from=Date.parse(session.starts_at);
  const to=Date.parse(session.ends_at);
  if(!(from<end&&to>start&&from<to)) continue;
  const a=(from-start)/minute;
  const b=(to-start)/minute;
  if(a<first||b>last) outside.push(session);
  if(a<last&&b>first) visible.push({session,start:Math.max(a,first),end:Math.min(b,last)});
 }
 visible.sort((a,b)=>a.start-b.start||b.end-a.end);
 let group=[],lanes=[],groupEnd=0;
 function place(){
  const columns=lanes.length;
  for(const event of group){
   event.top=(event.start-first)/duration*100;
   event.height=(event.end-event.start)/duration*100;
   event.left=event.lane/columns*100;
   event.width=100/columns;
  }
 }
 for(const event of visible){
  if(event.start>=groupEnd){
   place();
   group=[];lanes=[];groupEnd=0;
  }
  const lane=lanes.findIndex(end=>end<=event.start);
  event.lane=lane<0?lanes.length:lane;
  lanes[event.lane]=event.end;
  group.push(event);
  groupEnd=Math.max(groupEnd,event.end);
 }
 place();
 return {visible,outside};
}
