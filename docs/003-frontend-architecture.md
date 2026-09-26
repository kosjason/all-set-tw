# 前端架構

`apps/web` 是 Svelte 5 + Vite 的 client-side application。Worker 提供 `/api` 與建置後的靜態資源；目前不使用 SvelteKit routing。

## 目錄責任

```text
apps/web/src/
├── app/       # composition root、導覽（側欄、手機底部列、更多）、路由與應用層型別
├── data/      # 依 API resource 分組的 query options 與 response DTO
├── features/  # 依使用者功能分組：month、activity（交易）、cards、assets、data-sources、inbox、settings
├── shared/    # 無 feature 所屬的 UI、API client、格式化、state 與 actions
├── testing/   # 跨測試共用的 setup、fixture 與 render helper
├── main.ts
└── styles.css
```

## 相依方向

- `app` 負責組裝 feature 與 shared infrastructure。
- `features` 可以依賴 `data`、`shared` 和純應用層型別，但不應直接依賴其他 feature 的內部元件。
- `data` 可以依賴 `shared/api` 與 `packages/core`，不得依賴 UI feature。
- `shared` 不得依賴 feature；若工具只被一個 feature 使用，應放回該 feature 的 `model` 或 `components`。
  多個頁面共用的呈現元件（例如本月頁與交易頁共用的 `shared/ui/cash-flow-summary`）放在 `shared/ui`，
  由 `data` 提供 view model（`activitySummaryEquation`），元件只接收已算好的值。
- 多個 feature 共用的 API view model 放在 `data`（例如 `data/activity/categories.ts` 的分類顏色與
  排行、`data/activity/roles.ts` 的角色名稱與 override 路徑、`data/assets/summary.ts` 的淨資產計算），
  不要跨 feature import。
- 前後端都使用且穩定的 API contract 應逐步移到 `packages/core`；只用於前端組合畫面的 view model 可留在 `apps/web/src/data`。

## Svelte 檔案

- 頁面入口命名為 `*Page.svelte`，feature 專用子元件放在相鄰的 `components/`。
- 純計算、mapping 和 filtering 放在一般 `.ts`，並以單元測試覆蓋。
- 只有需要在元件外使用 runes 的共享 reactive state 才使用 `.svelte.ts`。
- 全域 reactive state 應保持少量且明確；server state 由 TanStack Svelte Query 管理。

## 測試

- Vitest 單元測試及元件測試與被測檔案 colocate，命名為 `*.test.ts`。
- Playwright browser tests 放在 `apps/web/e2e`，命名為 `*.spec.ts`。Playwright 會自行啟動 Vite（port 4173）；本機沒有安裝 Playwright 內建瀏覽器時，可在 `apps/web` 以 `PLAYWRIGHT_CHANNEL=chrome npx playwright test` 改用已安裝的 Chrome（未設定時維持預設瀏覽器）。
- E2E 以 `page.route` 替身 API：`**/api/**` 也會命中 `src/shared/api/*` 等模組路徑，catch-all handler 須先略過非 `/api/` 開頭的路徑；導覽列固定呼叫的 `/api/inbox`、`/api/cards/summary` 用 `e2e/activity-api.ts` 的 `routeNavigationApi`，活動列表／月收支用 `routeActivityApi`。
- 共用測試初始化放在 `apps/web/src/testing`。

## Imports

跨目錄 import 使用 `@/` 指向 `apps/web/src`；同一小型目錄內可使用相對路徑。避免建立會隱藏 feature 邊界的大型 barrel file。

## 驗證

前端 `typecheck` 使用 `svelte-check --tsgo` 進行 TypeScript 7 型別檢查；
`build` 先執行同一個 `typecheck`，再由 Vite 打包。
TypeScript 7 透過根目錄的 `@typescript/native` npm alias 安裝，
並保留 `svelte-check` 所需的 TypeScript 6 相依。
Vite 資源型別透過 `vite/client` 載入；`.svelte-check` 是不提交的產生檔。

完整前端驗證使用：

```bash
npm run verify:web
```

## 導覽與路由

`app/` 是唯一知道所有頁面的地方。導覽項目定義在 `app/navigation-config.ts`，路由解析在
`app/navigation.ts`，頁面切換、lazy loading 與待處理 badge 在 `App.svelte`：

