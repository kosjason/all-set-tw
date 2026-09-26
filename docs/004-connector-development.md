# Connector 開發規範

本文件定義 Taiwan Fin Hub 新增與維護 connector 的共同流程。目標是讓 connector 的識別資訊、設定欄位、同步執行、敏感狀態、前端表單與測試保持同步，避免只完成其中一層便上線。前半段是共通規範與新增流程，各來源的特殊行為集中在文末。

## 共同註冊點

Connector 採三層 registry：

| 層級            | 位置                                                                      | 責任                                                  |
| --------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| 共用 catalog    | `packages/core/src/index.ts` 的 `connectorCatalog`                        | ID、顯示名稱、連接模式、scope、資料能力、設定欄位分類 |
| Config registry | `packages/connectors/src/index.ts` 的 `connectorConfigSchemas`            | Zod schema 與設定解析                                 |
| Worker runtime  | `apps/worker/src/features/sync/registry.ts` 的 `connectorRuntimeRegistry` | 手動／排程同步與互動式 challenge handler              |

三個 registry 都必須以 `Record<ConnectorId, ...>` 宣告。新增 `ConnectorId` 後，TypeScript 應立即指出尚未補齊的 config 或 runtime。

前端資料來源名稱由 `connectorCatalog` 產生；表單欄位 key 必須符合 catalog 宣告的 credential 或 public field，不得使用未受型別限制的任意字串。

## 連接模式

新增 connector 前先選擇最接近的連接模式：

| Mode                      | 適用情境                                                 | 現有範例                         |
| ------------------------- | -------------------------------------------------------- | -------------------------------- |
| `api_credentials`         | 帳密登入外部 API，可自行更新 token                       | 電子發票、中信、新光             |
| `api_captcha_session`     | App API 登入含 CAPTCHA，challenge 僅短暫加密保存         | 王道銀行                         |
| `api_device_otp`          | API 登入，首次裝置需要 OTP                               | 集保 e 存摺                      |
| `browser_per_sync`        | 每次同步都必須以 Browser 登入與擷取                      | 國泰世華                         |
| `browser_session`         | Browser 只負責登入，後續使用可復用的 HTTP session        | 玉山                             |
| `browser_captcha_session` | Browser 登入含 CAPTCHA，可由 AI 或人工完成並復用 session | 永豐、台新、華南、第一銀行、凱基 |

不要為單一銀行建立新的通用框架。只有登入生命週期真的不同時才新增 mode，並同時補上 catalog 說明及共同測試。

## 設定與狀態分級

每個欄位只能有一個權威儲存位置：

| 狀態           | 儲存位置                         | 允許內容                                                     |
| -------------- | -------------------------------- | ------------------------------------------------------------ |
| 公開偏好       | `public_config`                  | 使用者可調整、且不影響敏感狀態的 connector 偏好              |
| 機密設定       | `encrypted_config`               | 帳密、cookie、access token、device token、Browser session ID |
| 同步 cursor    | `sync_cursor`                    | 日期、頁碼、watermark、已完成區間等非敏感增量位置            |
| 暫時 challenge | `encrypted_config`，且必須有 TTL | CAPTCHA、OTP、待提交的 API／Browser session                  |

強制規則：

- `sync_cursor` 不得包含 cookie、token、OTP 或任何可恢復登入狀態的資料。
- Connector 可在內部 cursor 回傳 session，但 sync service 必須透過 `splitConnectorCursorState` 將 secret state 移入加密設定後才持久化。
- 舊版已存在於 cursor 的 session 不得直接由 D1 migration 刪除；應讓新版 connector 相容讀取一次，並在首次成功同步時搬入 `encrypted_config`，避免強迫使用者重新驗證。
- 公開設定透過 `parsePublicConnectorConfig` 合併後再交給 config schema；不得把相同欄位複製到 encrypted config。
- 同步回溯範圍是 connector 的 runtime policy，不得做成公開偏好：電子發票固定同步最近 2 期；銀行 connector 固定同步最近 3 個月或 3 期帳單。舊版 `periodsBack` 與 `lookbackMonths` 必須忽略並在後續設定儲存時移除。
- 電子發票品項明細是固定同步 policy，不是公開偏好：不得新增 `fetchDetails` catalog field、前端 checkbox 或 sync request override。既有 `public_config.fetchDetails` 在 migration 與下一次設定儲存時必須移除。
- 任一 credential 變更時，必須清除 catalog `resetOnCredentialChangeFields` 宣告的衍生狀態與既有 cursor。
- Challenge 成功、失敗或逾時後都必須清除 CAPTCHA、OTP 與 Browser session reference。
- Log、錯誤回應與 `raw` 不得包含帳密、完整帳號／卡號、cookie 或 token。

## Config schema

每個 connector 在 `packages/connectors` 提供：

1. `<connectorId>ConfigSchema`。
2. `<ConnectorId>Config` inferred type。
3. `parse<ConnectorId>Config`。
4. `connectorConfigSchemas` registry entry。

Schema 需要涵蓋同步期間會持久化的 secret state，否則 Zod parse 會將欄位移除。使用者可不填、但正式同步必要的 credential 可以在 schema 宣告 optional，再由 sync use case 回傳明確的 `NeedsUserActionError`。

## Connector 與 Worker 邊界

`packages/connectors` 可包含：

- 外部 API client。
- Signing、encryption、protocol parsing。
- Config schema 與 response normalization。
- 不依賴 Worker binding 的 connector。

`apps/worker/src/connectors` 只放需要下列 runtime object 的 adapter：

- `BROWSER`、Puppeteer page 或 browser lifecycle。
- `AI` CAPTCHA recognition。
- Worker-specific session acquisition 或 capacity handling。

Connector 不得依賴 Hono、D1、Worker `Env`，也不得直接寫入資料庫。

所有 Browser adapter 建立新瀏覽器時，統一呼叫
`apps/worker/src/connectors/browser.ts` 的 `launchBrowserWithRetry`，不得直接呼叫
`puppeteer.launch`。共用 adapter 在 binding `fetch` 層僅針對建立瀏覽器的
`POST /v1/devtools/browser` 請求依 HTTP status `503` 判斷重試，不比對錯誤文案。
預設等待 2 秒、5 秒後重試，
最多嘗試 3 次；耗盡後保留原始錯誤，交由既有同步失敗流程處理。結構化 log
只記錄狀態碼、嘗試次數與重試延遲。`429` 額度／限流錯誤不重試；
session 重連、瀏覽器建立後的操作與銀行登入不在此重試範圍內。

