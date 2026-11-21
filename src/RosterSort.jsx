import React from 'react';
export default function RosterSort({value,onChange,allowAccount}){
 return <label className="roster-control">名冊排序
  <select value={allowAccount?value:'class'} onChange={event=>onChange(event.target.value)}>
   <option value="class">班級／座號</option>
   {allowAccount&&<option value="account">帳號英數順序</option>}
  </select>
 </label>;
}