- 桌面側欄（xl 以上，`AppSidebar`）：頂端「待處理」（`#/inbox`），主導覽「本月（首頁）／交易／
  信用卡／資產／資料來源」，底部「設定」。平板（md–xl）以頂端橫列顯示同一組項目。
- 手機底部列（`MobileTabBar`）：本月｜交易｜信用卡｜資產｜更多；「更多」（`MoreMenu`，`#/more`）
  列出資料來源、待處理與設定。頁首右上另有待處理按鈕。
- 待處理 badge 來自 `GET /api/inbox`（`data/inbox`）：`counts.blocking > 0` 顯示紅點、
  `counts.tidy` 顯示數字（`InboxBadge`）；載入失敗時不顯示。App 本身在
  `QueryClientProvider` 之外，因此直接把 `queryClient` 傳給 `createQuery`。
- 子頁（`detailLabels`）：投資、其他資產、我的其他帳戶掛在資產下，自動整理
  （`#/transactions/rules`）掛在交易下；頁首顯示「← 返回…」，導覽標示上層頁。
- 舊網址由 `resolveViewHash` 導向新位置並保留 hash query（`replaceState`，不增加上一頁）：
  `#/overview`→本月、`#/activity?…`→`#/transactions?…`、`#/settings/data-sources` 與
  `#/exchange-rates`→資料來源、`#/classification-rules`（含 `settings/` 前綴）→自動整理、
  `#/settings/own-accounts`→我的其他帳戶、`#/sync-notifications` 與其他 `#/settings/*`→設定。
  未知路徑回到本月。App 在第一次渲染前就依網址決定頁面，避免先掛載本月頁。
- `navigate(view, { query, connectorId })`：帶 query 時在頁面掛載前以 `replaceState` 換好網址，
  目標頁由網址還原狀態（例如本月頁的分類排行 → `#/transactions?role=spending&category=food`）。

## 本月頁

`features/month/MonthPage` 是首頁，所有收支數字來自 summary API（範圍為最近 6 個月，
以台北月份為準），由上而下：

1. 月份切換（最近 6 個月，非本月時寫入 `#/month?month=`）與資料更新時間（同步工作最近一次成功）。
2. 條件式待處理提示條（`model/month.ts` 的 `pendingBanner`）：收件匣有項目時導向待處理（有
   blocking 時為紅色），否則有待確認交易時導向交易頁 `review=1`，都沒有就不顯示。
3. 收支算式（`shared/ui/cash-flow-summary/CashFlowSummary`，與交易頁總帳共用）：
   「收入 − 消費 ＝ 存下來」，存下來為主數字（負數時改稱「超支」並以 coral 色標示）；下方縮排
   「其中 投資 A ／ 留在帳戶 B」，B ＝ 存下來 − 投資（`activitySummaryEquation`，前端唯一的
   計算），負數顯示「動用存款」。投資不是與收入、消費並列的一格，而是存下來的錢的去向；
   轉到自己帳戶（例如轉到交割帳戶）不算投資。手機直式排列、保留 − ＝ 符號。
4. 卡費提醒：`GET /api/cards/summary` 的 `nextDue` 為未繳或部分繳且 7 天內到期（含逾期）時才出現；
   API 失敗時不顯示。
5. 消費分類排行（水平長條，`data/activity/categories.ts` 的 `buildSpendingCategoryRanking`，每列「emoji 名稱」，
   顏色沿用 `ACTIVITY_CATEGORY_COLOR_BY_ID`；9 個分類沒有子類，不需展開）；點選導向交易頁該分類的消費
   （`role=spending&category=`）。
6. 近 6 個月消費／存下來長條（點選切換月份）。
7. 最近 8 筆交易（去掉已併入其他紀錄的重複項目），主標為商家顯示名稱並列品項與備註，連到交易頁。
8. 淨資產一行（`data/assets/summary.ts` 的 `calculateAssetSummary`，較上月取自資產走勢），連到資產頁。
9. 發票去重摘要：summary 的 `dedupe`（`InvoiceDedupeCounts`）有任何發票時顯示
   「N 張發票已併入刷卡、M 張未對應」，另有等待刷卡入帳或待確認的張數時一併列出
   （`model/dedupe.ts`），點「查看發票」開啟交易頁發票分頁。