建立瀏覽器時遇到 Browser Run 每日額度用完或限流，adapter 應轉成使用者看得懂的
capacity error，不要讓原始 Puppeteer 訊息寫入同步紀錄。新的 adapter 使用
`browser.ts` 的 `launchBrowserOrCapacityError`，它會呼叫 `launchBrowserWithRetry`，
並以 `classifyBrowserCapacityError` 將錯誤轉成 `BrowserCapacityError`；同步 route
會回應 `429 BROWSER_BUSY` 與 `Retry-After`。此類錯誤維持 `failed` 狀態，不視為需要
使用者處理。永豐、台新、華南、第一、凱基仍沿用各自的 capacity error 類別，以保留
前端依錯誤代碼處理驗證碼流程的行為。

## 正規化資料契約

- Connector 回傳 `SyncResult`，資料必須符合 `@taiwan-fin-hub/core`。
- `sourceId` 必須在重複同步間穩定。一般交易不得使用本次同步時間產生 ID。
- `BankBalanceSnapshot.accountId`、`BankTransaction.accountId` 與 `CreditCardBill.accountId` 必須等於對應 `BankAccount.sourceId`。
- 日期使用 ISO 8601；帳單期間使用 `YYYY-MM`；幣別使用大寫代碼。
- `BankTransaction.authorizedAt` 與 `Invoice.invoiceDate`：來源只有日期時使用 `YYYY-MM-DD`；來源確實提供時間時使用含明確時區的 ISO timestamp。不得以補上的午夜或同步時間假造交易時間；台灣來源未標時區的交易時間以 `+08:00` 解讀。
- 補充交易時間時須保留既有 `sourceId` 算法；`postedDate` 維持入帳日期用途。未入帳轉已入帳或重新同步只提供日期時，須保留同筆交易原有的可靠時間。
- 支出與負債為負，退款與入帳為正。
- `raw` 只能保留遮罩或白名單資料，主要功能不得依賴 raw shape。
- 來源明確提供轉帳對方的金融機構代碼與帳號時，填入 `BankTransaction.counterpartyAccount`
  （三碼代碼與帳號末五碼，由 `@taiwan-fin-hub/core` 的 `deriveCounterpartyAccount`／
  `parseBankAccountMemo` 產生），`counterparty` 使用 `formatCounterpartyAccount` 的
  「台北富邦 …66666」格式。完整帳號不得寫入 `counterparty`、`raw` 或 log；
  只有名稱沒有帳號的備註（如「永豐銀行」）不得推測帳號。此欄位不參與 `sourceId`。
- 一般 connector 的資料必須經 `record-mapper.ts` 與 staged persistence；durable-run
  connector 可直接以其 run item table 作為 staging source。資料 promotion 與 cursor
  必須放在同一 guarded D1 batch，secret state 需以設定版本 CAS 保護。

## 路由、排程與 challenge

- 一般同步使用 `runConnectorSync`，不要在 route 或 scheduler 新增 connector switch。電子發票與集保的手動／排程入口使用各自的 durable-run service 啟動 Queue 流程。
- 所有 scope 必須先宣告在 `connectorCatalog`；排程工作目前固定使用 `all`。
- 同一 connector 的所有 scope 共用 canonical lock。
- 需要 CAPTCHA／OTP 時，runtime registry 提供 `prepareChallenge`，route 只處理輸入驗證與 HTTP error mapping。
- 排程不得主動寄送 OTP；需要互動時標記 `needs_user_action`。
- 若外部服務支援接管其他登入中的裝置，必須明確定義手動與排程的 `force` policy，並在介面與使用文件提示可能中斷使用者目前的工作階段。
- 新 connector 必須透過 D1 migration 建立 `<connectorId>:all` sync job，預設停用。

## 測試最低要求

每個 connector 至少需要：

1. Config schema 正常與錯誤案例。
2. 外部 response fixture parser 測試。
3. Stable `sourceId` 與重複同步去重測試。
4. 金額方向、日期與 pending／posted lifecycle 測試。
5. Session 復用、失效、credential change cleanup 測試。
6. OTP／CAPTCHA／rate limit 等 typed error 測試（適用時）。
7. Route manual sync 與 scheduler dispatch 測試。
8. Cursor 不含 secret、encrypted config 不含 public field 的 state boundary 測試。
9. Synthetic self-check，並接入 `test:selfcheck` 或正式 test command。

`apps/worker/tests/features/sync/registry.test.ts` 會檢查 catalog、config schema 與 Worker runtime 是否完整；不得以 type assertion 或 fallback entry 規避。

## 新增流程

1. 在 `connectorCatalog` 加入 ID、mode、scope、capabilities 與欄位分類。
2. 在 `packages/connectors` 建立 config、client、parser 與 config registry entry。
3. 需要 binding 時，在 `apps/worker/src/connectors` 建立 adapter。
4. 在 sync service 實作 normalized result、record mapping 與 staged persistence。
5. 在 Worker runtime registry 註冊 sync／challenge handler。
6. 在前端新增受 `ConnectorFormFieldKey` 約束的表單欄位與必要 challenge UI。
7. 新增 sync job migration。
8. 完成上述最低測試並更新 `README.md` 支援資料來源表。
9. 執行：

```bash
npm run typecheck
npm run test:backend
npm run verify:web
npm run build
```

若新增的是全新資料 entity，還必須同步更新 core contract、D1 migration、`SyncEntityType`、promotion order、entity config、record mapper 與 persistence test。

## 各來源特殊行為

### 電子發票

#### 分段明細同步

電子發票是例外的 durable-run connector，不能使用一般 `runConnectorSync` 的單次
同步流程。`einvoice_sync_runs` 保存 run lifecycle，`einvoice_sync_run_items` 保存
已發現的發票 header 與每張明細的處理狀態；run items 本身也是 promotion 的 durable
staging source。設定儲存、登入 session 與資料 promotion 仍遵守本文件的敏感狀態與
設定版本 CAS 規則。

