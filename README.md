<p align="center">
  <img src="apps/web/public/icon-512x512.png" alt="不用記帳 Logo" width="160">
</p>

# 不用記帳

**ALL SET — 自動同步銀行、信用卡、投資與電子發票的自架個人財務整合工具。**

**可免費自架：** 可透過 [Cloudflare Workers Free Plan](https://developers.cloudflare.com/workers/platform/pricing/) 一鍵部署，不需要自行準備伺服器；一般個人低頻使用可從免費方案開始。

## 目前介面

桌面版左側欄由上而下是「待處理」（需要處理的項目以紅點、待整理的項目以數字提示）、主導覽「本月／交易／信用卡／資產／資料來源」，最下方是「設定」；手機版底部列為「本月｜交易｜信用卡｜資產｜更多」，資料來源、待處理與設定收在「更多」，頁首右上另有待處理按鈕。

- **本月**（首頁）：以「收入 − 消費 ＝ 存下來」的算式呈現本月收支，下方列出存下來的去向（投資／留在帳戶）；接著是 7 天內到期的卡費提醒、消費分類排行、近 6 個月消費與存下來、最近交易與淨資產。
- **交易**：分成「總帳」（去重後，所有數字只從這裡算）與「銀行」「信用卡」「發票」三個原始紀錄分頁；同一筆消費可能同時出現在信用卡與發票，原始紀錄分頁不顯示消費合計。「自動整理」管理分類規則。點開任一筆可寫「備註」（例如「跟朋友換匯」「代墊」「未實際扣款」），停止輸入後自動儲存，列表名稱下方會顯示 📝，也能被搜尋，並隨匯出提供給 LLM 分析；已配對的刷卡與發票共用同一則備註。沒有實際付款或已作廢的交易可在「這筆是…」選「不計入」，不算進任何收支（作廢發票會自動標示），選擇時可順便填寫原因存成備註。消費分類只有 9 類（餐飲、交通、居住、購物、3C 數位、娛樂、醫療保險、捐款、其他），改一次分類可選擇套用到同商家並記住；電子發票（包括現金、電支付款、永遠配不到刷卡的發票）也能直接改分類。
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
| 國泰世華銀行 | 存款帳戶、餘額與交易；信用卡帳單與刷卡交易                                                            | 網銀登入；額外驗證需人工處理                            |
| 永豐行動銀行 | 信用卡總覽、近期帳單與未出帳消費                                                                      | 網銀登入；AI 自動辨識驗證碼                             |
| 台新銀行     | 信用卡額度、帳單、已入帳與即時授權消費                                                                | 網銀登入；AI 自動辨識驗證碼                             |
| 中國信託銀行 | 存款帳戶、餘額與交易；信用卡帳單、已入帳、未出帳與即時消費明細                                        | 自動同步暫停；[網銀半自動匯入](#中國信託網銀半自動匯入) |
| 新光銀行     | 臺外幣帳戶、餘額、交易明細與信用卡帳單                                                                | App 登入                                                |
| 華南銀行     | 存款帳戶與餘額；信用卡帳單與刷卡明細                                                                  | 網銀登入；AI 自動辨識驗證碼                             |
| 王道銀行     | 活存、定存、餘額與交易                                                                                | App 登入；AI 自動辨識驗證碼                             |
| 第一銀行     | 存款帳戶、餘額與交易明細；信用卡帳單與刷卡明細                                                        | 網銀登入；AI 自動辨識驗證碼                             |
| 凱基銀行     | 臺幣活存帳戶、餘額與交易明細                                                                          | 網銀登入；AI 自動辨識驗證碼                             |

## 使用限制

- 連接器依賴外部網頁、App API 與回應格式；資料來源改版後可能需要更新才能恢復同步。
- 系統不會繞過圖形驗證碼、OTP、裝置驗證等互動式安全機制；需要人工處理時會停止同步並顯示提示。
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

3. 工具會用暫存 profile 開一個一般 Chrome 視窗，請在該視窗**自行**登入中信網銀；偵測到登入後，工具在同一頁面內唯讀查詢存款、信用卡帳單（含最近 3 期帳單明細）、未出帳與即時消費，送到 Worker 匯入，最後登出網銀、關閉該視窗並刪除暫存 profile。

限制：

- 每次都要手動登入，無法排程；資料來源頁的「最近同步」時間即為上次匯入時間；超過 7 天未匯入時「待處理」會提醒。
- 存款交易明細的查詢參數尚未完全確認，取不到時仍匯入餘額與信用卡資料，並在資料來源頁顯示部分資料未取得的警告。登入後先點進任一存款帳戶的交易明細頁，可讓工具沿用頁面實際使用的參數。
- 信用卡交易依卡片分成各自的帳戶（只為有消費或未出帳金額的卡建立）；合併帳單、應繳金額與繳款放在「中國信託信用卡（合併帳單）」帳戶。
- 某期帳單明細取不到時仍匯入該期帳單總額，終端機會列出未取得明細的月份。
- 終端機只顯示查詢項目、回應代碼、筆數與匯入結果，不顯示或儲存帳號、金額與登入資訊。
- 中信網頁改版後，工具可能需要更新才能繼續使用。

## 免費部署

本專案使用的 Workers、D1、Queues、Workers AI 與 Browser Run 均提供免費額度。各項免費額度並非無限；超過服務限制時，相關功能可能暫停至額度重置。

**需要：** [Cloudflare 帳號](https://dash.cloudflare.com/signup)、[GitHub 帳號](https://github.com/signup)

### 步驟一：一鍵部署

點擊下方按鈕。Cloudflare 會在你的 GitHub 帳號建立新的 repository、自動建立 D1 Database，並部署至 Cloudflare Workers：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TedLin1993/all-set-tw)

Cloudflare Builds 會在 build 階段自動檢查並建立排程同步所需的 Queue；正式部署腳本也會再次檢查。既有安裝更新到使用 Queue 的版本時不需要手動建立資源。

首次使用時，依畫面透過 **Git account → New Github Connection → Install & Authorize** 授權 Cloudflare 存取 GitHub。

部署頁會先預填 Access 相關欄位；首次部署只需將 `CONFIG_ENCRYPTION_KEY` 改成自己產生的隨機金鑰，`TEAM_DOMAIN` 與 `POLICY_AUD` 會在步驟二設定。

<img src="images/deploy-setup.png" alt="Cloudflare 部署設定" width="450">

`CONFIG_ENCRYPTION_KEY` 是系統加密連接器設定時必須使用的金鑰，可用下列指令產生：

```bash
openssl rand -hex 32
```

使用一鍵部署時只需填入一次，部署後由 Cloudflare 保存；日常使用與後續自動更新不需要重新輸入。沒有另外記下金鑰不會影響現有部署，但若日後要重建 Worker、搬移環境或沿用既有 D1，就必須使用相同金鑰，否則需要重新設定所有連接器。若重視災難復原，建議將它保存在密碼管理器；無論是否另外保存，都不要在既有部署中任意更換或刪除。

填寫完成後點擊 **Deploy**。

### 步驟二：啟用登入保護

1. 前往 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**，選擇剛建立的 `taiwan-fin-hub`
2. 開啟 **Domains**，將 Worker URL 的存取模式從 **Public** 改為 **Restricted**
3. 若沒有 **Domains** 頁籤，請至 **Settings → Domains & Routes**，在 `workers.dev` 網址旁啟用 Cloudflare Access

<img src="images/deploy-domains-restricted.png" alt="啟用 Cloudflare Access" width="700">

切換後，Cloudflare 會顯示以下資訊：

- **Audience (aud)**：填入 Worker Secret `POLICY_AUD`
- **JWKs URL**：取出前面的網域作為 `TEAM_DOMAIN`，例如 `https://yourteam.cloudflareaccess.com`

前往 **Settings → Variables and secrets** 設定這兩個 Secret。

<img src="images/deploy-secrets.png" alt="設定 Cloudflare Access Secrets" width="700">

### 步驟三：確認部署

1. 開啟 Worker 的 `workers.dev` 網址，確認會先要求 Cloudflare Access 登入
2. 登入後前往「資料來源」設定連接器
3. 點擊同步以取得最新資料

### 步驟四：調整登入方式與有效期限（選用）

Cloudflare Access 可能預設使用 Email OTP，登入狀態通常會在 24 小時後過期。以下設定可改用 Cloudflare 帳號登入，並將登入期限延長至一個月。

#### 使用 Cloudflare 帳號登入

1. 前往 **Zero Trust → Integrations → Identity providers**，確認已有 **Cloudflare**；若沒有，點選 **Add new identity provider → Cloudflare**
2. 啟用 **Restrict to account members** 並儲存，避免非此 Cloudflare 帳號成員登入
3. 前往 **Zero Trust → Access controls → Applications → taiwan-fin-hub → Authentication**，將登入方式設為 **Cloudflare**
4. 若只使用此登入方式，可啟用 **Apply instant authentication**，略過登入方式選擇頁

新建立的 Zero Trust organization 通常已預設啟用 Cloudflare identity provider，不需要另外新增。

#### 將登入期限延長至一個月

1. 在 `taiwan-fin-hub` Access Application 中，將 **Session Duration** 設為 **1 month**
2. 前往 **Zero Trust → Access controls → Access settings**，將 **Global session duration** 設為 **1 month**
3. 若 Access Policy 另外設定了 Session Duration，也要改為一個月，否則會以較短的期限為準

更多 Queue、Access、自動更新原理與故障排查請參考[進階部署與更新](docs/005-deployment.md)。

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

- **消費分類改為 9 類**：餐飲、交通、居住、購物、3C 數位、娛樂、醫療保險、捐款、其他；收入、轉帳、投資與繳卡費改由「這筆是…」（經濟角色）表示。舊分類的對應：薪資 → 收入（薪資）；轉帳、投資 → 對應的角色；教育 → 其他；娛樂 → 娛樂；手續費、稅務 → 其他；保險、醫療 → 醫療保險；軟體服務 → 3C 數位；生活繳費 → 居住。「捐款」是新增的分類，既有交易不會自動改歸捐款，需要時可自行改分類或設定商家規則。
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

專案以 npm workspaces 管理 Web、Worker、共用型別、資料庫與連接器套件。

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