「支出高於收入」這類警告卡已移除。原總覽的淨資產與資產走勢在資產頁頂端。

## 交易頁版面與網址狀態

交易頁（`features/activity/ActivityPage`，路由 `#/transactions`；檔案維持在 `features/activity`
以減少與其他分支的衝突）頁首下方是分頁 `TransactionTabs`：

- 總帳（預設）：去重後的列表（`filterTab` 隱藏 `duplicateOf` 的項目，例如已併入刷卡的發票，
  列表標題旁提示筆數），上方為精簡的 `CashFlowSummary`。所有數字只從總帳算。
- 銀行／信用卡／發票：`TransactionSourceList` 只列該來源的原始紀錄（含重複項目），不顯示
  消費合計，改顯示「原始紀錄，不等於消費」。銀行分頁列出帳戶、對方帳戶與角色；信用卡分頁依卡片
  （卡名＋末四碼，`model/source-tabs.ts`）分組並標示未入帳／已入帳與是否已對應發票；發票分頁顯示
  對應狀態（已對應刷卡／已對應銀行或電支／等待刷卡入帳／疑似重複／未對應：伺服器推導的
  `matchStatus` 優先，舊資料由 `duplicateOf` 與 `roleReason` 推導）與前 3 個品項（DTO 有 `itemsPreview` 時
  直接採用，否則列捲到畫面內才以 `GET /api/invoices/:id` 載入）。

sticky 工具列（`ActivityToolbar`）在 lg 以上單列不換行：搜尋（`lg:min-w-60 lg:flex-1`，至少 240px）｜
月份｜角色（全部／消費／收入／投資／轉到自己帳戶／繳卡費／不計入，取代原本的收支）｜只看待確認｜「篩選」｜排序。
分類、只看未分類與搜尋時間範圍收進「篩選」：md 以上為錨定在按鈕下的 popover，手機為底部 sheet。
桌面版（md 以上）總帳為單一表格，表頭 sticky，「日期」「金額」欄標題與工具列共用同一個排序值並輸出
`aria-sort`；分類欄以 `ActivityCategoryCell` 直接改分類（見下方「改分類」）。
手機版為分組列表。分類圓餅與收支趨勢已移到本月頁，交易頁不再有分析欄。

搜尋框輸入即篩選本月，按 Enter 或「搜尋」才查詢所有月份（`pushState` 一筆搜尋紀錄，
清除時以 `history.go` 返回月報；搜尋 API 的 `source` 取自分頁，角色在前端篩選）。分頁、篩選、排序、
月份、搜尋字與搜尋時間範圍由 `features/activity/model/url-state.ts` 寫入 hash query，例如
`#/transactions?month=2026-08&tab=card&role=spending&sort=amount-desc`；預設值不寫入，變更以
`replaceState` 更新目前紀錄。舊參數仍可讀：`source=` 視為分頁、`flow=income|expense` 視為角色
收入／消費、`slice=` 視為分類切片。另外兩個連結參數：

- `activity=<source>:<id>`（收件匣、信用卡頁）：載入該月後直接開啟該筆明細，開啟後從網址移除；
  `bank:<id>` 也涵蓋信用卡交易。
- `card=<末四碼>`（信用卡頁「查看明細」）：切到信用卡分頁並只列該卡。末四碼取交易的 `cardLast4`
  （後端提供時）或帳戶末四碼；多卡共用帳戶（台新）目前 API 沒有逐筆卡號，只能篩到帳戶末四碼。

App 以 `--app-sticky-top` 提供窄螢幕 sticky 頁首高度，交易頁據此把工具列與表頭接在頁首下方。
「只看未分類」與「只看待確認」（`review=1`）在共用篩選後套用，不影響收支數字；被排除計算的活動
仍列出，以淡色與刪除線標示。「自動整理 →」連到 `#/transactions/rules`（目前為原分類規則面板）。

## 活動經濟角色與月收支

月收支數字一律來自後端（見 `docs/002-backend-architecture.md`「活動經濟角色與月收支
summary」），前端不自行加總：

- 月報列表使用 `GET /api/activity/items?month=`（`activityMonthQuery`），每筆帶
  `economicRole`、`reviewStatus`、`duplicateOf` 與 `roleReason`；已配對的發票以重複項目
  回傳（總帳隱藏、發票分頁列出）。搜尋結果同樣帶角色欄位。銀行、發票與發票配對的 range query 仍保留給明細抽屜、
  手動配對與分類規則的相符筆數。