- 啟動手動或排程同步時只建立／取得 active run 並 enqueue `run-einvoice-chunk`；API
  可以回傳已排入同步，前端必須依 sync job lifecycle 顯示完成結果。
- 初始化只取得清單並 durable 地寫入 item；明細一律同步。每個 Queue invocation 最多
  claim 並擷取 35 張發票，完成狀態以 set-based D1 寫入；若尚有工作便 enqueue continuation，不能在同一 invocation
  繼續處理下一批。
- item claim、run chunk 都必須使用 owner-scoped lease；明細處理期間每五張 rolling renew
  run lease，item 完成／釋放則以 claim token CAS。Queue 重送時只可接管已過期的 run lease
  與 item，且不得解除其他 invocation 的 lease。
- 所有 item `done` 前不得 promotion。完成後由 run items 以固定五個 set-based statements
  一次 promotion invoice 與 line item，並以設定版本 CAS 在同一 batch 更新 cursor；後續
  finalize path 更新 sync job 和排程批次結果。`promoted_at` 必須使重送可冪等。
- 暫時外部錯誤釋放 item claim 並使用 Queue retry；session 過期清除已保存 session 後回到
  初始化；憑證或互動式登入需求則標記 `needs_user_action`，retry 上限後標記 `failed`。

#### 載具資訊

財政部載具表頭查詢（`carrierInvChk`，新版 App 協定 `/einvoice/carriers/query-invoices-header`）
以手機條碼 `3J0002` 查詢時，會一併回傳歸戶在該手機條碼下的所有載具發票；每張發票的 `cardType`
是實際載具類別、`cardNo` 是載具隱碼（財政部 API 規格「載具發票表頭查詢」）。明細查詢
（`carrierInvDetail`）沒有載具欄位。

- 連接器 `invoiceCarrier` 將 `cardType` 存為 `carrierType`，`cardNo` 只取末 4 碼存為 `carrierSuffix`；
  完整隱碼可識別使用者載具，不寫入正規化資料、`raw_payload` 或 log。
- 寫入 `invoices.carrier_type`／`carrier_suffix`（0062）。重寫時新值為 NULL 則保留既有值。
- 0062 之前的 `raw_payload.invoice` 已是正規化後的表頭，沒有載具欄位，無法回填；下次同步（固定最近 2 期）補上。
- 規格公開的查詢卡別只有手機條碼 `3J0002`、悠遊卡 `1K0001`、一卡通 `1H0001`、自然人憑證 `CQ0001`；
  信用卡等其他歸戶載具的類別號碼沒有公開清單，因此不以類別判斷「是信用卡」，而是以
  「類別不在上述非卡片清單，且隱碼末 4 碼等於某張已同步信用卡的末四碼」判定（見 002「發票與刷卡／銀行交易去重」）。
  銀行自訂的隱碼不保證包含卡號末四碼；對不上時退回一般評分配對，不會誤判。
- 「手機條碼歸戶載具查詢」（`qryCarrierAgg`，回傳 `carrierType`、`carrierId2`、`carrierName`）只存在於需要
  財政部核發 appID 的公開 API；本連接器使用的 App 協定沒有對應端點，目前不取得載具名稱。

#### 外幣發票（跨境電商）

境外電商（例如 Cloudflare、Anthropic、OpenAI、AWS、TradingView）開立的發票以原幣計價。明細查詢
（`carrierInvDetail`）的 `detail.currency` 為幣別（例如 `USD`），`detail.amount` 與品項
`detail.details[].amount` 保留小數（`"10.98"`）；表頭與正規化的 `amount`、`invoice_line_items.amount`
則是截斷成整數的原幣（US$10.98 存成 10），不是新台幣。國內發票沒有 `currency`。

- 連接器與同步流程不改：`raw_payload.detail` 原樣保存；0066 以 virtual generated column 推導
  `invoices.currency`（三碼英文字母，其餘為 TWD）與 `invoices.original_amount`（`detail.amount`）。
- 讀取時由 `packages/core` 的 `preciseInvoiceAmount` 決定原幣金額（明細總額有小數優先，含品項外的稅額；
  總額也被截斷時改用品項加總），以系統匯率（`exchange_rates`）換算台幣；外幣發票與刷卡的配對容忍度、
  同一筆消費重複開立的判斷與國外交易服務費的歸屬見 002「發票與刷卡／銀行交易去重」。
- 發票明細 API 的品項 `amount` 仍是 `invoice_line_items` 的整數原幣；需要小數時由 `raw_payload` 取得。

#### 歷史身分整併

Migration `0043_merge_legacy_invoice_duplicates.sql` 以相同發票號碼整併歷史資料，
優先保留新版 UTC ID；同號碼的其他副本會刪除。
缺少的品項明細與人工配對／解除配對設定會移至保留資料；品項或人工設定衝突時
以保留資料為準。此 migration 不改變同步協定或新資料的 ID 產生方式。

### 集保 e 存摺

#### 分段同步

集保與電子發票同樣使用 durable run。手動與排程入口呼叫 `startTdccSyncRun`，
並 enqueue `run-tdcc-chunk`，不以一般單次同步流程取代分段處理。

- `tdcc_sync_runs` 保存 run lifecycle、scope、設定版本及加密認證／session；
  `tdcc_sync_run_items` 保存 `bank_page`、`trade_page` 工作與結果。
- 手動啟動先初始化登入以處理 OTP；排程初始化不主動寄送 OTP。
- 同一 connector 的所有 scope 共用 active run 限制與 canonical lock；每個 chunk
  另取得 owner-scoped run lease，每次最多 claim 一個分頁 item，以 claim token
  更新或釋放該 item，尚有工作時 enqueue continuation。
- 分頁結果完成後彙整，透過一般 staging 與 promotion 寫入金融資料，並檢查設定版本、
  更新 cursor；後續完成排程結果、手動完整同步的報告修復與 run 結案。
- 暫時錯誤交給 Queue retry；需要互動或重試耗盡時終止。不得把每段 run lease 的
  釋放當成整個 connector 同步完成。

