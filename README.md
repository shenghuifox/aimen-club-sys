# 隘門國小課後活動管理系統

第一版試辦系統。React 前台部署於 GitHub Pages，Supabase 負責登入、角色授權、業務資料與核銷快照。

## 使用

部署網址：https://shenghuifox.github.io/aimen-club-sys/

登入頁提供四種**假資料角色體驗**：admin、stu、clubtr、hrtr。這些體驗按鈕不是 Auth 帳號；僅修改目前瀏覽器中的假資料，請勿輸入真實個資。

正式測試帳號需先完成下方資料庫安裝與 Auth 建立，再使用帳號密碼登入。

## 第一次安裝 Supabase

1. 在專案 eddaalutgxmanorbfrbm 的 SQL Editor，以管理者依序執行 `supabase/schemas/001_club.sql` **一次**、`002_recurring_and_student_binding.sql`、`003_edit_changes.sql`。已安裝 0.2.0 者只需執行 003。升級不刪除既有資料。
2. 在可信任的本機環境設定 `SUPABASE_SECRET_KEY`（伺服器 secret / legacy service_role key），執行 `node scripts/bootstrap.mjs`。金鑰不應貼在聊天、放入 VITE_ 變數或提交 GitHub。
3. 建立後，四個帳號的隨機密碼會保存到本機 `credentials-test-accounts.json`（已加入 gitignore）。帳號會映射成 `帳號@test.aimen.invalid`。此網域僅用於獨立測試，不支援收信或自助重設。
4. admin 登入後建立社團、上課節次、學生名冊，將 stu 綁定學生、hrtr 指定為導師。核對課程與權限後進行試辦。
5. 正式啟用前新增並驗證第二位管理者。第一版允許初始管理者安裝，阻擋管理者數量少於或等於兩位時的撤權。

### Google 登入

目前預設關閉。需於 Google Cloud 與 Supabase 啟用 provider、設定回呼及允許的 GitHub Pages 網址，並以學校未成年學生帳號驗證存取。完成後設 `VITE_GOOGLE_AUTH_ENABLED=true`；登入身分仍須綁定 `club_private.users`，不可自行選角色。

## 開發與部署

Node 22 以上，pnpm 11.25.0。`pnpm install`、`pnpm test`、`pnpm test:db`、`pnpm build`。本機複製 `.env.example` 至 `.env.local`，填入可公開的 Publishable key。禁止把 secret key 放在前台。

main 推送後，`.github/workflows/pages.yml` 執行單元與資料庫測試，再建置部署。GitHub Settings → Pages → Source 須選 GitHub Actions。

## 第一版範圍與限制

0.3.0 更新：異動管理新增編修及歷史紀錄，已確認代調課以新修訂保留原紀錄；待覆核編修維持待覆核。詳見 `升級至0.3.0.md`。

0.2.0 更新：本週課表及社團頁新增「批次新增週期課程」，提供日期區間、複選星期、時段、節數、教師、費率及排除日期。先預覽後整批交易新增；完全相同的課程略過，任何衝突則全批失敗。每批最多 200 次，不自動排除國定假日。

「課表與名冊」每列新增「修改／綁定帳號」。行政須確認學生身分，一個學生帳號同學期只能綁定一名學生。學生未綁定時，報名頁提供具體提醒並停用報名按鈕。

- 已實作：入口網、週課表、社團建立／報名／錄取、名冊 CSV、請假覆核、授課簽到與點名、學生增退與代調課、每週安排調整、分期核銷快照與列印、角色及學期設定。
- 簽到表包含出席學生數、系統簽到時間、紙本親簽欄、承辦人確認後核章；鐘點費憑證合併多位教師，依費率分列。
- 週次調整目前對選定節次及後續未授課節次套用相同時間位移；複雜多時段課程請分次確認。
- 尚待完成驗收：附件憑證完全等比例版型、XLSX／完整個人與班級 PDF 匯出、課程設定編輯與批次匯入、核銷作廢更正、停課與雙向交換流程、Email／推播、備份還原演練。請勿直接作正式財務核銷。
- 核銷鎖定時儲存不可變更的 JSON 資料快照，文件由快照產生；尚未保存 PDF 檔本體，原始憑證個資欄位待確認後新增。
- 初版對業務異動採單一交易鎖以避免超收及重複結算，適合單校試辦；擴大前需負載測試。
- 所有應用資料表位於不公開 schema 並啟用 RLS、對前台禁止直接存取。兩個具明確授權檢查的 RPC 為唯一讀寫入口；使用者角色由資料庫管理。

## 測試

`scripts/test-db.mjs` 在獨立的 PGlite Postgres 中建立模擬 Auth 環境，檢查匿名拒絕、學生隔離、越權、錄取名額、請假覆核與核銷鎖定。通過本機測試不代表已在遠端專案完成安裝。
