<p align="center">
  <img src="apps/web/public/icon-512x512.png" alt="不用記帳 Logo" width="160">
</p>

# 不用記帳

**ALL SET — 自動同步銀行、信用卡、投資與電子發票的自架個人財務整合工具。**

**可免費自架：** 可透過 [Cloudflare Workers Free Plan](https://developers.cloudflare.com/workers/platform/pricing/) 一鍵部署，不需要自行準備伺服器；一般個人低頻使用可從免費方案開始。

## 目前介面

桌面版左側欄由上而下是「待處理」（需要處理的項目以紅點、待整理的項目以數字提示）、主導覽「本月／交易／信用卡／資產／資料來源」，最下方是「設定」；手機版底部列為「本月｜交易｜信用卡｜資產｜更多」，資料來源、待處理與設定收在「更多」，頁首右上另有待處理按鈕。桌面版頁首有全域搜尋與同步狀態，右側概況欄列出待處理、近期卡費與各資料來源的同步狀態（寬度 1280–1679px 時由頁首按鈕開啟）。

- **本月**（首頁）：以「收入 − 消費 ＝ 存下來」的算式呈現本月收支，下方列出存下來的去向（投資／留在帳戶）；接著是本月還可花（自己設定的每月預算扣掉已花與還沒扣款的固定支出，並算出每天約可花與照預算可存下多少，在「可花設定」調整）、週回顧（本週／上週的消費和過去 8 週比較、最大幾筆與新商家）、7 天內到期的卡費提醒、消費分類排行、近 6 個月消費與存下來、最近交易與淨資產。
- **交易**：分成「總帳」（去重後，所有數字只從這裡算）與「銀行」「信用卡」「發票」三個原始紀錄分頁；同一筆消費可能同時出現在信用卡與發票，原始紀錄分頁不顯示消費合計。「自動整理」管理分類規則。點開任一筆可寫「備註」（例如「跟朋友換匯」「代墊」「未實際扣款」），停止輸入後自動儲存，列表名稱下方會顯示 📝，也能被搜尋，並隨匯出提供給 LLM 分析；已配對的刷卡與發票共用同一則備註。沒有實際付款或已作廢的交易可在「這筆是…」選「不計入」，不算進任何收支（作廢發票會自動標示），選擇時可順便填寫原因存成備註。幫別人付的錢選「代墊」、對方還的錢選「收回代墊」並填寫對象：兩者都不算進收入和消費，本月頁的「代墊待收回」會依對象顯示還欠多少（多給時顯示多給多少）。消費分類只有 9 類（餐飲、交通、居住、購物、3C 數位、娛樂、醫療保險、捐款、其他），改一次分類可選擇套用到同商家並記住；電子發票（包括現金、電支付款、永遠配不到刷卡的發票）也能直接改分類。
- **信用卡**：各發卡行本期應繳、截止日倒數與各卡未出帳消費。
- **資產**：淨資產與每日資產走勢（第一次同步前的存款餘額由近 3 個月交易明細推算）、金融機構、投資與其他資產，以及無法同步的「我的其他帳戶」。
- **資料來源**：來源健康度、連接器、同步排程、最近一次排程同步與參考匯率。
- **設定**：通知與介面偏好（隱藏金額）。

以下畫面使用匿名 Demo 資料；截圖仍為導覽改版前的畫面（總覽、活動、設定），待重新擷取。

| 桌面版首頁（改版前：總覽，現為「本月」）                                                                                           | 手機版首頁（改版前：總覽，現為「本月」）                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a href="images/screenshots/01-dashboard.png"><img src="images/screenshots/01-dashboard.png" alt="桌面版首頁畫面" width="720"></a> | <a href="images/screenshots/02-overview-mobile.png"><img src="images/screenshots/02-overview-mobile.png" alt="手機版首頁畫面" width="260"></a> |

| 資產                                                                                                       | 交易（改版前：活動分析）                                                                                       | 資料來源（改版前：設定）                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| <a href="images/screenshots/03-assets.png"><img src="images/screenshots/03-assets.png" alt="資產畫面"></a> | <a href="images/screenshots/04-activity.png"><img src="images/screenshots/04-activity.png" alt="交易畫面"></a> | <a href="images/screenshots/05-settings.png"><img src="images/screenshots/05-settings.png" alt="資料來源畫面"></a> |

## 支援資料來源

| 資料來源     | 支援內容                                                                                              | 登入與驗證                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 電子發票載具 | 載具發票與品項明細                                                                                    | App 登入                                                |
| 集保 e 存摺  | 交割帳戶餘額與明細（[支援銀行](https://epassbook.tdcc.com.tw/zh/g1.aspx)）、股票、ETF、基金持倉與交易 | App 登入；首次可能需要 OTP                              |
| 玉山銀行     | 存款帳戶、餘額與交易；信用卡帳單與刷卡交易                                                            | 網銀登入                                                |
| 國泰世華銀行 | 臺幣存款帳戶、餘額與交易；外幣活存帳戶與餘額；信用卡帳單與刷卡交易                                    | 網銀登入；額外驗證需人工處理                            |
| 永豐行動銀行 | 臺外幣活存帳戶、餘額與近三個月交易；信用卡總覽、近期帳單與未出帳消費                                  | 網銀登入；AI 自動辨識驗證碼                             |
| 台新銀行     | 臺外幣活存帳戶、餘額與近三個月交易；信用卡額度、帳單、未出帳與即時授權消費                            | 網銀登入；AI 自動辨識驗證碼                             |
| 中國信託銀行 | 存款帳戶、餘額與交易；信用卡帳單、已入帳、未出帳與即時消費明細                                        | 自動同步暫停；[網銀半自動匯入](#中國信託網銀半自動匯入) |
| 新光銀行     | 臺外幣帳戶、餘額、交易明細與信用卡帳單                                                                | App 登入                                                |
| 華南銀行     | 存款帳戶與餘額；信用卡帳單與刷卡明細                                                                  | 網銀登入；AI 自動辨識驗證碼                             |
| 王道銀行     | 活存、定存、餘額與交易                                                                                | App 登入；AI 自動辨識驗證碼                             |
| 第一銀行     | 存款帳戶、餘額與交易明細；信用卡帳單與刷卡明細                                                        | 網銀登入；AI 自動辨識驗證碼                             |
| 凱基銀行     | 臺幣活存帳戶、餘額與交易明細                                                                          | 網銀登入；AI 自動辨識驗證碼                             |
| 樂天國際銀行 | 臺幣活存帳戶、每日餘額與交易明細                                                                      | 網銀登入；AI 自動辨識驗證碼                             |
| 兆豐銀行     | 存款帳戶、餘額與交易；信用卡帳單與消費                                                                | App 登入；AI 自動辨識驗證碼                             |
| 將來銀行     | 主帳戶與活存口袋餘額、交易；定存口袋餘額                                                              | 網銀登入；AI 自動辨識驗證碼                             |

## 使用限制

- 連接器依賴外部網頁、App API 與回應格式；資料來源改版後可能需要更新才能恢復同步。
- 系統不會繞過圖形驗證碼、OTP、裝置驗證等互動式安全機制；需要人工處理時會停止同步並顯示提示。
- 同步最多執行 10 分鐘；電子發票與集保包含 Queue 等待時間。停滯工作由排程恢復，也可在資料來源面板重試；逾時後需重新啟動同步。
- 部分銀行自動登入可能中斷你正在使用的官方 App 或網銀工作階段。
- 資料更新時間與完整性取決於外部服務，不應視為銀行、券商或財政部的即時正式對帳資料。
- 轉到無法同步的自有帳戶（或用轉帳繳款的未同步信用卡）時，可在「資產 → 我的其他帳戶」登記銀行與帳號末碼，讓互轉不計入收支、卡費另外標示；目前只有交易明細提供對方帳號的來源（國泰世華存款）能自動比對，只寫銀行名稱的轉帳需在交易明細手動排除，或在「交易 → 自動整理」建立分類規則。

## 中國信託網銀半自動匯入

中信自動同步目前無法使用：模擬 App 登入時中信回傳 `0131`（要求更新 App），而網路銀行有防機器人機制，會阻擋自動化或無頭瀏覽器。本專案不嘗試繞過這些機制，改提供需要你自己登入的半自動匯入：

1. 啟動 Worker（本機 `npm run dev`，或使用已部署的網址）。
2. 在 repo 根目錄執行（需 Node 24 與 macOS 上的 Google Chrome）：

   ```bash
   npm run ctbc:web-import -- --worker http://localhost:8797
   # 已部署且受 Cloudflare Access 保護時，改用 service token：
   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
     npm run ctbc:web-import -- --worker https://你的網域
   ```

3. 工具會用暫存 profile 開一個一般 Chrome 視窗，請在該視窗**自行**登入中信網銀；偵測到登入後，工具在同一頁面內唯讀查詢存款、信用卡帳單（含最近 3 期帳單明細）、未出帳與即時消費，送到 Worker 匯入，最後登出網銀、關閉該視窗並刪除暫存 profile（未指定 `--profile` 時）。

   想每次少打帳密，可加上 `--profile ~/.ctbc-chrome-profile`（shell 會展開 `~`，請勿加引號）使用固定的 Chrome profile：結束時只登出並關閉視窗、不刪除 profile，你可以在其中安裝密碼管理器，之後自行一鍵填入帳密，再輸入圖形驗證碼即可（密碼管理器仍可能要求解鎖）。工具本身仍不讀取或填寫任何登入欄位。注意：
   - 這個 profile 只用於中信匯入，不要指向日常使用的 Chrome profile，也不要在其中登入 Google 同步或瀏覽其他網站。
   - 目錄必須只有你能存取（權限 700），且執行前要先關閉以該 profile 開啟的 Chrome 視窗，否則工具會拒絕執行。
   - 工具執行期間 Chrome 開著本機除錯埠，同一台電腦上的其他程式可以控制這個瀏覽器；密碼管理器用完請鎖定。

限制：

- 資料來源頁不提供中信的「同步」按鈕與自動同步開關；後端的中信同步（手動與排程）一律回 `409 CTBC_AUTO_SYNC_PAUSED`，不再嘗試登入中信。自架在 Mac 上並設定匯入觸發器時（見[進階部署](docs/005-deployment.md#中信網銀匯入觸發器自架)），中信卡片會出現「在 mini 開啟網銀匯入」按鈕：按下後在那台 Mac 的螢幕開出 Chrome 視窗，仍要你到那台電腦前自己登入。
- 每次都要手動登入，無法以排程自動登入；資料來源頁的「最近同步」時間即為上次匯入時間；超過 7 天未匯入時「待處理」會提醒。
- 存款交易明細只能從網銀頁面本身取得：工具自己查詢會被中信拒絕（`H404`），所以要靠你在網銀點進存款帳戶的交易明細頁，工具直接收下頁面查到的明細。偵測到登入後，工具會等到看見明細才開始查詢，最多等 10 分鐘（`--deposit-wait` 可調整，0 表示不等）；沒點也會照常繼續，只是這次沒有存款明細，此時仍會匯入餘額與信用卡資料。有帳戶沒取得明細時，資料來源頁會顯示部分資料未取得的警告。例外是餘額為 0 的帳戶：只要其他帳戶有取得，就不列為警告，以免閒置帳戶讓每次匯入都帶警告；終端機仍會列出筆數。代價是餘額剛好為 0、但期間內有進出的帳戶，沒點進明細時不會有警告。明細頁預設只顯示本月，要補更早的交易，看到明細後可以切換查詢期間或帳戶。停止操作 15 秒後工具才開始查詢（沒點進明細頁時是 5 秒，最多等 3 分鐘），之後請勿再操作該視窗。
- 信用卡交易依卡片分成各自的帳戶（只為有消費或未出帳金額的卡建立）；合併帳單、應繳金額與繳款放在「中國信託信用卡（合併帳單）」帳戶。
- 信用卡帳單：最新一期明細工具自己就查得到；更早的月份工具自己查詢常被中信拒絕（`9999`），要補明細時請在網銀信用卡「帳單」切到那個月份（有分頁就每頁都翻過），工具直接收下頁面查到的明細，不再自己重送。偵測到登入後，工具會等你點開信用卡帳單月份或存款明細才開始查詢（見上一點的等待規則）。某期帳單明細仍取不到時照樣匯入該期帳單總額，終端機會列出未取得明細與分頁未收齊的月份。只要每期帳單出帳後至少匯入一次，新的帳單明細會由最新一期與未出帳涵蓋，不需要每次都切月份。
- 終端機只顯示查詢項目、回應代碼、筆數、匯入結果，以及診斷用的頁面請求路徑與欄位名稱，不顯示或儲存帳號、金額與登入資訊。
- 中信網頁改版後，工具可能需要更新才能繼續使用。

## 免費部署

本專案使用的 Workers、D1、Queues、Workers AI 與 Browser Run 均提供免費額度。各項免費額度並非無限；超過服務限制時，相關功能可能暫停至額度重置。

**需要：** [Cloudflare 帳號](https://dash.cloudflare.com/signup)、[GitHub 帳號](https://github.com/signup)

### 步驟一：一鍵部署

點擊下方按鈕。Cloudflare 會在你的 GitHub 帳號建立新的 repository、自動建立 D1 Database，並部署至 Cloudflare Workers：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TedLin1993/all-set-tw)

首次使用時，依畫面透過 **Git account → New Github Connection → Install & Authorize** 授權 Cloudflare 存取 GitHub。

Worker Secret 只需填入 **`CONFIG_ENCRYPTION_KEY`**。

`CONFIG_ENCRYPTION_KEY` 是系統加密連接器設定時必須使用的金鑰，可用下列指令產生：

```bash
openssl rand -hex 32
```

金鑰只需填入一次，Cloudflare 會保存供後續更新使用。建議另外存入密碼管理器，重建或搬移時使用相同金鑰；不要在既有部署中更換或刪除，以免無法解密連接器設定。

<img src="images/deploy-setup.png" alt="Cloudflare 部署頁的 CONFIG_ENCRYPTION_KEY 欄位" width="700">

將 **Build command** 設為 `npm run build`、**Deploy command** 設為 `npm run deploy`，資源名稱可保留預填值。在同一頁開啟 **Protect with Cloudflare Access**，設定：

- **Scope：All traffic**，保護正式與預覽部署
- **Authentication policy：Cloudflare account**，限定你的 Cloudflare 帳戶成員登入
- **Session duration**：可保留預設 **24 hours**；想延長可選 **7 days**

<img src="images/deploy-access-on-create.png" alt="部署頁開啟 Cloudflare Access，選擇 All traffic 與 Cloudflare account" width="700">

確認後點擊 **Deploy**。前往 **Worker → Settings → Builds**，等該次 build 顯示成功後重新整理 Worker 頁面，再開啟網站。登入驗證設定會自動取得，後續更新也會沿用。

### 步驟二：確認部署

1. 開啟 Worker 的 `workers.dev` 網址，確認會先要求 Cloudflare Access 登入
2. 登入後前往「資料來源」設定連接器
3. 點擊同步以取得最新資料

### 延長登入期限（選用）

部署頁的 **Session duration** 最多可選 **7 days**。若要延長至一個月，部署完成後前往 **Cloudflare One／Zero Trust → Access controls → Applications**，找到保護此 Worker 的 Application：

若頁面顯示 **Finish your account setup**，先點擊 **Choose a plan**，完成 **Zero Trust Free** 方案設定。

1. 點擊該 Application 的 **Configure**，開啟 **Application details**。
2. 點擊頁面上方與 **All、Destinations、Policies** 同一排的 **Details** 按鈕，或直接向下捲到頁面最下方。
3. 在 **Details** 區塊的 **Name** 欄位旁，將 **Session Duration** 設為 **1 month**，再點擊 **Save**。

後續自動部署與更新會沿用這些登入設定。

部署與登入故障排查及自動更新原理，請參考[進階部署與更新](docs/005-deployment.md)。

## 自動更新

Cloudflare 的 Deploy to Cloudflare 流程目前不會將 `.github/workflows` 複製到新 repository，因此首次部署可以正常使用，但需要完成下方的一次性設定才會啟用版本更新。

### 一次性啟用更新功能

不需要修改程式碼，可直接在 GitHub 網頁完成：

1. 在你的部署 repository 開啟 [`deploy/github/sync-upstream.yml`](deploy/github/sync-upstream.yml)，點擊 **Raw** 並複製完整內容
2. 回到 repository 首頁，選擇 **Add file → Create new file**
3. 將檔名設為 `.github/workflows/sync-upstream.yml`，貼上剛才複製的內容並 commit 至 `main`
4. 前往 **Settings → Actions → General → Workflow permissions**，確認已允許 GitHub Actions 讀寫 repository 內容

若已將 repository clone 至本機，也可以執行：

```bash
mkdir -p .github/workflows
cp deploy/github/sync-upstream.yml .github/workflows/sync-upstream.yml
git add .github/workflows/sync-upstream.yml
git commit -m "啟用版本自動更新"
git push
```

完成一次性設定後，可以前往部署 repository 的 **Actions → Sync Latest Version → Run workflow**，點擊 **Run workflow** 立即更新。workflow 也會在每天台灣時間 **04:15** 自動執行。

每次執行會取得最新版本、進行安全三方合併，並由 Cloudflare Workers Builds 重新部署。若你修改過程式碼並與上游發生衝突，workflow 會停止且不會推送；請從 Actions 紀錄查看衝突並手動處理。首次同步、備份 branch 與舊版 workflow 的排查方式請參考[進階部署與更新](docs/005-deployment.md)。

### 升級說明：2026-09 分類改版

更新後資料庫 migration 會自動調整既有資料，不需手動操作。從先前發布的版本（migration 0048）升級時，分類改版會完整保留你的自訂分類與系統規則調整：

- **消費分類改為 9 類**：餐飲、交通、居住、購物、3C 數位、娛樂、醫療保險、捐款、其他；收入、轉帳、投資與繳卡費改由「這筆是…」（經濟角色）表示。舊分類的對應：薪資 → 收入（薪資）；轉帳、投資 → 對應的角色；教育 → 其他；娛樂 → 娛樂；手續費、稅務 → 其他；保險、醫療 → 醫療保險；軟體服務 → 3C 數位；生活繳費 → 居住。「捐款」是新增的分類：舊版的「捐款」子分類會對應到它，但原本歸在其他分類（例如「其他」）的慈善交易與商家規則不會自動改歸捐款，需要時可自行改分類或設定商家規則。
- **自訂分類保留**：你建立的分類、以及指到它們的個別分類與規則都不會刪除或改指；只有名稱與新系統分類相同時（例如自訂的「捐款」「旅遊」）會改名為「捐款（自訂）」。
- **系統規則的調整保留**：你停用、調整優先序或修改過關鍵字的系統規則會沿用你的設定；被拆分或移除的系統規則，停用狀態與調整過的優先序會沿用到接替的新規則，改過的關鍵字會轉成你的自訂規則。
- 所有改動（改名的分類、改指的分類與規則、保留的關鍵字與未套用的新版預設）都記錄在遷移紀錄，可由 `GET /api/classification/migration-notes` 查看。

## 本機開發

建立不納入版本控制的私人設定，將 `wrangler.local.toml` 的 D1 Database ID 換成開發用資料庫，並在 `.dev.vars` 設定自己的 `CONFIG_ENCRYPTION_KEY`：

```bash
cp apps/worker/wrangler.local.toml.example apps/worker/wrangler.local.toml
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm install
npx wrangler login
npm run dev
```

範例設定的 D1 與 Workers AI 會連到 Cloudflare remote binding，請勿使用正式資料庫。常用驗證指令：

```bash
npm run format:check
npm run typecheck
npm run verify:web
npm run test:backend
npm run build
```

本機 relay、資料庫遷移與既有 D1 部署方式請參考[進階部署與更新](docs/005-deployment.md)。

## 技術架構

前端使用 Svelte 5、TypeScript、Tailwind CSS 4 與 shadcn-svelte。

後端執行於 Cloudflare Workers，以 Hono 提供 API，並整合 D1、Access、Browser Run、Workers AI、Cron Triggers 與 Queues。

專案以 npm workspaces 管理 `apps/web`、`apps/worker` 與根目錄的 `shared/`。`shared/` 以 `@taiwan-fin-hub/shared` 提供前後端共用的型別、契約與純邏輯。資料庫程式位於 `apps/worker/src/db`，SQL migrations 位於 `apps/worker/migrations`；各銀行、集保與電子發票的同步、connector、API client 及資料解析集中於 `apps/worker/src/sources/<connectorId>`，共用同步管理位於 `apps/worker/src/features/sync`。

前後端與共用套件皆使用 TypeScript 7 型別檢查；Svelte 前端透過 `svelte-check --tsgo` 執行，並保留工具所需的 TypeScript 6 相依。

詳細設計請參考[後端架構](docs/002-backend-architecture.md)、[前端架構](docs/003-frontend-architecture.md)與[連接器開發](docs/004-connector-development.md)。

## 安全機制

- Cloudflare Access 是一般模式的登入閘道；Worker 會驗證 JWT 的簽章、issuer、audience 與有效期限。
- 連接器帳密以 `CONFIG_ENCRYPTION_KEY` 衍生的金鑰進行 AES-GCM 加密，D1 只儲存密文。
- 目前不支援金鑰輪替；若刪除或更換 Cloudflare 中的金鑰，必須重新設定所有連接器。

## 免責聲明

本程式僅供個人研究與自用，未與臺灣集中保管結算所、財政部、金融監督管理委員會、各銀行或任何金融機構合作，亦未獲前述機構授權或背書。本程式所呈現之資料以您自行提供之憑證取得，作者不保證資料之即時性、正確性與完整性，亦不對因使用本程式所產生之任何直接或間接損失負責。請勿將本程式用於任何商業用途。

## License

本專案採用 [MIT License](LICENSE)，並保留原專案的著作權與授權聲明。

> 本專案以 [kevchentw/taiwan-fin-hub](https://github.com/kevchentw/taiwan-fin-hub) 為基礎發展而來。感謝原作者與貢獻者奠定專案基礎。
