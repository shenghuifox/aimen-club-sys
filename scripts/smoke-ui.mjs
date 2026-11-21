import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const url=process.argv[2];
const {chromium}=await import(pathToFileURL(process.env.AIMEN_PLAYWRIGHT).href);
const browser=await chromium.launch({executablePath:process.env.AIMEN_TEST_CHROME,args:['--no-sandbox']});
const shared=['入口首頁','社團與報名','課表與名冊','使用手冊'];
const staff=['本週課表','授課與點名','請假與覆核'];
const office=['行政核銷','學生管理','帳號管理','學期與設定'];
const roles=[
 ['行政管理 admin',[...shared,...staff,...office,'異動管理']],
 ['社團老師 clubtr',[...shared,...staff,'異動管理']],
 ['班級導師 hrtr',[...shared,...staff]],
 ['學生 stu',['入口首頁','社團與報名','個人課表','使用手冊']],
];
const is=(name)=>({name,exact:true});
async function visit(page,label){
 await page.locator('.sidebar nav').getByRole('button',is(label)).click();
 await page.getByRole('heading',{...is(label==='入口首頁'?'課後活動首頁':label),level:1}).waitFor();
}
async function closeForm(page){
 await page.getByRole('dialog').getByRole('button',is('取消')).click();
}
async function details(page,club,enabled,go=false){
 await page.locator('.week-event').filter({hasText:club}).first().click();
 const dialog=page.getByRole('dialog',is(club));
 await dialog.waitFor();
 assert.deepEqual(await dialog.getByRole('button').allTextContents(),['關閉','編修']);
 const edit=dialog.getByRole('button',is('編修'));
 assert.equal(await edit.isEnabled(),enabled);
 if(!go){await dialog.getByRole('button',is('關閉')).click();await dialog.waitFor({state:'hidden'});return;}
 await edit.click();
 const form=page.getByRole('dialog',is('提出社團異動'));
 await form.waitFor();
 assert.ok(await form.getByLabel('社團',{exact:true}).isDisabled());
 assert.ok(await form.getByLabel('原課程（代調課時填寫）',{exact:true}).inputValue());
 assert.ok(await form.getByLabel('調整後開始時間',{exact:true}).inputValue());
 await form.getByLabel('異動原因',{exact:true}).fill('自動驗收課程異動');
 await form.getByRole('button',is('確認儲存')).click();
 await form.waitFor({state:'hidden'});
 await page.getByText('自動驗收課程異動',is('自動驗收課程異動')).waitFor();
}

try{
 for(const [role,expected] of roles){
  const context=await browser.newContext();
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-21T12:00:00+08:00'));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',is('社團行事曆')).waitFor();
  await page.getByText(/課後活動 · 1\.0\.0/).waitFor();
  if(/github\.io/.test(url)){
   await page.getByRole('button',is('列印週課表')).waitFor();
   await page.waitForFunction(()=>!document.querySelector('.public-week-tools .print-control')?.disabled);
  }
  await page.getByText('角色體驗（假資料）',{exact:true}).click();
  await page.getByRole('button',is(role)).click();
  const nav=page.locator('.sidebar nav');
  assert.deepEqual((await nav.getByRole('button').allTextContents()).sort(),[...expected].sort(),role);
  for(const label of expected)await visit(page,label);
  await visit(page,'使用手冊');
  await page.getByRole('heading',is('聯絡教導處')).waitFor();

  if(expected.includes('本週課表')){
   await visit(page,'本週課表');
   await details(page,'足球小將',role!=='班級導師 hrtr',role!=='班級導師 hrtr');
   if(role==='社團老師 clubtr'){
    await visit(page,'本週課表');
    await details(page,'課後作業指導',false);
   }
   await visit(page,'授課與點名');
   const lesson=page.getByRole('combobox',is('選擇課程'));
   const lessonOptions=await lesson.locator('option').all();
   assert.ok(lessonOptions.length>1);
   await lesson.selectOption({index:1});
   await page.getByText('當節課程摘要',{exact:true}).waitFor();
   await visit(page,'請假與覆核');
   await page.getByRole('button',is('新增請假')).click();
   await closeForm(page);
  }

  if(role==='行政管理 admin'){
   await visit(page,'學生管理');
   await page.getByRole('button',is('批次匯入學生')).click();
   await page.getByRole('dialog').waitFor();
   await page.getByRole('dialog').getByRole('button',is('關閉')).click();
   await visit(page,'帳號管理');
   await page.getByRole('button',is('批次匯入校用帳號')).waitFor();
   await visit(page,'學期與設定');
   await page.getByRole('button',is('新增學期')).click();
   await closeForm(page);
   await visit(page,'行政核銷');
   await page.getByRole('button',is('預覽核算')).click();
   await page.getByRole('button',is('預覽簽到表')).waitFor();
   await visit(page,'異動管理');
   await page.getByRole('button',is('安排加課')).click();
   const schedule=page.getByRole('dialog',is('安排加課'));
   await schedule.getByRole('combobox',{name:/授課老師/}).selectOption('external');
   await schedule.getByLabel('外聘老師姓名').waitFor();
   await closeForm(page);
   await visit(page,'課表與名冊');
   await page.getByRole('combobox',{name:/班級／社團篩選/}).selectOption('class:三年甲班');
   assert.equal(await page.getByText('測試學生三',{exact:true}).count(),0);
   const popupPromise=page.waitForEvent('popup');
   await page.getByRole('button',is('列印名冊')).click();
   const popup=await popupPromise;
   await popup.getByText('參加社團',{exact:true}).first().waitFor();
   assert.equal(await popup.locator('.sidebar').count(),0);
  }

  if(role==='學生 stu'){
   await visit(page,'社團與報名');
   await page.getByRole('button',is('申請報名')).first().waitFor();
   await visit(page,'個人課表');
   await page.getByRole('button',is('列印個人週課表')).waitFor();
  }
  assert.deepEqual(errors,[],role);
  console.log('PASS',role,expected.length+' modules',url);
  await context.close();
 }
}finally{await browser.close();}
