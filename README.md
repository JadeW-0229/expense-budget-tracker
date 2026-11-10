# 經費核銷與可用預算查詢系統

獨立於既有「經費核銷指南」的新專案。沿用已確認的管理端及 Viewer 介面，帳務資料由 Supabase 保存，不讀取或匯入本機 MVP 的 localStorage。

## 指定服務

- GitHub：`JadeW-0229/expense-budget-tracker`
- Supabase：`https://dixtljbocpdjrgczbqjr.supabase.co`
- 來源：`20261109_追蹤表_業務費紀錄.xlsx`，353 筆。
- 基準已發生淨額：7,465,834 元；已核銷淨額：6,371,741 元。

這些基準包含國外旅費，排除執辦辦公室費用。文具原始明細的3,900元已轉列辦公室，因此計畫合計另扣一次3,900元；原始各筆金額不改寫。部分篩選結果標示「篩選明細原額」，避免把這3,900元任意分攤到不確定的來源列。

## 功能及計算

- Viewer 匿名唯讀，管理端使用 Supabase Auth 密碼登入；資料庫管理者名單決定寫入權限，前端帳號旗標無效。
- `261524` 可作為管理者登入別名，必須先在設定中對應實際 Auth 電子郵件。密碼由 Auth 保存，程式碼不包含固定管理密碼。
- 總覽、明細、組別詳細視窗、固定窗格、篩選排序、預算調整及期末列表均保留。
- 一般可用預算＝預算－各組起日後已發生；新建或財務修改的支出保留預算占用，回填日期不能繞過檢查。
- 國外旅費全部歸教學部，專款金額單獨列出，排除一般預算合計。
- 期末待核銷小計＝各組各科目預算合計－各組起日（含當日）起的已核銷合計。
- 每次寫入在資料庫交易中鎖定帳本、檢查預算及版本；衝突退回重新操作，不覆蓋另一人的更新。
- 15秒定期同步及視窗回到前景時更新。同步失敗會顯示狀態，不切換到舊的本機帳本。
- 左下角顯示資料庫最後成功新增／儲存／刪除的台北日期；讀取、登入及自動同步不會變更日期。
- 休眠喚醒、恢復網路及切回分頁時重新讀取；未取得新資料前遮蔽舊數字，保留重連按鈕。
- 登入逾期先嘗試刷新；刷新被撤銷時回到匿名查詢及重新登入，不把舊管理旗標當授權。
- 寫入有固定請求識別碼。逾時重試不重複寫入；回應遺失可透過唯讀確認函式核對；無法確認時明確提示不要重複新增。
- 程式、樣式與公開設定使用內容雜湊；定期檢查release.json並提示載入新版，避免舊分頁長期停留在舊程式。

## 初始化 Supabase

1. 在指定的新專案依檔名順序執行 `supabase/migrations/` 的SQL遷移檔。
2. 由維護者從本機執行 `npm run prepare-import`。此命令需要本機 MVP 的已核對 `data.js`，產生 `private-import/initialize.sql`；不屬於部署或 CI 步驟。
3. 在 SQL Editor 執行私密的 `initialize.sql`。只可初始化一次，重複執行會失敗，不覆蓋管理者修改。
4. 在 Authentication → Users 建立管理者（電子郵件、管理密碼）。把對應使用者 UUID 加入 `expense_private.admins`：

   ```sql
   insert into expense_private.admins(user_id) values ('管理者UUID');
   ```

5. 將公開的 publishable/anon API key 設定到 `web/config.js`；如要沿用數字帳號別名，設定 `adminLoginEmail`。

維護者也可將已確認的管理者電子郵件加入 `expense_private.approved_admin_emails`，該使用者完成電子郵件驗證後自動授權；未驗證或不在核准名單者不取得管理權限。

`expense_private` 內的資料表啟用 RLS，且不授予匿名或一般登入使用者直接讀寫權限。公開查詢只經 `expense_snapshot()`；`expense_commit()` 必須是 allowlist 中的 Auth 使用者。每次成功寫入會保留修改前後稽核快照。

禁止將 `service_role`、`sb_secret_`、資料庫密碼放進前端。正式版刻意不提供本機資料自動上傳，避免將測試修改帶入正式帳本。

## 建置與驗證

使用 Node 24：

```text
npm ci
npm test
npm run build
```

輸出為 `dist/`，可部署到支援靜態網站的服務。正式庫未連線、公開金鑰未設定或初始化未完成時，頁面明確顯示錯誤，不顯示假資料。

27項測試涵蓋PGlite真實PostgreSQL引擎上的權限、超支、回填日期、精度、付款、刪除、稽核及版本衝突，以及登入恢復、重試識別、舊資料遮蔽與台北日期。本機使用私密來源基準測試；GitHub CI 使用合成測試資料，不提交個人明細。

## GitHub Pages

1. 上傳程式後，設定儲存庫 Pages 來源為 GitHub Actions。
2. 在 Actions 的 Repository variables 設定 `SUPABASE_PUBLISHABLE_KEY`；如需登入別名，另設 `SUPABASE_ADMIN_LOGIN_EMAIL`。
3. 先完成 Supabase 初始化與管理者授權，再手動執行 `Deploy expense website` workflow。
4. 實際網站網址以部署成功後的輸出為準；目前沒有部署收據就不表示已上線。

Private 儲存庫是否能使用 Pages 取決於帳號方案；不要自行改成 Public。此儲存庫只收程式與遷移結構，不收 Excel、支出快照或登入秘密。

## 尚需遠端確認

本機測試與建置不等於雲端部署。須確認 GitHub 連線能存取指定儲存庫、Supabase 已授權，再執行實際遷移、匯入、建立管理者及驗收。

Supabase的Free專案可能因7天低使用量被平台自動暫停；此狀態無法由網站前端自行解除。須到Supabase Dashboard恢復專案，或評估不受自動暫停影響的付費方案。本程式不擅自升級或產生額外保活排程費用。參考：[官方專案暫停規則](https://supabase.com/docs/guides/platform/free-project-pausing)。

官方參考：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[資料庫函式](https://supabase.com/docs/guides/database/functions)、[密碼登入](https://supabase.com/docs/guides/auth/passwords)。