詳細流程與檔案責任參考[後端架構](002-backend-architecture.md#集保分段同步)。

#### 多券商持倉

集保 `TR001` 依券商帳戶分組回傳持股；同一證券在不同券商帳戶各為一筆真實持倉，
`sourceId` 含券商代碼與帳號而彼此獨立，不得依代號合併或去重。
`InvestmentPosition` 帶 `brokerNo`／`brokerName`（寫入 `investment_positions.broker_no`／
`broker_name`），前端以券商名稱標示同名持倉；不保存完整券商帳號。

### 國泰世華銀行

存款明細 `B_ACCT_Q_TransferDetail` 的轉出交易以 `expendBankId`／`expendAcctNo` 推導對方帳戶；
轉入交易（及缺少轉出欄位的轉出）解析 `specialMemo` 的「(銀行代碼)帳號；」。
`specialMemo` 為名稱（如電支業者）、帳號全為 0 或欄位空白時不產生對方帳戶。
`raw` 中的 `expendAcctNo` 與 `specialMemo` 以「…末五碼」遮罩；`description`／`memo`
維持原文，因為它們是既有 `sourceId` 的一部分。migration 0051 以相同規則回填既有交易的
對方帳戶欄位與顯示名稱，但不改寫既有 `raw_payload`；舊資料中的完整帳號會在該筆交易
下次同步時被遮罩後的 raw 覆蓋，同步區間以外的舊交易仍保留原 raw。

### 玉山銀行

玉山網銀已改走新版 `/esb/`。登入欄位是 `input[name="id"]`、
`input[name="userName"]`、`input[name="pxssword"]`；重複登入代碼 `9005`
要再送一次「確定登入」。信用卡即時消費與近一年明細來自
`iesc.esunbank.com` 的 `realTime/getDetailResult` 與
`creditLastYear/getFilterResult`，存款明細要先呼叫任務 `home/init` 再查詢。
並非每位使用者都有信用卡或外幣帳戶：同步先呼叫 IESC `common/isCardholder`，
只有成功回傳 `rtnCode: "S"` 且 `credit: false` 時才略過全部信用卡請求，也不建立
信用卡帳戶；請求失敗或其他回應都維持原本的信用卡流程。外幣存款查詢回傳 `S001`
且說明為「查無外幣帳號，或您尚未開立外幣帳戶」時視為沒有外幣帳戶；`S001` 也用於
其他提示頁，說明不符時仍使同步失敗。瀏覽器登入後，刷卡明細頁要同時具備 IESC
`accessToken` 與「未入帳」選單或「尚未持有本行信用卡」提示才算就緒，避免在頁面
自己的初始化請求輪替 token 時送出額外請求。
信用卡 `getCardOverview` 的 `creditCardFeePaid` 為 `true` 時，將本期帳單標為已繳；
否則繳款狀態維持未知。
即時授權與之後入帳必須沿用原本的消費日期、商店、金額與卡片組成 `sourceId`，
授權時間只補在 `authorizedAt`。每筆卡片交易的 `raw.esunFeed` 標記來源為
`realtime` 或 `history`；同名的即時紀錄併入明細並補上時間，不另產生流水號。

即時紀錄常以支付通道命名（如 `LINEPAY*…`），明細則是特店名稱，因此每次同步後
另在 `bank_transactions` 以 `matched_transaction_id` 把未配對的即時授權連到明細：
限同卡、同消費日、同幣別、同金額，不比對名稱，依授權時間與 `sourceId` 順序一對一
分配。明細（未入帳或已入帳）保留正式名稱，只補入授權時間；首次配對時移轉授權的
個別分類、計算偏好與發票關係。已配對關係不重新分配，被連到的明細不再接受其他授權。
沒有 `esunFeed` 的舊資料，以「待入帳且 `authorized_at` 含時間」判定為即時授權。
同日多筆同額消費可能對調刷卡時間，但筆數與金額正確；找不到明細的授權照常顯示。

### 國泰世華銀行

#### 存款明細

存款明細從存款總覽點第一個帳號進入臺幣帳戶明細頁後，其餘帳戶改用頁面上的帳號選單
切換，不要回到存款總覽：在帳戶之間重新開啟總覽，國泰會導向
`/OnlineBanking/Logout/SystemError` 並結束工作階段。帳號與查詢期間都是 react-select
選單，`input[role=combobox]` 的 value 為空，要以外層控制項的文字辨識，並用鍵盤
ArrowDown 開啟選單，選項為 `[id*='-option-']` 元素；帳號選項以完整帳號比對。
進入明細頁時自動送出的 30 天查詢要先等它回應，每個帳戶再自行按「查詢」。
`B_ACCT_Q_TransferDetail` 回應的 `accountNumber` 會補零（例如 12 碼帳號回傳 16 碼），
以結尾比對（前面只能是 0）確認屬於目前帳戶。找不到帳號或期間選項、回應不是 JSON、
帳號不符、查詢逾時或被登出時，整次同步失敗，不以零筆交易繼續。

#### 信用卡總覽與帳戶拆分

信用卡總覽要等「卡片末四碼」出現後再解析，未持卡時等待逾時；固定等待可能在頁面尚未
渲染時誤判為沒有信用卡。總覽頁文字由 `parseCathayCardOverview` 解析：應繳金額優先取
「應繳／未繳金額」，新版版面沒有該標籤時改取「臺幣帳單 TWD …」。

信用卡總覽頁每張卡顯示一組「卡片末四碼」，帳單明細 API
（`C_BILL_Q_RecentBillDetail`）的每筆交易帶 `cardNo`。每張實體卡建立一個
`credit:cathaybk:<末四碼>` 帳戶，名稱為「國泰信用卡 <末四碼>」；卡片集合取總覽頁
與明細卡號的聯集，交易依 `cardNo` 掛到對應卡片；繳款（`PaymentAmount`）與缺少卡號的列掛在餘額帳戶。
信用額度、應繳金額與帳單為所有卡片共用，比照玉山：只有一張實體卡時放在該卡，
多張卡時放在 `credit:cathaybk:main` 摘要帳戶「國泰信用卡」。完整卡號不寫入帳戶名稱、
log 或 `raw`；交易 `raw` 只保留 `cardLast4`。

交易 `sourceId` 沿用拆卡前的算法，仍以 `credit:cathaybk:main` 與原始消費日期字串
組成，不隨所屬卡片改變。因為交易以帳戶加 `sourceId` upsert，拆卡後每次同步會在
promotion 後執行 `reconcileCathayCardAccountStatements`：

- 摘要帳戶中已由實體卡以相同 `sourceId` 取得的交易，併入實體卡並移轉分類、計算偏好與發票關係。
- 只有一張實體卡時，比照玉山把摘要帳戶的快照、帳單與其餘交易併回該卡，並刪除摘要帳戶。
- 多張卡時，超出同步範圍、銀行不再回傳的舊交易留在摘要帳戶，無法推定所屬卡片。

#### 信用卡交易日期與金額方向

信用卡明細只有消費日期（`consumeDate` 固定為 `T00:00:00`），`authorizedAt` 與
`postedDate` 一律寫成 `YYYY-MM-DD`，不補午夜時間。

帳單明細的消費為正數，繳款、退款與回饋等貸項為負數；卡片帳戶一律取相反數，
`PaymentAmount` 區段固定為正數。繳款描述只有「本行自動扣繳」，connector 將
`counterparty` 設為「國泰世華信用卡繳款」，交由系統規則「信用卡繳費」歸為轉帳並排除計算。
存款端的繳款描述為「信用卡款 國泰世華卡 信用卡款」，該規則同時比對「信用卡款」。

既有列的 upsert 會保留同日較精確的時間，且超出同步範圍的舊交易不會再被覆寫，因此
migration `0049_cathay_credit_card_repairs.sql` 一次修正國泰信用卡帳戶的舊資料：
`+08:00` 午夜的 `authorized_at` 與 `T00:00:00` 的 `posted_date` 改回日期、原始金額為負或
屬於繳款區段的負數金額改為正數，並為繳款補上 `counterparty`；`sourceId` 不變。
規則 pattern 僅在仍為預設值時更新。存款明細的 `txnDateTime` 為真實時間，不受影響。

### 永豐銀行

#### 信用卡帳單與餘額

永豐信用卡使用 SinoCard `accounting/accountinginfo` 的 `BillAmounts` 取得各幣別本期帳務，
以 `CURRBAL` 保存應繳總額、`DUEAMT` 保存最低應繳、`TotalPaymentAmt` 保存本期累計已繳款。
餘額快照使用應繳總額扣除同幣別已繳款，最低為零；缺少已繳款金額時不建立該筆快照。
結帳日與繳款期限分別取自 `BaseData.STMTDATE`、`BaseData.DUEDATE`；保留既有台幣歷史帳單查詢。
外幣未列於本期 `BillAmounts` 時，使用銀行本次 `OutstandingDetail.SubTotal` 小計作為未出帳負債快照，
不建立帳單、不填入繳款期限；不得累加本機歷史交易替代本次小計。資產頁對未知信用卡餘額顯示
「金額尚未取得」，相關負債合計顯示「資料不完整」。

#### 授權與明細配對

永豐信用卡取得 `LatestTx.Items` 與 `OutstandingDetail.Detail` 後，在 `bank_transactions`
原表保存授權，以 `matched_transaction_id` 記錄已入帳關係，不另設授權表或停用欄位。
配對僅限同卡、同消費日，不跨日；排除手續費、服務費、不同金額方向與卡片識別不足的資料。
既有相同 sourceId 優先，其次同幣別同金額，再以正規化店名相似度及目前匯率金額接近度
計分；同組採最大總分的一對一分配，無合理候選則不配對。跨幣別不要求人工確認。
已配對關係不重新分配；已入帳保留正式金額、幣別、入帳日與原始 payload，繼承授權時刻。
配對後優先沿用待入帳名稱作為 description 與 counterparty，供顯示、搜尋及規則分類；
空白或預設「永豐信用卡消費」名稱不覆蓋正式名稱。每次同步也修復既有配對，即使銀行
不再回傳該交易；同 ID 入帳沿用已保存名稱。舊版已覆蓋且來源不再提供的名稱無法復原。
在同一 D1 batch upsert 交易、保存配對、補入時刻，並於首次配對移轉原授權的個別分類、
計算偏好（已入帳既有設定優先）及發票關係。原授權與設定持續保存。
活動、搜尋、發票配對候選與收支統計僅排除 `status = 'pending'` 且
`matched_transaction_id IS NOT NULL` 的授權；同 ID 升為已入帳仍正常顯示。
不處理來源消失：未配對授權即使來源不再回傳，仍保留並顯示；空清單不刪除或隱藏資料。
缺少清單或解析失敗不寫入；無有效卡與舊版解析不執行授權配對。
已在舊版永久刪除的授權，若來源不再回傳，無法從此變更復原。

### 台新銀行

- 台新登入後若出現「訊息通知／每三個月變更一次密碼」彈窗，必須點「關閉」後再抓資料。不得點「前往修改」或「3個月後提醒」，也不得停在彈窗卻因為 session API 仍可用而回報同步成功。
- 信用卡資料依頁面載入順序取得：`doXTPA` 摘要與本期 `init` 帳單之後才查 `qryRealTime` 即時消費。`qryRealTime` 連續三次回「系統忙碌」時，以本期帳單參數（`org`、`byear`、`bmonth`、`cardHolderFlagSelected`、`cardNo`）試查 `qryUnposted`；只有回應帶已知的 `fmtRealTxListMap` 格式才採用，否則僅記錄回應欄位名稱與陣列長度（不含值）供實機確認。`qryUnposted` 的實際參數與回應格式尚未經實機驗證。
- 即時消費最終仍取不到時，同步照常寫入已入帳交易與帳單，但 `SyncResult.warnings` 帶上說明；同步工作維持 `success`，警告寫入 `sync_jobs.last_error`，資料來源頁以「上次同步成功，但部分資料未取得」顯示，下一次無警告的成功同步會清除。

#### 即時消費與已入帳明細配對

- 即時消費（`status = 'pending'`）的描述只有 MCC 類別（「餐飲」「百貨公司」「其他交易」等），入帳後才有商家名稱，因此配對不依賴商家名稱。兩邊 raw 可比的欄位只有卡號末四碼、消費日（即時消費另有時分秒）、金額、幣別與交易國別；目前兩個 API 都沒有授權碼。
- `taishinTransactionMatchKind`（`packages/connectors/src/taishin.ts`）：幣別與帶正負號金額必須相同；描述含「國外交易服務費／手續費／服務費」的費用列一律不配。兩邊都有 raw `authorizationCode` 時只看授權碼（相同且消費日差 ≤ 31 天）；否則須同卡末四碼、消費日差 ≤ 3 天，兩邊都有國別時國別也須相同。
- `pairTaishinTransactions` 一對一配對：同卡同日同額同名的多筆先依順序配對，之後依序只接受授權碼、商家名稱相符、最後才是同卡同額日期後備；任一方有兩個以上候選時不配對，避免同額兩筆消費誤合併。
- Parser 在同一次同步中讓入帳明細取代對應的即時消費（即時消費不輸出）；入帳明細保留自己的 `sourceId`（跨同步穩定），同一消費日時沿用即時消費的時分秒。
- Worker 寫入前由 `taishin-lifecycle.ts` 的 `prepareTaishinLifecycleWrite` 以相同規則比對「已存資料＋本次寫入」：本次仍在即時清單但入帳明細已存在的即時消費不寫入；已存的即時消費（即使已不在即時清單）在同一 promotion batch 以 `transaction-merge.ts` 併入入帳明細後刪除，移轉使用者的分類覆寫、計算偏好、經濟角色覆寫與發票連結，並補上即時消費的時間。兩邊使用者設定衝突時不合併，兩筆都保留。
- 超過 14 天仍無對應入帳明細的即時消費照常保留，只在同步 log 記錄數量（`stale_pending`），不影響其他邏輯；不處理即時消費被取消後從清單消失的情況。

### 中國信託銀行

登入 `ot001/010` 回傳 `0131` 且說明為「請更新至最新版本使用」時，代表中信不接受連接器
模擬的 App 登入（看起來帳密已通過，使用者可能收到陌生裝置通知；重試會再觸發通知）。
同步以 `CtbcConnectionError` 提示需等待連接器更新、先不要重試，並只記錄
`ctbc_app_update_required` 事件，不記錄回應內容；其他 `0131` 與非登入請求維持一般
連線失敗訊息。

#### 自動同步現況與網銀半自動匯入

自動同步目前不可用：行動 API 登入回 `0131`（見上段），網銀（`/twrbc/`）則有 F5 Shape
防機器人，會阻擋自動化與無頭瀏覽器。不得以偽裝瀏覽器、隱藏 webdriver、改 UA 等方式繞過。

替代方案是使用者自行登入的半自動匯入：

- Worker `POST /api/connectors/ctbc/import`，body 為 `{ payloads: CtbcPayloads,
depositTransactionsUnavailable?: boolean }`，上限 5 MB；zod 只驗證各回應為物件，
  內容交給 `parseCtbcData`。匯入與手動同步共用 `withManualSyncLock`，因此同樣更新
  `sync_jobs` 的成功時間與警告；`depositTransactionsUnavailable` 會成為同步警告。
- `ctbc-import.ts` 解析後呼叫 `ctbc-write.ts` 的 `writeCtbcSyncData`，與 `syncCtbc`
  共用授權配對、staging promote、`linkCanonicalBankAccountsStatement` 及存款歷史重建；
  匯入不讀寫帳密與 cursor。尚無中信設定列時建立空設定（欄位皆選填），讓資料來源頁顯示
  已設定與上次匯入時間；排程預設停用，不會以空帳密自動登入。解析失敗或沒有任何帳戶時
  回 `CTBC_IMPORT_INVALID`，不寫入資料，錯誤訊息固定、不含原始資料。
- 本機工具 `scripts/ctbc-web-import.mjs`（`npm run ctbc:web-import`）以
  `open -na "Google Chrome"` 開一般 Chrome（暫存 `--user-data-dir`、
  `--remote-debugging-port`），不加任何 automation 旗標，也不啟用 `Runtime` domain。
  它以 CDP `Network.requestWillBeSent` 取得登入後第一個
  `/IB/api/adapters/IB_Adapter/resource/ebmwResource` 請求作為模板（忽略 `ot001` 登入請求，
  不解析其 body），header 只保留 `x-auth-token`、`X-Channel-Id`、`X-Requested-With`、
  `Content-Type`、`Accept`；之後以 `Runtime.evaluate` 在同一頁面內用 XHR 發出請求，
  讓頁面既有的安全機制照常處理。每次只替換 `resource`、`rqData`、`trackingIxd`、
  `txnIxd`、`clientTime`。
- 網銀 resource 與行動版格式相同、前綴為 `twrbc-`：`deposit/qu001/010`、
  `deposit/qu002/010`、`deposit/qu002/011`、`card/qu002/010|011|016`、
  `card/qu006/010|011|015`、`card/qu041/010|015`；`card/qu046/010` 在網銀回 `9991`，
  不呼叫。結束時呼叫 `general/ot002/010` 登出（失敗不影響結果），再關閉 Chrome 並刪除
  暫存 profile。未出帳回應的 `cardInfos`（有未出帳消費的卡與合計）會隨 `allItems` 一起送出。
- 帳單 `card/qu002/010` 的 `billData.<幣別>.<YYYY/MM>` 只有最新一期附 `bills` 明細，其他
  月份只有 `summary`。網銀帳單頁選月份時送 `card/qu002/011` `{curCode, month}`
  （`month` 即 `billData` 的鍵，例如 `2026/08`），分頁為 `card/qu002/016`
  `{curCode, month, pageNum}`（參數取自網銀前端 bundle）。工具對每個幣別最近 3 期中沒有
  明細（或標示分頁但筆數不足）的月份逐月補抓，先試 `YYYY/MM`、再試 `YYYYMM`，只有成功且
  回應含 `bills` 陣列才採用；明細併回 `billData`，`summary` 以首頁既有欄位為準、只補缺少的
  欄位。查不到的月份只保留帳單總額，console 列出月份，不中止匯入。
- 存款明細 `qu002/011` 手動重送時曾回 `H404`，工具依序嘗試：頁面自己送出的查詢參數
  （使用者在網銀開過明細頁時）、`type: m0/m1/m2`、`dateRanges` 的 `YYYYMMDD` 自訂區間、
  同區間 `YYYY/MM/DD`、自行推算的月份區間；每種組合前重新呼叫 `qu002/010`，只有 `0000`
  視為成功，後續帳戶優先使用已成功的組合，`nextKey` 有值時續查。全部失敗時存款交易留空、
  仍匯入餘額與信用卡，並帶 `depositTransactionsUnavailable`。
- Console 只輸出 resource、回應代碼、筆數與匯入結果；不輸出或寫檔帳號、金額、姓名、
  token 或 seed。

中信帳單的消費日、入帳日、結帳日及繳款期限使用 `MMDDYY`；未出帳明細使用
`YYYYMMDD`，金額與商家欄位為 `purchaseAmt`、`description`。`000000` 不代表有效日期。
非零已入帳明細若無法解析日期或金額，整次同步失敗，避免靜默遺漏或寫入無日期交易。

信用卡帳戶依卡片拆分：每張有交易（含待入帳）或未出帳金額的實體卡建立
`credit:ctbc:<末四碼>`（外幣為 `credit:ctbc:<末四碼>:<幣別>`），名稱為卡名；合併帳單、
應繳快照、本行扣繳等不屬於任何實體卡的明細（卡號 `0000`）放在摘要帳戶
`credit:ctbc:main`（外幣為 `credit:ctbc:main:<幣別>`，名稱「中國信託信用卡（合併帳單）」）。
沒有消費的卡不建帳戶，只記在摘要帳戶 `raw.cards`（卡名、末四碼、正附卡、`hasActivity`）
與 `raw.inactiveCardCount`。卡號欄位可能是 `4444_0`（`_0` 為正附卡標記），先去掉底線後綴
再取末四碼。交易 sourceId 沿用拆卡前的 identity，拆卡只改帳戶。migration
`0061_ctbc_credit_card_accounts.sql` 把既有 `credit:ctbc:<幣別>` 的交易依 `raw.cardLast4`
搬到實體卡帳戶（舊未出帳列缺末四碼時，同帳戶只有一張卡才補上該卡），其餘與帳單、快照
搬到摘要帳戶，保留交易 ID 與使用者設定後刪除舊帳戶；卡名由下次同步更新。

配對要求同幣別及同方向金額，且雙向唯一，不比對商家名稱。即時消費授權碼可能帶後綴
（例如 `123456 Y`），未出帳與帳單只有前段，因此取第一段、轉大寫後計算 SHA-256 摘要，
`raw.authorizationHashVersion = 2` 標示為正規化摘要。授權碼相同時消費日可相差最多 31 天
（授權後延後請款，例如 Apple 月費；即時消費時間與帳單消費日也常差一天）；兩個正規化
摘要不同即不配對。沒有可比授權碼時（帳單明細缺授權碼，或舊資料摘要未正規化）才用後備
比對：同一實體卡末四碼、消費日相差不超過 3 天。配對分兩輪，先只用授權碼，再以剩下的列
做後備比對；任一方有多個候選即不配對，不以入帳日代替消費日期，不跨幣別推估。原始授權碼
及交易參考號不寫入 `raw`，只保存摘要。同一次回傳內配對成功時，可見列沿用待入帳 identity
（因此資料庫中的待入帳列會就地升為已入帳），名稱改用已入帳。兩筆已入帳之間只用授權碼
配對，後備比對不會覆寫另一筆已入帳。

中信同步會比對本次資料與已保存的授權。配對成功後可見列為待入帳原列：升為已入帳並
沿用其 ID、消費時間與使用者設定；名稱、入帳日與正式金額改用已入帳明細，再刪除已入帳
重複列。待入帳若已有分類且不是未分類，保留待入帳分類；待入帳未分類則沿用已入帳分類。
計算偏好與發票以待入帳既有設定優先，沒有時才從已入帳補上。先前以
`matched_transaction_id` 隱藏待入帳的舊配對，下次中信同步會改為此合併。
連接器若已在本次回傳中將授權升為已入帳，仍會比對資料庫既有的已入帳副本。
中信正式明細只提供日期；保有授權時刻的已入帳原列也參與雙向唯一配對，
因此下次同步可修復先前漏合併的副本，保留原列 ID、授權時刻及使用者設定。
修正日期前的無日期帳單紀錄，僅在銀行再次回傳且舊 identity 可唯一對應時先修復該列；
若同時有唯一待入帳可配對，仍改以待入帳 ID 為準。無法唯一修復則不寫入本次同步。
銀行已不再回傳的舊明細無法藉此還原日期。同筆交易改由其他明細回傳時仍沿用既有 ID；
待入帳回應不會將已入帳降回待入帳。

### 新光銀行

新光信用卡 `RemainingDue` 回傳 `NA` 時視為欠款金額未提供，仍同步帳戶與歷史帳單，
但不建立本次信用卡餘額快照、不推算已繳金額或繳清狀態。既有快照保留原時間，
不得將 `NA` 當成零；其他無法辨識的欠款文字仍使同步失敗。

### 王道銀行

#### 定存生命週期

王道公開網頁的 [FAO01012 controller](https://www.o-bank.com/ebank/apps/services/www/ibmb/desktopbrowser/default/html/FAO/FAO01012.js) 以 `repeats` 建立完整存單選擇器，再以 `tdAccountNumber` 查詢各筆 `tdDetail`；[頁面欄位](https://www.o-bank.com/ebank/apps/services/www/ibmb/desktopbrowser/default/html/FAO/FAO01012_010.html) 使用 `contractDate`（起息日）與 `maturityDate`（到期日）。連接器沿用清單的帳戶識別碼與餘額，明細只補日期，不保存完整存單號碼。

- 僅完整清單及逐筆明細全部成功後，才撤下未再出現的定存。缺少清單、明細不符或解析不完整時整次同步失敗；明確空陣列可撤下全部舊定存。
- `inactive_at` 是確認來源不再列出存單的時間，不是實際結清日。同期寫入零餘額快照，與狀態變更一同提交；保留之前的餘額歷史。到期日不作為自動結清條件，來源重新列出時恢復有效。
- 成立活動須有銀行起息日及唯一的同幣別活存扣款；本金轉回須有前次有效快照、存單消失與其間唯一的活存本金入帳。同幣別有多個活存帳戶、同額候選不唯一、同日無法判定先後或本金利息合併入帳時，不推算活動。
- 衍生活動以 `transfer_peer_id` 綁定該活存交易，優先一對一配對；定存不參加一般同額配對。本金排除收支，另筆利息保留原有分類及計算。缺少來源日期或交易證據的歷史資料不自動補造。
- 本地 migration 與 fixture 測試不代表真實銀行同步成功；部署 migration 後仍須一次實際同步取得日期與更新有效清單。

### 華南銀行

- 華南登入頁沿用一般導覽：先前 CDP 取樣曾在 1.5 秒內看到 `readyState` 為 `complete`，`USERIDTEXT` 與 `doSubmit` 皆就緒，但遠端 Browser Run 仍可能停在 `chromewebdata/` 錯誤頁。改動登入頁載入方式前必須先以 CDP 取樣確認實際停滯點，不得以推測為依據：`setRequestInterception` 會讓導覽停在 `about:blank`、`setJavaScriptEnabled(false)` 會讓 `waitForFunction`／`evaluate` 失效、`document.write` 移植會摧毀執行環境，三者都已實測不可行。Worker `fetch` 若用於輔助抓取必須設 `AbortSignal.timeout`，否則會在有 proxy 的環境無限等待。導覽的 Puppeteer timeout 外另設 6 秒硬逾時，避免 CDP 操作超時卻持續等待。登入表單或驗證碼沒出現時記導覽狀態及失敗請求的網路錯誤，並立即以連線失敗結束；只有明確的驗證碼錯誤才重試 OCR，不明登入結果不重送帳密。驗證碼準備工作限 35 秒、同步工作限 120 秒，逾時先清理 Browser session 再回報失敗（清理可能另需 15 秒）；Puppeteer 關閉失敗時以 Browser binding 關閉 session。新建的自動同步 session 使用 60 秒閒置期限，準備人工驗證碼則保留 150 秒。
- 華南存款總覽只把純數字（可含連字號／空白）且 10–16 碼的儲存格視為帳號；「帳務總覽」列的查詢時間（如 `2026/09/25 23:15:35`）去除符號後也是 14 碼，不得建成帳戶。餘額欄位可為全形數字或帶 `NT$`／`元`；帳戶列讀不到任何金額時整次同步失敗，不得記成 NT$0。明確的 `0.00` 仍是有效的零餘額。
- 華南分頁必須常駐 dialog 自動關閉 handler。未預期的 `alert` 會凍結頁面 JavaScript 並使自動化停止回應；送出登入時另有 handler 記錄訊息做成敗分類，兩者並存。

### 第一銀行

第一銀行遇到 `MULTI_SESSION_LOGIN` 回覆時，視為目前登入受阻並標記
`needs_user_action`；不將「您已成功登入」文案視為可用 session 的證據，
不點擊該回覆頁的確認、不重送帳密、不重試 OCR，也不歸類為驗證碼錯誤。
既有／人工驗證 session 亦須先檢查此回覆，不能被舊登入標記略過。

第一銀行信用卡切換必須保留頂層網銀 frameset，確認其
`getMenuObjById` 函式可用；遺失時以既有 session 回到 `/NetBank/frame.html`
並等待導覽環境載入，之後只在子頁框開啟功能總覽。
不得把頂層內容頁直接導到 `01.jsp`，也不得直接導到信用卡 bridge 作為 fallback，
以免缺少官方選單／SSO 初始化而落入登出頁。
信用卡入口直接觸發既有 `a[data-func]` 的 click handler，不依賴服務總覽
選單展開或元素可見性，也不改寫銀行表單或自行組裝信用卡請求。
只有入口不存在時重新取得功能頁並最多重試一次；觸發後導覽／context 中斷
則等待原查詢回應，不重複送出。三種預期 API 回應仍須完整取得才算成功；
入口失敗以 `card-entry-*` log 區分，錯誤內容須遮罩。

第一銀行同一帳號同時只能有一個操作中的網路銀行登入。若頁面顯示「已登入導致無法操作」等占用訊息，與上述 `MULTI_SESSION_LOGIN` 回覆不同，同步會先嘗試一次確認／接管；仍無法進入時標記 `needs_user_action`，不得再當成圖形驗證碼失敗而重試 OCR。排程與手動都不強制登出其他裝置上的工作階段。

### 凱基銀行

- 凱基每次同步都需要 6 位數圖形驗證碼。手動與排程同步預設以 Workers AI 自動辨識，每次登入最多嘗試三張新驗證碼；連續失敗時標記 `needs_user_action`。`prepareChallenge` 保留人工 fallback，以 Browser Run 開啟登入頁、填入帳密並回傳驗證碼圖片，同步時接回同一 Browser session 送出。
- 凱基登入頁以 Ionic `ion-img.recaptcha-image` 顯示驗證碼，base64 圖片可能位於 host `src` property 或 Shadow DOM 內的 `<img>`；connector 必須同時支援這兩種位置，並保留舊版一般 `<img>` fallback。
- 凱基新版登入按鈕沒有 `type="submit"`，以 `button.btn.btn-primary.w-100` 識別，並保留舊版 `button[type="submit"]` fallback。按鈕不存在或表單驗證尚未使按鈕啟用時必須停止，不得視為已送出登入。
- 凱基身分證與密碼欄位會在輸入過程動態改成遮罩值，不得以 Puppeteer `type()` 逐字輸入，否則後續字元會寫入遮罩後的文字。必須一次設定完整值並派送單一 `input` / `change` event，再以 Angular `ng-valid` 與登入按鈕狀態確認。
- 凱基同一身分證只允許單一登入。遇到 `connect/token` 回應 `isSSOExsit` 時，手動與排程同步都比照使用者操作確認「繼續登入」，會登出行動銀行 App；同步結束（成功或失敗）都呼叫 `Account/AccountLogout/Logout` 釋放登入。
- 凱基連續三次密碼錯誤會停權。`connect/token` 被拒絕或頁面顯示密碼／代號錯誤時一律標記 `needs_user_action` 並清除驗證狀態，不得重試；只有尚未送出帳密且頁面明確顯示驗證碼錯誤時才視為驗證碼錯誤。
- 凱基資料由登入後頁面自身 API 請求的授權 header（`authorization`、`ocp-apim-subscription-key`、`x-c-*`）於頁面內呼叫 `TwdDemandDepositDetail/AcctQuery` 與 `TxnQuery`；交易 `sourceId` 以帳號、秒精度交易時間、金額與交易後餘額雜湊，不依賴 `recNo`。