- 收支算式、消費分類排行與趨勢使用 `GET /api/activity/summary?from=&to=`
  （`activitySummaryQuery`，範圍與月份選單同為最近 6 個月，以台北月份為準）。算式為
  「收入 − 消費 ＝ 存下來，其中投資／留在帳戶」（`data/activity/summary.ts` 的
  `activitySummaryEquation`，本月頁與交易頁總帳共用），下方列出未計入的轉到自己帳戶、繳卡費與
  重複發票，以及「N 筆待確認（金額 M）」連結（套用待確認篩選）；`complete = false` 時以中文顯示
  `incompleteReasons`。
- 消費分類排行（本月頁）只用 `spendingByCategory`（顏色沿用 `ACTIVITY_CATEGORY_COLOR_BY_ID`，發票
  key 為 `invoice`），不畫收入。點選分類導向交易頁 `role=spending&category=<id>`；總帳已去重，
  因此列出的活動與排行金額同一口徑。趨勢只畫消費與存下來；投資不是消費、賣出時還可能為負，
  不畫入長條（當月投資見算式的去向）。
- 列表角色標記（`model/roles.ts`、`ActivityRoleBadges`）：消費不標；收入、投資、轉到自己帳戶、
  繳卡費的活動在桌面分類欄改為角色 chip（`ActivityRoleCell`，可直接改角色），手機列以角色
  名稱取代分類，這些活動不顯示「未分類」、也不列入「只看未分類」。被排除計算的轉到自己帳戶
  與繳卡費狀態文字顯示角色名稱。重複的活動淡化並標示「已併入信用卡交易」等；待確認以琥珀色
  標示，角色為消費的待確認活動在列上以 `ActivityRoleSelect` 直接選角色。
- 角色 override：列上或明細抽屜「這筆是…」選擇角色呼叫
  `PUT /api/activity/role-overrides/:targetKind/:targetId`（送 `economicRole`，填了原因時另帶 `note`；
  保留推導的重複關係）；覆寫過的活動可「恢復自動判斷」（`DELETE` 同路徑）。成功後失效 `bank` 開頭的
  query（含 summary、月份活動與搜尋）。明細以 `roleReason` 顯示中文判斷依據；分類為轉帳的
  待確認轉帳提示把對方帳號加到「我的其他帳戶」（`#/own-accounts`，資產下的子頁）。
  角色名稱、可選角色與 override 路徑在 `data/activity/roles.ts`；快速選擇的原生 select 為
  `shared/ui/RoleQuickSelect`（交易列的 `ActivityRoleSelect` 與收件匣共用）。
- 發票列的帳戶欄只顯示「電子發票」（資料沒有載具類型），發票號碼只在明細抽屜顯示。
- 「不計入」（`excluded` 角色：未實際付款、已退款作廢、測試）是 `ECONOMIC_ROLE_CHOICES` 的最後一項，
  選單文字為「不計入（未實際付款、已作廢）」（`ECONOMIC_ROLE_CHOICE_LABELS`）；角色篩選也可選「不計入」。
  `isExcludedActivity`（舊的排除計算或 `excluded` 角色）的列淡化並加刪除線，狀態顯示「不計入」，作廢發票
  （`roleReason = invoice_voided`）顯示「發票已作廢」。收支算式下方未計入那行列出 summary 的
  `excludedAmount`（「不計入 X」）。
- 選擇會影響金額的角色（轉到自己帳戶、不計入、收入：`ECONOMIC_ROLES_ASKING_REASON`）時，列上、明細與
  待確認選單都先開 `RoleReasonDialog`：「原因（選填，會存成備註）」預填目前備註，內容有改動時才隨 override
  送出 `note`，否則只送 `economicRole`。收件匣的快速選擇不詢問原因。

## 商家名稱、品項與分類 chip

