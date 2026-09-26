<script lang="ts">
  import {
    CATEGORY_DEFINITIONS,
    type EconomicRole,
  } from "@taiwan-fin-hub/core";
  import { onMount, tick } from "svelte";
  import { toStore } from "svelte/store";
  import {
    createMutation,
    createInfiniteQuery,
    createQuery,
    keepPreviousData,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { Check } from "@lucide/svelte";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import {
    activityMonthQuery,
    activitySearchQuery,
    activitySummaryQuery,
  } from "@/data/activity/queries";
  import {
    activitySummaryEquation,
    activitySummaryExcludedParts,
    activitySummaryIncompleteLabels,
  } from "@/data/activity/summary";
  import type { Navigate } from "@/app/types";
  import CashFlowSummary from "@/shared/ui/cash-flow-summary/CashFlowSummary.svelte";
  import ActivitySearchHeader from "./components/ActivitySearchHeader.svelte";
  import ActivityDataAlerts from "./components/ActivityDataAlerts.svelte";
  import ActivityToolbar from "./components/ActivityToolbar.svelte";
  import SpendingCategoryPie from "./components/SpendingCategoryPie.svelte";
  import ActivityList from "./components/ActivityList.svelte";
  import TransactionSourceList from "./components/TransactionSourceList.svelte";
  import TransactionTabs from "./components/TransactionTabs.svelte";
  import ActivityDetailPanel from "./components/ActivityDetailPanel.svelte";
  import ActivityInvoiceMappingDialog from "./components/ActivityInvoiceMappingDialog.svelte";
  import CalculationUpdateDialog from "./components/CalculationUpdateDialog.svelte";
  import MerchantCategoryPrompt from "./components/MerchantCategoryPrompt.svelte";
  import RoleReasonDialog from "./components/RoleReasonDialog.svelte";
  import {
    categorizeActivitiesMutation,
    deleteActivityNoteMutation,
    saveActivityNoteMutation,
  } from "@/data/activity/mutations";
  import {
    categorizeRequest,
    merchantPromptText,
    merchantSiblingCount,
  } from "./model/categorize";
  import { ApiRequestError } from "@/shared/api/client";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { exchangeRatesQuery } from "@/data/assets/queries";
  import { bankRangeQuery } from "@/data/bank/queries";
  import type { BankData, BankTransactionRow } from "@/data/bank/types";
  import { classificationCategoriesQuery } from "@/data/classification/queries";
  import { buildSpendingCategoryRanking } from "@/data/activity/categories";
  import {
    categoryOptionText,
    spendingCategoryOptions,
  } from "@/data/activity/categories";
  import {
    invoiceDetailQuery,
    invoiceTransactionMappingsQuery,
    invoicesRangeQuery,
  } from "@/data/invoices/queries";
  import type {
    InvoiceSummaryRow,
    InvoiceTransactionPreference,
  } from "@/data/invoices/types";
  import type {
    ActivityItem,
    CalculationUpdateInput,
    PendingCalculationUpdate,
  } from "./model/types";
  import { activityDateKey, currentActivityMonthKey } from "./model/list";
  import { filterActivities } from "./model/filter";
  import {
    deduplicateBankTransactions,
    invoiceTransactionCandidates,
    matchInvoicesToTransactions,
  } from "@/data/activity/matching";
  import { getActivityDataStatus } from "./model/load-status";
  import { activityInvoiceTwd, foreignFeeLabel } from "./model/labels";
  import { buildActivityListView } from "./model/sort";
  import {
    ECONOMIC_ROLE_CHOICE_LABELS,
    ECONOMIC_ROLE_LABELS,
    ECONOMIC_ROLES_ASKING_REASON,
    activityNoteTarget,
    activityRoleTarget,
    duplicateTargetLabel,
    findDuplicateTarget,
    roleOverridePath,
  } from "./model/roles";
  import {
    activityHash,
    defaultActivityViewState,
    parseActivityHash,
    type ActivityTarget,
    type ActivityViewState,
  } from "./model/url-state";
  import { cardIdentity, transactionCardLast4 } from "./model/source-tabs";
  import {
    ACTIVITY_EXTRA_CATEGORY_OPTIONS,
    UNCATEGORIZED_CATEGORY_ID,
    activityFilterChips,
    clearActivityFilter,
    clearActivityFilters,
    filterCard,
    filterCategorySlice,
    filterNeedsReview,
    filterRole,
    filterTab,
    filterUncategorized,
    TRANSACTION_TAB_LABELS,
    type ActivityFilterChipKey,
  } from "./model/view-filters";
  import { rateMap } from "@/shared/format/financial";
  import { recentMonthRange, recentMonthKeys } from "@/shared/date-range";
  let { api, navigate }: { api: ApiClient; navigate?: Navigate } = $props();
  const initialSelectedMonth = currentActivityMonthKey();
  // Keep API ranges and month options anchored to the same Taipei month key.
  const activityMonthAnchor = new Date(
    `${initialSelectedMonth}-15T12:00:00+08:00`,
  );
  const activityRange = recentMonthRange(6, activityMonthAnchor);
  const cashFlowMonths = recentMonthKeys(6, activityMonthAnchor);
  const months = [...cashFlowMonths].reverse();
  // 這三個 query 的 data 只在開明細、配對時才讀（$derived 是惰性的）。TanStack Query 預設只在
  // 「讀過的欄位」變動時通知，若載入完成前沒有人讀過 data，之後讀到的會一直是 undefined
  // （明細看不到發票與交易）。改為任何欄位變動都通知。
  const bank = createQuery({
    ...bankRangeQuery(() => api, activityRange),
    notifyOnChangeProps: "all",
  });
  const invoices = createQuery({
    ...invoicesRangeQuery(() => api, activityRange),
    notifyOnChangeProps: "all",
  });
  const invoiceMappings = createQuery({
    ...invoiceTransactionMappingsQuery(() => api),
    notifyOnChangeProps: "all",
  });
  // 月收支數字（總帳摘要）一律來自 summary API；前端不自行加總。
  const summaries = createQuery(
    activitySummaryQuery(() => api, {
      from: cashFlowMonths[0]!,
      to: cashFlowMonths.at(-1)!,
    }),
  );
  const rates = createQuery(exchangeRatesQuery(() => api));
  const categoryRows = createQuery(classificationCategoriesQuery(() => api));
  const qc = useQueryClient();

  // 分頁、篩選、排序、月份與搜尋狀態：與 `#/transactions?…` 雙向同步。
  const initialView =
    parseActivityHash(window.location.hash) ?? defaultActivityViewState();
  let view = $state<ActivityViewState>(initialView);
  // 搜尋框文字：月報模式輸入即篩選本月；送出後才成為全歷史搜尋（view.query）。
  let search = $state(initialView.query);
  const selectedMonth = $derived(
    months.includes(view.month) ? view.month : initialSelectedMonth,
  );
  // 月報列表：含推導角色，已配對的發票以 duplicateOf 列為獨立的重複項目。
  const monthItems = createQuery(
    toStore(() => ({
      ...activityMonthQuery(() => api, selectedMonth),
      placeholderData: keepPreviousData,
    })),
  );
  const searching = $derived(Boolean(view.query));
  const submittedSearch = $derived(view.query);
  const monthlySearch = $derived(searching ? "" : search);
  const searchDates = $derived.by(() => {
    if (view.time === "custom") return { from: view.from, to: view.to };
    if (view.time === "year")
      return {
        from: `${initialSelectedMonth.slice(0, 4)}-01-01`,
        to: `${initialSelectedMonth.slice(0, 4)}-12-31`,
      };
    if (view.time === "12months") {
      const date = new Date(activityMonthAnchor);
      date.setMonth(date.getMonth() - 11);
      return {
        from: `${currentActivityMonthKey(date)}-01`,
        to: activityDateKey({
          date: new Date().toISOString(),
          dateHasTime: true,
          source: "bank",
        }),
      };
    }
    return { from: "", to: "" };
  });
  const invalidSearchDates = $derived(
    Boolean(
      searchDates.from && searchDates.to && searchDates.from > searchDates.to,
    ),
  );
  const searchResults = createInfiniteQuery(
    toStore(() =>
      activitySearchQuery(
        () => api,
        submittedSearch,
        searchDates.from,
        searchDates.to,
        view.tab === "ledger" ? "all" : view.tab,
        // 角色在前端篩選（伺服器的 flow 只依正負，會漏掉退款等消費）。
        "all",
        view.categoryId,
      ),
    ),
  );
  // Adjacent result pages can share a day and therefore repeat matching context.
  function uniqueRows<T extends { id: string }>(rows: T[]): T[] {
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }
  const bankData = $derived(
    searching
      ? {
          accounts: $searchResults.data?.pages[0]?.bank.accounts ?? [],
          transactions: uniqueRows(
            $searchResults.data?.pages.flatMap(
              (page) => page.bank.transactions,
            ) ?? [],
          ),
        }
      : $bank.data,
  );
  const invoiceData = $derived(
    searching
      ? uniqueRows(
          $searchResults.data?.pages.flatMap((page) => page.invoices) ?? [],
        )
      : $invoices.data,
  );

  /** 更新檢視狀態；改角色時一併清除舊版圖表網址帶入的分類切片。 */
  function setView(patch: Partial<ActivityViewState>) {
    const next = { ...view, ...patch };
    if (patch.role !== undefined && patch.slice === undefined)
      next.slice = null;
    view = next;
  }

  // 月報與搜尋間切換時保留月報的捲動位置。
  let savedMonthlyScroll: { scroll: number; rootScroll: number } | null = null;
  function saveMonthlyScroll() {
    savedMonthlyScroll = {
      scroll: window.scrollY,
      rootScroll: document.getElementById("root")?.scrollTop ?? 0,
    };
  }
  function restoreMonthlyScroll() {
    const saved = savedMonthlyScroll;
    savedMonthlyScroll = null;
    if (!saved) return;
    void tick().then(() => {
      window.scrollTo({ top: saved.scroll, behavior: "instant" });
      document
        .getElementById("root")
        ?.scrollTo({ top: saved.rootScroll, behavior: "instant" });
    });
  }

  // history.go 返回期間暫停寫入網址，避免覆寫即將離開的搜尋紀錄。
  let urlSyncPaused = false;
  $effect(() => {
    const hash = activityHash(
      { ...view, month: selectedMonth },
      initialSelectedMonth,
    );
    if (urlSyncPaused || !parseActivityHash(window.location.hash)) return;
    if (window.location.hash === hash) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  });

  /** 由網址與 history.state 還原（首次載入、上一頁／下一頁、導覽回活動頁）。 */
  function restoreHistory() {
    const parsed = parseActivityHash(window.location.hash);
    if (!parsed) return;
    urlSyncPaused = false;
    const state = window.history.state;
    const query = parsed.query || state?.activitySearch?.query || "";
    const wasSearching = searching;
    if (query && !wasSearching) saveMonthlyScroll();
    view = { ...parsed, query };
    if (query) search = query;
    else if (wasSearching) search = "";
    detailKey = state?.activityDetail ?? null;
    if (!query && wasSearching) restoreMonthlyScroll();
  }

  function submitSearch() {
    const query = search.trim();
    if (!query) {
      clearSearch();
      return;
    }
    if (!searching) {
      saveMonthlyScroll();
      window.history.pushState(
        { ...window.history.state, activitySearch: { query } },
        "",
      );
      // 全歷史搜尋從不篩選開始；月報的篩選保留在上一筆歷史紀錄的網址。
      view = { ...clearActivityFilters(view), query };
    } else {
      window.history.replaceState(
        { ...window.history.state, activitySearch: { query } },
        "",
      );
      view = { ...view, query };
    }
  }
  function clearSearch() {
    if (!searching) {
      search = "";
      return;
    }
    if (window.history.state?.activitySearch) {
      urlSyncPaused = true;
      window.history.go(detailKey ? -2 : -1);
      // popstate 會還原月報；保險起見，逾時仍未收到就依目前網址還原。
      window.setTimeout(() => {
        if (urlSyncPaused) restoreHistory();
      }, 1000);
      return;
    }
    // 由分享連結直接開啟的搜尋沒有可返回的紀錄，改在原地回到月報。
    search = "";
    detailKey = null;
    view = { ...clearActivityFilters(view), query: "" };
    restoreMonthlyScroll();
  }
  function changeSearch(value: string) {
    search = value;
    if (!value.trim()) clearSearch();
  }
  function closeDetail() {
    if (window.history.state?.activityDetail) window.history.back();
    else detailKey = null;
  }
  onMount(() => {
    restoreHistory();
    window.addEventListener("popstate", restoreHistory);
    return () => {
      window.removeEventListener("popstate", restoreHistory);
    };
  });
  let pendingCalculation = $state<PendingCalculationUpdate | null>(null);
  let mappingDialog = $state<{
    invoice: InvoiceSummaryRow;
    step: "candidates" | "confirm" | "actions";
    transactionId?: string;
    amountTwd?: number | null;
  } | null>(null);
  let mappingNotice = $state("");
  let detailKey = $state<string | null>(null);
  // 分類選單：單層的 8 個消費分類（emoji＋名稱）與自訂分類；分類 API 還沒回來或
  // 失敗時直接用 packages/core 的分類。
  const categoryOptions = $derived(
    spendingCategoryOptions($categoryRows.data ?? []),
  );
  // 排除計算對話框需要能保留「未分類」。
  const calculationCategoryOptions = $derived([
    ...categoryOptions.map((option) => ({
      id: option.id,
      label: categoryOptionText(option),
    })),
    { id: UNCATEGORIZED_CATEGORY_ID, label: "未分類" },
  ]);
  const activityDataStatus = $derived(
    getActivityDataStatus(
      searching
        ? [
            { label: "搜尋結果", isError: $searchResults.isError },
            { label: "發票配對", isError: $invoiceMappings.isError },
          ]
        : [
            { label: "活動", isError: $monthItems.isError },
            { label: "月收支摘要", isError: $summaries.isError },
            { label: "銀行與信用卡明細", isError: $bank.isError },
            { label: "發票", isError: $invoices.isError },
            { label: "發票配對", isError: $invoiceMappings.isError },
          ],
    ),
  );
  const activityRetryPending = $derived(
    $searchResults.isFetching ||
      $monthItems.isFetching ||
      $summaries.isFetching ||
      $bank.isFetching ||
      $invoices.isFetching ||
      $invoiceMappings.isFetching,
  );
  const categories = $derived({
    ...Object.fromEntries(
      CATEGORY_DEFINITIONS.map((category) => [category.id, category.label]),
    ),
    ...Object.fromEntries(
      categoryOptions.map((category) => [category.id, category.label]),
    ),
  } as Record<string, string>);
  const rateValues = $derived(rateMap($rates.data));
  const bankAccounts = $derived(
    new Map((bankData?.accounts ?? []).map((account) => [account.id, account])),
  );
  const activityBankTransactions = $derived(
    deduplicateBankTransactions(
      (bankData?.transactions ?? []).map((transaction) => ({
        ...transaction,
        accountType:
          transaction.accountType ??
          bankAccounts.get(transaction.accountId)?.accountType,
      })),
    ),
  );
  const invoiceMatches = $derived(
    matchInvoicesToTransactions(
      activityBankTransactions,
      invoiceData ?? [],
      $invoiceMappings.data ?? [],
      // Search pages hold only matching days, like the server search matching.
      searching ? { dayWindow: 0 } : undefined,
    ),
  );
  const rawItems = $derived(
    searching
      ? ($searchResults.data?.pages.flatMap((page) => page.items) ?? [])
      : ($monthItems.data?.items ?? []),
  );
  const detailItem = $derived(
    rawItems.find((item) => activityKey(item) === detailKey),
  );
  const detailInvoiceId = $derived(detailItem?.invoiceId ?? null);
  // 明細的發票：先找已載入的發票清單，找不到時用明細自己依 id 查詢的發票
  // （`GET /api/invoices/:id`，InvoiceRow 含清單欄位）。深連結直接開啟明細、網路較慢，
  // 或發票清單的 query 還沒通知更新時，明細仍能顯示發票與配對入口。
  function loadedInvoice(invoiceId: string | null | undefined) {
    if (!invoiceId) return undefined;
    return (
      (invoiceData ?? []).find((invoice) => invoice.id === invoiceId) ??
      ($detailInvoice.data?.id === invoiceId ? $detailInvoice.data : undefined)
    );
  }
  const detailInvoiceRow = $derived(loadedInvoice(detailInvoiceId));
  const detailInvoice = createQuery(
    toStore(() => invoiceDetailQuery(() => api, detailInvoiceId)),
  );
  const selectedSummary = $derived(
    $summaries.data?.months.find((month) => month.month === selectedMonth) ??
      ($monthItems.data?.month === selectedMonth
        ? $monthItems.data.summary
        : undefined),
  );
  const spendingSlices = $derived(
    buildSpendingCategoryRanking(
      selectedSummary?.spendingByCategory ?? {},
      $categoryRows.data ?? [],
    ),
  );
  function selectPieCategory(categoryId: string) {
    setView(
      view.categoryId === categoryId
        ? { categoryId: "" }
        : { categoryId, role: "spending" },
    );
  }
  const summaryUnavailable = $derived(!selectedSummary);
  const selectedMonthLabel = $derived(`${Number(selectedMonth.slice(5))} 月`);
  const transactionsById = $derived(
    new Map(
      activityBankTransactions.map((transaction) => [
        transaction.id,
        transaction,
      ]),
    ),
  );
  function transactionOf(item: ActivityItem) {
    return item.transactionId
      ? transactionsById.get(item.transactionId)
      : undefined;
  }
  const filtered = $derived(
    filterNeedsReview(
      filterUncategorized(
        filterCard(
          filterRole(
            filterCategorySlice(
              filterTab(
                filterActivities(rawItems, {
                  month: searching ? "" : selectedMonth,
                  from: searching ? searchDates.from : undefined,
                  to: searching ? searchDates.to : undefined,
                  categoryId: view.categoryId || undefined,
                  flow: "all",
                  source: "all",
                  search: searching ? submittedSearch : monthlySearch,
                  category: null,
                }),
                view.tab,
              ),
              searching ? null : view.slice,
            ),
            view.slice ? "all" : view.role,
          ),
          view.card,
          (item) => transactionCardLast4(transactionOf(item)),
        ),
        view.uncategorized,
      ),
      view.review,
    ),
  );
  /** 總帳隱藏的重複項目數（已併入另一筆紀錄，例如已對應刷卡的發票）。 */
  const hiddenDuplicates = $derived(
    view.tab === "ledger"
      ? rawItems.filter(
          (item) =>
            item.duplicateOf &&
            (searching || activityDateKey(item).startsWith(selectedMonth)),
        ).length
      : 0,
  );
  const fillingSearchBatch = $derived(
    searching && !invalidSearchDates && $searchResults.isFetching,
  );
  let searchSentinel = $state<HTMLDivElement>();
  $effect(() => {
    if (
      !searchSentinel ||
      !searching ||
      invalidSearchDates ||
      !$searchResults.hasNextPage ||
      $searchResults.isFetching ||
      $searchResults.isError
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void $searchResults.fetchNextPage();
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(searchSentinel);
    return () => observer.disconnect();
  });
  const listView = $derived(
    buildActivityListView(filtered, view.sort, rateValues),
  );
  const listEmptyMessage = $derived(
    searching && invalidSearchDates
      ? "請調整搜尋日期。"
      : fillingSearchBatch
        ? "搜尋活動中…"
        : !searching && $monthItems.isPlaceholderData
          ? "載入活動中…"
          : activityDataStatus.hasFailure
            ? "部分資料目前無法顯示，請重試後再查看。"
            : "沒有符合條件的活動。",
  );
  const listTitle = $derived(
    searching
      ? `已載入 ${filtered.length} 筆`
      : view.slice
        ? `${selectedMonthLabel} · ${view.slice.flow === "expense" ? "消費" : "收入"} · ${view.slice.category}`
        : view.review
          ? `${selectedMonthLabel} · 待確認`
          : view.role !== "all"
            ? `${selectedMonthLabel} · ${ECONOMIC_ROLE_LABELS[view.role]}`
            : `${selectedMonthLabel} · ${TRANSACTION_TAB_LABELS[view.tab]}`,
  );
  const reviewCount = $derived(
    searching
      ? rawItems.filter((item) => item.reviewStatus === "needs_review").length
      : (selectedSummary?.needsReview.count ?? 0),
  );
  const duplicateLabels = $derived(
    new Map(
      rawItems
        .filter((item) => item.duplicateOf)
        .map((item) => [
          activityKey(item),
          duplicateTargetLabel(item, findDuplicateTarget(item, rawItems)),
        ]),
    ),
  );
  function duplicateLabel(item: ActivityItem) {
    return duplicateLabels.get(activityKey(item));
  }
  const filterCategoryOptions = $derived([
    ...categoryOptions.map((option) => ({
      id: option.id,
      label: categoryOptionText(option),
    })),
    { id: UNCATEGORIZED_CATEGORY_ID, label: "未分類" },
    ...ACTIVITY_EXTRA_CATEGORY_OPTIONS,
  ]);
  const filterChips = $derived(
    activityFilterChips(view, {
      searching,
      text: monthlySearch,
      categoryLabel: (id) =>
        filterCategoryOptions.find((option) => option.id === id)?.label,
    }),
  );
  function clearChip(key: ActivityFilterChipKey) {
    if (key === "text") search = "";
    else view = clearActivityFilter(view, key);
  }
  function clearAllFilters() {
    if (!searching) search = "";
    view = clearActivityFilters(view);
  }
  let toolbarHeight = $state(0);
  const mappingCandidates = $derived.by(() => {
    if (!mappingDialog) return [];
    const unavailableTransactionIds = new Set(
      Array.from(invoiceMatches.transactionToInvoice.entries())
        .filter(([, invoice]) => invoice.id !== mappingDialog!.invoice.id)
        .map(([transactionId]) => transactionId),
    );
    return invoiceTransactionCandidates(
      activityBankTransactions,
      mappingDialog.invoice,
      unavailableTransactionIds,
    );
  });
  // 改分類：先改這一筆（個別覆寫），有商家時再詢問是否套用到同商家並記住。
  const categorizeOptions = categorizeActivitiesMutation(() => api);
  let merchantPrompt = $state<{
    item: ActivityItem;
    categoryId: string;
    message: string;
  } | null>(null);
  const categoryMutation = createMutation({
    mutationFn: (payload: { item: ActivityItem; categoryId: string }) =>
      categorizeOptions.mutationFn(
        categorizeRequest(payload.item, payload.categoryId),
      ),
    onSuccess: (_result, { item, categoryId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      if (!item.merchantKey) return;
      const label = categories[categoryId] ?? categoryId;
      merchantPrompt = {
        item,
        categoryId,
        message: merchantPromptText(
          item,
          label,
          merchantSiblingCount(rawItems, item),
        ),
      };
    },
  });
  const merchantMutation = createMutation({
    mutationFn: (payload: { item: ActivityItem; categoryId: string }) =>
      categorizeOptions.mutationFn(
        categorizeRequest(payload.item, payload.categoryId, true),
      ),
    onSuccess: (_result, { item }) => {
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      merchantPrompt = null;
      showMappingNotice(
        `已記住「${item.displayName?.trim() || item.title}」的分類`,
      );
    },
  });
  function dismissMerchantPrompt() {
    merchantPrompt = null;
    $merchantMutation.reset();
  }
  const calculationMutation = createMutation({
    mutationFn: (payload: {
      transactionId: string;
      excludedFromCalculation: boolean;
    }) =>
      api.patch(
        `/api/bank/transactions/${encodeURIComponent(payload.transactionId)}/calculation`,
        { excludedFromCalculation: payload.excludedFromCalculation },
      ),
    onSuccess: (_result, payload) => {
      updateCalculationCache(
        payload.transactionId,
        payload.excludedFromCalculation,
      );
      qc.invalidateQueries({ queryKey: queryKeys.bank });
    },
  });
  const calculationUpdateMutation = createMutation({
    mutationFn: async (payload: CalculationUpdateInput) => {
      await api.patch(
        `/api/bank/transactions/${encodeURIComponent(payload.transactionId)}/calculation`,
        { excludedFromCalculation: true },
      );

      if (payload.applyRule && payload.ruleId) {
        await api.put(
          `/api/classification/rules/${encodeURIComponent(payload.ruleId)}`,
          {
            categoryId: payload.categoryId,
            excludedFromCalculation: true,
          },
        );
        return;
      }

      if (payload.categoryId !== payload.originalCategoryId) {
        await api.put(
          `/api/classification/overrides/bank_transaction/${payload.transactionId}`,
          { categoryId: payload.categoryId },
        );
      }

      if (payload.applyRule) {
        await api.post("/api/classification/rules", {
          categoryId: payload.categoryId,
          targetType: "bank_transaction",
          field: "any_text",
          operator: payload.operator,
          pattern: payload.pattern.trim(),
          priority: 200,
          description: "由活動頁排除計算時建立",
          excludedFromCalculation: true,
        });
      }
    },
    onSuccess: (_result, payload) => {
      updateCalculationCache(payload.transactionId, true);
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      if (payload.applyRule)
        qc.invalidateQueries({ queryKey: queryKeys.classificationRules });
      pendingCalculation = null;
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      qc.invalidateQueries({ queryKey: queryKeys.classificationRules });
    },
  });
  const mappingMutation = createMutation({
    mutationFn: (payload: { invoiceId: string; transactionId: string }) =>
      api.put<InvoiceTransactionPreference>(
        `/api/activity/invoice-mappings/${encodeURIComponent(payload.invoiceId)}`,
        { transactionId: payload.transactionId },
      ),
    onSuccess: (preference) => {
      updateMappingPreference(preference);
      mappingDialog = null;
      closeDetail();
      showMappingNotice("已完成配對，發票不再重複計算");
    },
  });
  const separationMutation = createMutation({
    mutationFn: (invoiceId: string) =>
      api.delete<InvoiceTransactionPreference>(
        `/api/activity/invoice-mappings/${encodeURIComponent(invoiceId)}`,
      ),
    onSuccess: (preference) => {
      updateMappingPreference(preference);
      mappingDialog = null;
      closeDetail();
      showMappingNotice("已解除配對，兩筆活動將保持分開");
    },
  });
  // 角色 override 成功後重新載入月收支 summary、月份活動、搜尋結果與交易：
  // 這些 query key 都以 "bank" 開頭（見 data/activity/queries.ts），一次失效即可。
  function invalidateRoleQueries() {
    qc.invalidateQueries({ queryKey: queryKeys.bank });
  }
  const roleMutation = createMutation({
    mutationFn: (payload: {
      item: ActivityItem;
      role: EconomicRole;
      note?: string;
    }) => {
      const target = activityRoleTarget(payload.item);
      if (!target) throw new Error("此活動不支援調整角色。");
      return api.put(roleOverridePath(target), {
        economicRole: payload.role,
        ...(payload.note !== undefined ? { note: payload.note } : {}),
      });
    },
    onSuccess: () => {
      invalidateRoleQueries();
      pendingRole = null;
    },
  });
  // 選擇轉到自己帳戶、不計入或收入時先問原因（選填，存成備註）。
  let pendingRole = $state<{ item: ActivityItem; role: EconomicRole } | null>(
    null,
  );
  function submitRoleReason(reason: string) {
    if (!pendingRole) return;
    const { item, role } = pendingRole;
    // 沒有改動原因時不送 note，保留既有備註（也不會在配對的另一筆多寫一份）。
    const note = reason === (item.note ?? "").trim() ? undefined : reason;
    $roleMutation.mutate({ item, role, note });
  }
  // 備註：寫到 noteTarget（已配對的交易與發票共用），清空即刪除。
  const saveNoteOptions = saveActivityNoteMutation(() => api);
  const deleteNoteOptions = deleteActivityNoteMutation(() => api);
  const noteMutation = createMutation({
    mutationFn: async (payload: { item: ActivityItem; note: string }) => {
      const target = activityNoteTarget(payload.item);
      if (!target) throw new Error("此活動不支援備註。");
      if (payload.note) {
        await saveNoteOptions.mutationFn({ ...target, note: payload.note });
        return;
      }
      try {
        await deleteNoteOptions.mutationFn(target);
      } catch (error) {
        // 已經沒有備註（例如剛建立又清空、另一個分頁已刪除）視為成功。
        if (!(error instanceof ApiRequestError && error.status === 404))
          throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bank }),
  });
  function saveNote(item: ActivityItem, note: string) {
    return $noteMutation.mutateAsync({ item, note });
  }
  const roleResetMutation = createMutation({
    mutationFn: (item: ActivityItem) => {
      const target = activityRoleTarget(item);
      if (!target) throw new Error("此活動不支援調整角色。");
      return api.delete(roleOverridePath(target));
    },
    onSuccess: invalidateRoleQueries,
  });
  function changeRole(item: ActivityItem, role: EconomicRole) {
    $roleResetMutation.reset();
    $roleMutation.reset();
    if (ECONOMIC_ROLES_ASKING_REASON.has(role)) {
      pendingRole = { item, role };
      return;
    }
    $roleMutation.mutate({ item, role });
  }
  function resetRole(item: ActivityItem) {
    $roleMutation.reset();
    $roleResetMutation.mutate(item);
  }
  const roleUpdating = $derived(
    $roleMutation.isPending || $roleResetMutation.isPending,
  );
  function changeCategory(item: ActivityItem, categoryId: string) {
    if (!categoryId || categoryId === item.categoryId) return;
    dismissMerchantPrompt();
    $categoryMutation.mutate({ item, categoryId });
  }
  function showNeedsReview() {
    setView({ review: true });
  }
  function chooseMonth(month: string) {
    setView({ month, slice: null });
  }
  function retryActivityData() {
    if (searching && $searchResults.isError) void $searchResults.refetch();
    if ($monthItems.isError) void $monthItems.refetch();
    if ($summaries.isError) void $summaries.refetch();
    if ($bank.isError) void $bank.refetch();
    if ($invoices.isError) void $invoices.refetch();
    if ($invoiceMappings.isError) void $invoiceMappings.refetch();
  }
  function activityKey(item: ActivityItem) {
    return `${item.source}-${item.id}`;
  }
  function openDetail(item: ActivityItem) {
    detailKey = activityKey(item);
    window.history.pushState(
      { ...window.history.state, activityDetail: detailKey },
      "",
    );
  }
  /** 網址 `activity=<source>:<id>` 指到的活動（收件匣、信用卡頁的連結）。 */
  function matchesTarget(item: ActivityItem, target: ActivityTarget) {
    if (target.source === "invoice")
      return (
        item.source === "invoice" &&
        (item.id === target.id || item.invoiceId === target.id)
      );
    if (target.source === "investment")
      return item.source === "investment" && item.id === target.id;
    // bank:<id> 也涵蓋信用卡交易（同為 bank_transactions）。
    return (
      (item.source === "bank" || item.source === "card") &&
      (item.id === target.id || item.transactionId === target.id)
    );
  }
  $effect(() => {
    const target = view.activity;
    if (!target) return;
    if (searching || $monthItems.isPlaceholderData) return;
    if (!$monthItems.isSuccess && !$monthItems.isError) return;
    const item = rawItems.find((candidate) => matchesTarget(candidate, target));
    if (item) detailKey = activityKey(item);
    // 開啟後清除參數，關閉明細不會再被網址打開。
    view = { ...view, activity: null };
  });
  function transactionForItem(item: ActivityItem) {
    return activityBankTransactions.find(
      (transaction) => transaction.id === item.transactionId,
    );
  }
  function toggleCalculation(item: ActivityItem) {
    if (!item.transactionId) return;
    if (!item.excludedFromCalculation) {
      pendingCalculation = {
        item,
        categoryId: item.categoryId ?? "other",
        applyRule: false,
        pattern: item.classificationPattern ?? item.title,
        operator: "contains",
      };
      return;
    }
    $calculationMutation.mutate({
      transactionId: item.transactionId,
      excludedFromCalculation: false,
    });
  }
  function handleCalculationChange(item: ActivityItem, event: Event) {
    (event.currentTarget as HTMLInputElement).checked = Boolean(
      item.excludedFromCalculation,
    );
    toggleCalculation(item);
  }
  function updateCalculationCache(
    transactionId: string,
    excludedFromCalculation: boolean,
  ) {
    qc.setQueryData<BankData>(queryKeys.bank, (current) =>
      current
        ? {
            ...current,
            transactions: current.transactions.map((transaction) =>
              transaction.id === transactionId
                ? { ...transaction, excludedFromCalculation }
                : transaction,
            ),
          }
        : current,
    );
  }
  function updateMappingPreference(preference: InvoiceTransactionPreference) {
    qc.setQueryData<InvoiceTransactionPreference[]>(
      queryKeys.invoiceTransactionMappings,
      (current = []) => [
        preference,
        ...current.filter((row) => row.invoiceId !== preference.invoiceId),
      ],
    );
    qc.invalidateQueries({ queryKey: queryKeys.invoiceTransactionMappings });
    qc.invalidateQueries({ queryKey: queryKeys.bank });
  }
  function showMappingNotice(message: string) {
    mappingNotice = message;
    window.setTimeout(() => {
      if (mappingNotice === message) mappingNotice = "";
    }, 3500);
  }
  function invoiceForItem(item: ActivityItem) {
    return loadedInvoice(item.invoiceId);
  }
  function openMapping(item: ActivityItem) {
    const invoice = invoiceForItem(item);
    if (!invoice) return;
    mappingDialog = {
      invoice,
      amountTwd: activityInvoiceTwd(item),
      step: item.transactionId ? "actions" : "candidates",
      transactionId: item.transactionId,
    };
  }
  function chooseMappingTransaction(transactionId: string) {
    if (!mappingDialog) return;
    mappingDialog.transactionId = transactionId;
  }
  function selectedMappingTransaction(): BankTransactionRow | undefined {
    if (!mappingDialog?.transactionId) return undefined;
    return activityBankTransactions.find(
      (transaction) => transaction.id === mappingDialog?.transactionId,
    );
  }
  function mappingAccount(transaction: BankTransactionRow) {
    return (
      transaction.institutionName ??
      transaction.accountName ??
      bankAccounts.get(transaction.accountId)?.institutionName ??
      "銀行／信用卡"
    );
  }
  function countMatches(update: {
    pattern: string;
    operator: "contains" | "equals";
  }) {
    const pattern = update.pattern.trim().toLowerCase();
    if (!pattern) return 0;
    return activityBankTransactions.filter((t) =>
      update.operator === "equals"
        ? `${t.description ?? ""} ${t.counterparty ?? ""} ${t.sourceId}`
            .trim()
            .toLowerCase() === pattern
        : `${t.description ?? ""} ${t.counterparty ?? ""} ${t.sourceId}`
            .toLowerCase()
            .includes(pattern),
    ).length;
  }
</script>

{#if !searching && $monthItems.isPending}
  <EmptyState title="載入活動中" body="正在整理銀行、投資與發票資料。" />
{:else}
  <div
    class="grid min-w-0 max-w-full gap-3 overflow-x-clip pt-3 md:pt-0"
    style={`--activity-toolbar-height:${toolbarHeight}px`}
  >
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <TransactionTabs value={view.tab} onChange={(tab) => setView({ tab })} />
      {#if navigate}<button
          type="button"
          class="text-sm font-semibold text-steel hover:text-steel/80"
          onclick={() => navigate?.("transaction-rules")}>自動整理 →</button
        >{/if}
    </div>
    {#if searching}
      <ActivitySearchHeader
        query={submittedSearch}
        sortMode={view.sort}
        filling={fillingSearchBatch}
      />
    {:else if view.tab === "ledger"}
      <div class="border-b border-ink/10 pb-4">
        <SpendingCategoryPie
          slices={spendingSlices}
          total={selectedSummary?.spending ?? 0}
          selectedCategoryId={view.categoryId}
          unavailable={summaryUnavailable}
          onSelect={selectPieCategory}
        />
      </div>
      <div class="border-b border-ink/10 pb-3">
        <CashFlowSummary
          title={`${selectedMonthLabel}收支`}
          note={summaryUnavailable
            ? $summaries.isError
              ? "月收支摘要無法載入"
              : "正在計算本月收支"
            : undefined}
          equation={activitySummaryEquation(selectedSummary)}
          unavailable={summaryUnavailable}
          excluded={activitySummaryExcludedParts(selectedSummary)}
          review={selectedSummary?.needsReview}
          reviewActive={view.review}
          onShowReview={showNeedsReview}
          incompleteReasons={activitySummaryIncompleteLabels(selectedSummary)}
        />
      </div>
    {/if}
    <ActivityDataAlerts
      failedLabels={activityDataStatus.failedLabels}
      retryPending={activityRetryPending}
      onRetry={retryActivityData}
    />
    <div
      bind:offsetHeight={toolbarHeight}
      class="sticky top-[var(--app-sticky-top,0px)] z-30 border-b border-ink/10 bg-paper/95 backdrop-blur-sm xl:top-0"
    >
      <ActivityToolbar
        {searching}
        searchValue={search}
        onSearchInput={changeSearch}
        onSearchSubmit={submitSearch}
        onSearchClear={clearSearch}
        {months}
        {selectedMonth}
        onSelectMonth={chooseMonth}
        {view}
        onChange={setView}
        categories={filterCategoryOptions}
        invalidDates={searching && invalidSearchDates}
        {reviewCount}
        chips={filterChips}
        onClearChip={clearChip}
        onClearAll={clearAllFilters}
      />
    </div>
    <div class="grid min-w-0 gap-4">
      <section class="min-w-0" aria-label="活動列表">
        <div class="flex min-w-0 items-baseline justify-between gap-3 py-2">
          <h2 class="truncate text-sm font-semibold">{listTitle}</h2>
          {#if !searching}<span class="shrink-0 text-caption text-subtle"
              >{filtered.length} 筆{hiddenDuplicates
                ? `・另 ${hiddenDuplicates} 筆重複已併入（見發票分頁）`
                : ""}</span
            >{/if}
        </div>
        {#if $categoryMutation.isError}<p
            role="alert"
            class="pb-2 text-sm font-medium text-coral"
          >
            無法更新分類，請稍後再試。
          </p>{/if}
        {#if $calculationMutation.isError}<p
            class="pb-2 text-sm font-medium text-coral"
          >
            無法更新計算設定，請稍後再試。
          </p>{/if}
        {#if ($roleMutation.isError || $roleResetMutation.isError) && !detailItem && !pendingRole}<p
            role="alert"
            class="pb-2 text-sm font-medium text-coral"
          >
            無法更新活動角色，請稍後再試。
          </p>{/if}
        {#if view.tab !== "ledger"}
          <TransactionSourceList
            {api}
            tab={view.tab}
            items={listView.sections.flatMap((section) => section.items)}
            allItems={rawItems}
            cardOf={(item) => cardIdentity(item, transactionOf(item))}
            emptyMessage={listEmptyMessage}
            onOpen={openDetail}
          />
        {:else}
          <ActivityList
            sections={listView.sections}
            grouped={listView.grouped}
            emptyMessage={listEmptyMessage}
            {searching}
            query={submittedSearch}
            rates={rateValues}
            exchangeRates={$rates.data}
            sortMode={view.sort}
            onSortChange={(sort) => setView({ sort })}
            {categoryOptions}
            onCategoryChange={changeCategory}
            categoryDisabled={$categoryMutation.isPending}
            {duplicateLabel}
            feeLabel={(item) => foreignFeeLabel(item, rawItems)}
            onRoleChange={changeRole}
            roleDisabled={roleUpdating}
            onOpen={openDetail}
          />
        {/if}
        {#if searching && $searchResults.hasNextPage && !invalidSearchDates}
          <div
            bind:this={searchSentinel}
            data-testid="search-load-more"
            class="flex min-h-11 items-center justify-center"
          >
            {#if $searchResults.isError}
              <Button
                variant="outline"
                class="h-11"
                disabled={$searchResults.isFetching}
                onclick={() => $searchResults.fetchNextPage()}
                >重試載入更多</Button
              >
            {:else}
              <p role="status" class="text-sm text-subtle">
                {$searchResults.isFetching ? "載入中…" : "往下捲動載入更多"}
              </p>
            {/if}
          </div>
        {/if}
      </section>
    </div>
    {#if detailItem}
      {@const transaction = transactionForItem(detailItem)}
      <ActivityDetailPanel
        item={detailItem}
        {transaction}
        invoice={detailInvoiceRow}
        accountLabel={transaction ? mappingAccount(transaction) : undefined}
        rates={rateValues}
        exchangeRates={$rates.data}
        invoiceDetail={$detailInvoice.data}
        invoiceDetailPending={$detailInvoice.isPending}
        invoiceDetailFailed={$detailInvoice.isError}
        {categoryOptions}
        calculationDisabled={($calculationMutation.isPending &&
          $calculationMutation.variables?.transactionId ===
            detailItem.transactionId) ||
          $calculationUpdateMutation.isPending}
        onClose={closeDetail}
        onCategoryChange={changeCategory}
        onCalculationChange={handleCalculationChange}
        onOpenMapping={openMapping}
        duplicateTarget={detailItem.duplicateOf
          ? {
              label: duplicateLabel(detailItem) ?? "已併入另一筆活動",
              title: findDuplicateTarget(detailItem, rawItems)?.title,
            }
          : undefined}
        onRoleChange={changeRole}
        onRoleReset={resetRole}
        {roleUpdating}
        roleFailed={!pendingRole &&
          ($roleMutation.isError || $roleResetMutation.isError)}
        onNoteSave={saveNote}
        foreignFee={foreignFeeLabel(detailItem, rawItems)}
      />
    {/if}
    {#if pendingRole}
      <RoleReasonDialog
        title={pendingRole.item.title}
        roleLabel={ECONOMIC_ROLE_CHOICE_LABELS[pendingRole.role]}
        note={pendingRole.item.note}
        submitting={$roleMutation.isPending}
        failed={$roleMutation.isError}
        onCancel={() => (pendingRole = null)}
        onSubmit={submitRoleReason}
      />
    {/if}
    {#if merchantPrompt}
      <MerchantCategoryPrompt
        message={merchantPrompt.message}
        submitting={$merchantMutation.isPending}
        failed={$merchantMutation.isError}
        onApply={() =>
          merchantPrompt &&
          $merchantMutation.mutate({
            item: merchantPrompt.item,
            categoryId: merchantPrompt.categoryId,
          })}
        onDismiss={dismissMerchantPrompt}
      />
    {/if}
    {#if pendingCalculation}
      <CalculationUpdateDialog
        bind:update={pendingCalculation}
        categoryOptions={calculationCategoryOptions}
        matchCount={countMatches(pendingCalculation)}
        submitting={$calculationUpdateMutation.isPending}
        failed={$calculationUpdateMutation.isError}
        onCancel={() => (pendingCalculation = null)}
        onSubmit={(input) => $calculationUpdateMutation.mutate(input)}
      />
    {/if}
    {#if mappingDialog}
      <ActivityInvoiceMappingDialog
        invoice={mappingDialog.invoice}
        invoiceAmountTwd={mappingDialog.amountTwd}
        step={mappingDialog.step}
        selectedTransactionId={mappingDialog.transactionId}
        selectedTransaction={selectedMappingTransaction()}
        candidates={mappingCandidates}
        accountLabel={mappingAccount}
        linking={$mappingMutation.isPending}
        separating={$separationMutation.isPending}
        failed={$mappingMutation.isError || $separationMutation.isError}
        onClose={() => (mappingDialog = null)}
        onStepChange={(step) => (mappingDialog!.step = step)}
        onChooseTransaction={chooseMappingTransaction}
        onConfirm={(transactionId) =>
          $mappingMutation.mutate({
            invoiceId: mappingDialog!.invoice.id,
            transactionId,
          })}
        onSeparate={() => $separationMutation.mutate(mappingDialog!.invoice.id)}
      />
    {/if}
    {#if mappingNotice}<div
        aria-live="polite"
        class="fixed left-1/2 top-20 z-[85] flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl"
      >
        <Check class="size-5 shrink-0 text-lime-300" />{mappingNotice}
      </div>{/if}
  </div>
{/if}