列表（桌面表格、手機列、本月頁最近交易）的主標為 `displayName`（使用者別名或清理後的商家名稱，
`data/activity/names.ts` 的 `activityDisplayName`，沒有才用原始 `title`），原始字串移到明細「來源名稱」的
「原始名稱」。發票與已配對發票的交易在名稱下方列 `itemsPreview` 前 3 個品項（「拿鐵、可頌」，
`activityItemsSummary`）。分類只有 9 個消費分類、沒有子類（見 `docs/002-backend-architecture.md`「商家模型與
消費分類」）：`spendingCategoryOptions` 以 core 的分類為準、分類 API 的名稱與 emoji 優先，後面接使用者自訂分類，
收入子類與「未分類」不列入。分類 chip 與明細的選單都是單層原生 select，選項為「🍜 餐飲」；目前分類不在選單內
（未分類、收入子類）時以停用選項顯示。`categorySource = auto_suggestion` 時 chip 旁以淡色小字標「自動」。

## 改分類

列上的分類 chip（`ActivityCategoryCell`）與明細抽屜「活動設定 › 分類」選擇新分類後直接呼叫
`POST /api/activity/categorize`（`categorizeActivitiesMutation`，`applyToMerchant: false`，寫入個別覆寫），
不再經過確認對話框。可改分類的活動由 `features/activity/model/categorize.ts` 的 `categorizeTarget` 決定：
銀行／信用卡交易寫到交易本身；未配對的發票（現金、電支付款的發票永遠配不到交易）寫到發票本身；
已併入交易的發票（重複項目，在發票分頁與明細可見）寫到它併入的那筆交易——發票重複項目沿用交易的
最終分類、交易的個別覆寫優先，因此兩邊不會出現不同分類。投資交易明細不能改。

成功後失效 `bank` 開頭的 query（列表、summary、收件匣）。活動有 `merchantKey`（發票為 `ban:<統編>`）時，
畫面下方出現一行詢問（`MerchantCategoryPrompt`）：「將『{顯示名稱}』的其他 N 筆也設為「X」，並記住這個
商家？」，N 為目前月份同 `merchantKey`、非重複且不是使用者個別覆寫（`categorySource = user`）的筆數
（`merchantSiblingCount`）；N 為 0 時改問是否記住商家。「套用並記住」再呼叫一次 categorize 帶
`applyToMerchant: true`（寫入商家規則，回溯套用到該商家所有活動），「只改這筆」關閉詢問。

## 活動備註

明細抽屜在標題區塊下方有「備註」（`features/activity/components/ActivityNoteField`）：多行輸入、最多 1000 字
（`ACTIVITY_NOTE_MAX_LENGTH`），停止輸入 800ms 或失焦時自動儲存並顯示「已儲存」，清空即刪除，關閉抽屜時
送出尚未儲存的修改；輸入期間不被重新載入的資料覆寫。寫入目標由 `data/activity/roles.ts` 的
`activityNoteTarget` 決定：已配對的交易與發票共用備註，備註已存在另一方（`noteTarget`）時寫到那一筆並標示
「與配對的交易／發票共用」，否則寫到活動自身。儲存用 `PUT /api/activity/notes/:targetKind/:targetId`，清空用
`DELETE`（404 視為已刪除），成功後失效 `bank` 開頭的 query。桌面表格、手機列表與本月頁最近交易在名稱下方以
一行「📝 備註」（截斷，完整內容在 `title`）顯示；搜尋比對備註（後端 `activitySearchHaystack`），搜尋框的提示
註明可搜尋備註。

## 明細的發票與交易資料

交易頁的銀行、發票與發票配對 range query（`bankRangeQuery`、`invoicesRangeQuery`、
`invoiceTransactionMappingsQuery`）的 `data` 只在開明細、手動配對時才被惰性的 `$derived` 讀到。TanStack Query
預設只在「讀過的欄位」變動時通知，載入完成前沒讀過 `data` 的話之後會一直讀到 `undefined`（點開明細看不到
發票區塊與配對入口），因此這三個 query 設 `notifyOnChangeProps: "all"`。明細的發票另以 `loadedInvoice` 取得：
先找發票清單，找不到時用明細自己依 id 查詢的 `GET /api/invoices/:id`（`InvoiceRow` 含清單欄位），讓收件匣、
信用卡頁以 `activity=invoice:<id>` 深連結開啟、或清單載入較慢時也能顯示發票。

## 活動時間顯示

已配對發票的信用卡與銀行活動一律優先使用發票含時區的時間；發票沒有時刻時，沿用原交易時間。
此規則由共用活動資料組裝套用於列表、詳情與搜尋排序，解除配對後恢復銀行日期。
只提供日期的發票不補時刻，也不回寫銀行原始交易資料。

## 發票配對

`packages/core` 的 `matchInvoicesToTransactions` 為後端活動列表與月收支、搜尋、同步明細
及前端手動配對候選共用的配對規則；未配對發票列為支出，已配對發票不重複計算（月報列表
以 `duplicateOf` 淡化列出）。依序套用，前一步配對的資料不再參與：

1. 手動連結優先；「解除並保持分開」的發票不自動配對。
2. 同一台北日、同金額的 TWD 支出（沿用既有行為，同組多筆依 id 一對一）。
3. 前後 3 天內同金額的 TWD 負數支出，雙方都只有唯一候選才配對；由相差 0 天逐日放寬到
   3 天，同一距離出現兩個候選即保持未配對，因此較近的日期優先。
4. 國外商家：前後 3 天內的信用卡負數支出，金額差不超過發票的 5%（至少 NT$30），且發票
   賣方與交易描述有相同英數品牌字詞（去除 LLC、Inc 等字尾；少數等價品牌如
   Valve↔Steam、Anthropic↔Claude 以別名表處理），同樣須雙向唯一。

電子支付儲值（系統規則 `system:bank:ewallet-topup`）視為轉入自己的電子錢包，經濟角色為
`own_transfer` 並排除收支，也不作為任何發票的自動配對對象；錢包內的消費以發票計入。步驟 3、4 也略過已
排除收支的交易與退款。手動配對候選列出前後 3 天內的 TWD 支出，依金額差、日期差排序。
活動搜尋結果只含命中日期，前後端都以同日配對計算。

## 活動金額顯示

交易頁手機列表、桌面列表與詳情統一以台幣顯示；外幣交易沿用分類圖表的目前匯率，
標示「約」並保留原幣副標示，詳情列出匯率與更新時間。資料庫原始金額與幣別不變，
不以待入帳授權金額替代外幣入帳金額。缺少匯率時列上顯示無法換算；月收支由後端以
`exchange_rates` 換算，缺匯率的幣別列在摘要列的「資料不完整」原因中。零金額不需匯率
即可計為 0。
隱藏金額同時遮蔽台幣與原幣。

外幣電子發票（跨境電商）的 `amount`／`currency` 是原幣（例如 USD 10.98），另帶後端換算的 `amountTwd`；
已配對外幣發票的刷卡項目以換算值填 `invoiceAmount`，並帶 `invoiceCurrency`／`invoiceOriginalAmount`。
明細的發票總額與手動配對對話框以 `invoiceAmountText` 顯示「US$10.98（≈NT$356）」（缺換算值時只顯示原幣），
發票品項以 `formatCurrencyPrecise`（外幣保留 2 位小數）顯示；外幣發票與刷卡的金額差來自匯率，不標示
「點數折抵」也不顯示配對差額。國外交易服務費（`foreignFeeOf`）在列上與明細標示「屬於 ○○ 的國外交易服務費」
（`foreignFeeLabel`，○○ 為已載入的原消費），分類沿用該筆消費。重複開立的外幣發票（`roleReason = invoice_repeat`）
在明細說明「同一筆消費可能重複開立發票」。

## 轉帳對方帳戶

來源可辨識轉帳對方時，API 交易列提供 `counterpartyBankCode` 與帳號末五碼
`counterpartyAccountSuffix`，不含完整帳號。共用活動資料組裝以 `counterpartyAccountLabel`
產生「→ 台北富邦 …66666」（轉出）或「← 永豐 …88888」（轉入），列表在說明下方以次要文字
顯示，詳情於來源名稱區塊列出「對方帳戶」；此時「銀行／信用卡原始名稱」仍以交易說明為主。

## 我的其他帳戶

資產頁的「我的其他帳戶」（`own-accounts` view，`features/assets/OwnAccountsPage`）由
`OwnAccountsPanel` 管理登記的帳戶；表單驗證集中在 `features/assets/model/own-account-form.ts`，只送出三碼代碼與末 4–5 碼，
輸入超過 5 碼時直接拒絕而非截斷，避免使用者以為完整帳號會被保存。儲存或刪除後
同時失效 `own-accounts` 與 `bank` 查詢，讓活動與收支依新設定重新判定。
API 交易列帶有 `ownAccount`（`kind`、名稱）時，共用活動資料組裝產生
`ownAccountTransfer` 標記：自有帳戶顯示「轉到自己的帳戶」／「來自自己的帳戶」，
未同步卡片顯示「未同步的卡片」；活動帶有經濟角色時，「轉到自己的帳戶」改由角色標記
呈現，列上只保留「未同步的卡片」標記。詳情的「排除統計計算」說明提示可取消勾選改為計入。

## 資料來源頁

`features/data-sources/DataSourcesPage` 由上而下為：資料健康度（已設定來源中正常的比例與最近
成功時間）、來源卡片（桌面為 `SourceCard` 清單＋`ConnectorPanel` 詳情兩欄，手機為可展開卡片；
`#/data-sources?connector=<id>` 或 `navigate(…, { connectorId })` 預先展開該連接器）、同步排程
（`DefaultSchedulePanel`）、最近一次排程同步（`LatestSyncReportCard`）與參考匯率（`ExchangeRatesPanel`）。
這些元件原本位於設定頁與總覽，現在都在 `features/data-sources/`。設定頁（`features/settings`）只剩
通知（`NotificationPanel`）與介面偏好（隱藏金額；顯示幣別固定為新台幣）。

### 同步明細

`LatestSyncReportCard` 顯示「最近一次排程同步」，展開「查看各資料來源」後直接列出各來源本次活動。
`SyncActivityDetails` 展示該次同步的活動名稱、標記與原幣金額；來源區塊展開時以一次
`GET /api/sync-reports/:batchId/activities` 載入全部來源明細並支援重試。
明細展示新增活動、已入帳、補上發票及原幣金額，沿用全域隱藏金額設定。
日期是活動發生日期，同步時間另列；已配對發票合併顯示，活動筆數不等同新增資料筆數。
舊報告沒有明細時明確說明，不顯示成「沒有變動」。

## 待處理頁

`features/inbox/InboxPage`（`#/inbox`）讀 `GET /api/inbox`，分成「需要處理」（blocking：同步失敗、
需要驗證、中信久未匯入、卡費將到期未繳）與「待整理」（tidy：待確認角色、發票配對歧義、未分類彙總）
兩組，保留 API 排序。每項顯示標題、說明、金額與筆數；按鈕文字取 `action.label`，導向由
`model/inbox.ts` 的 `inboxNavigation` 把 `target`（可能是舊路由名稱，例如 `activity`）經
`resolveViewHash` 換成目前頁面與 query。`needs_review` 項目可直接在列上以 `RoleQuickSelect` 選角色
（`activity=<source>:<id>` → 角色 override API），成功後失效 `bank` 開頭的 query（收件匣、月收支與
交易一起重新整理）。`unavailable` 有值時提示清單可能不完整。

## 信用卡頁

`features/cards/` 的 `CardsPage` 由上而下為：`CardsDueHero`（本期總應繳、尚未繳、未出帳累計與
最近未繳清截止日倒數；未繳清且 7 天內到期或已逾期時以警示色與 `role="alert"` 醒目顯示）、
依發卡行分組的 `IssuerBillRow`（狀態、推估標示、應繳與截止日；展開後列出已繳／尚需繳、本期繳款、
各卡未出帳與交易頁連結，以及資料來源與更新時間），以及 `BillHistory`（選定發卡行的近 12 期帳單）。
桌面版（lg 以上）帳單列與帳單歷史左右並排，帳單歷史 sticky；手機版依序堆疊，帳單列只顯示金額與倒數，
細節收在展開區。

倒數、醒目條件、狀態與推估文字、交易頁連結集中在 `features/cards/model/cards.ts`。「查看明細」
連到交易頁信用卡分頁並依卡片末四碼篩選（`#/transactions?tab=card&card=<末四碼>`，沒有末四碼時只開
信用卡分頁）；交易頁以月份瀏覽，未出帳起日早於本月時上個月的部分要切換月份查看。信用卡是主導覽
項目（`#/cards`，可帶 `?issuer=<connectorId>` 預設展開並選取該發卡行）。資料查詢在 `data/cards/`；收件匣的型別與 query options 在 `data/inbox/`，
兩者的 query key 以 `bank` 開頭，隨交易、分類與同步相關的失效一起重新整理。
