<script lang="ts">
  import { onMount, tick } from "svelte";
  import { createQuery, QueryClientProvider } from "@tanstack/svelte-query";
  import MonthPage from "@/features/month/MonthPage.svelte";
  import type { ConnectorId } from "@/data/connectors/types";
  import { createApiClient } from "@/shared/api/client";
  import { swipeBack } from "@/shared/actions/swipe-back";
  import { moneyState } from "@/shared/state/money-visibility.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import { cardsSummaryQuery } from "@/data/cards/queries";
  import { syncJobsQuery } from "@/data/connectors/queries";
  import { inboxQuery } from "@/data/inbox/queries";
  import AppFooter from "./AppFooter.svelte";
  import AppHeader from "./AppHeader.svelte";
  import AppRightRail from "./AppRightRail.svelte";
  import AppSidebar from "./AppSidebar.svelte";
  import InboxBadge from "./InboxBadge.svelte";
  import { summarizeSyncJobs, upcomingCardDues } from "./shell-status";
  import MobileTabBar from "./MobileTabBar.svelte";
  import MoreMenu from "./MoreMenu.svelte";
  import {
    EMPTY_INBOX_COUNTS,
    activeNavigationView,
    detailLabels,
    inboxAccessibleLabel,
    inboxItem,
    isDetailView,
    navigationItem,
    navItems,
    settingsItem,
  } from "./navigation-config";
  import { resolveViewHash, viewHash } from "./navigation";
  import { queryClient } from "./query-client";
  import type { NavigateOptions, RuntimeInfo, View } from "./types";
  import "../styles.css";

  type PageKey =
    | "cards"
    | "transactions"
    | "transaction-rules"
    | "assets"
    | "investments"
    | "manual-assets"
    | "own-accounts"
    | "data-sources"
    | "inbox"
    | "settings";
  type LazyPageModule =
    | typeof import("@/features/cards/CardsPage.svelte")
    | typeof import("@/features/activity/ActivityPage.svelte")
    | typeof import("@/features/activity/TransactionRulesPage.svelte")
    | typeof import("@/features/assets/AssetsPage.svelte")
    | typeof import("@/features/assets/Investments.svelte")
    | typeof import("@/features/assets/ManualAssets.svelte")
    | typeof import("@/features/assets/OwnAccountsPage.svelte")
    | typeof import("@/features/data-sources/DataSourcesPage.svelte")
    | typeof import("@/features/inbox/InboxPage.svelte")
    | typeof import("@/features/settings/SettingsPage.svelte");

  const pageLoaders = {
    cards: () => import("@/features/cards/CardsPage.svelte"),
    transactions: () => import("@/features/activity/ActivityPage.svelte"),
    "transaction-rules": () =>
      import("@/features/activity/TransactionRulesPage.svelte"),
    assets: () => import("@/features/assets/AssetsPage.svelte"),
    investments: () => import("@/features/assets/Investments.svelte"),
    "manual-assets": () => import("@/features/assets/ManualAssets.svelte"),
    "own-accounts": () => import("@/features/assets/OwnAccountsPage.svelte"),
    "data-sources": () =>
      import("@/features/data-sources/DataSourcesPage.svelte"),
    inbox: () => import("@/features/inbox/InboxPage.svelte"),
    settings: () => import("@/features/settings/SettingsPage.svelte"),
  } satisfies Record<PageKey, () => Promise<LazyPageModule>>;
  const pagePromises: Partial<Record<PageKey, Promise<LazyPageModule>>> = {};
  const isPageKey = (value: View): value is PageKey =>
    Object.hasOwn(pageLoaders, value);

  const api = createApiClient();
  // 待處理 badge。App 本身在 QueryClientProvider 之外，直接指定 queryClient；
  // 載入失敗時不顯示 badge（待處理頁會顯示錯誤）。
  const inbox = createQuery(
    inboxQuery(() => api),
    queryClient,
  );
  const inboxCounts = $derived($inbox.data?.counts ?? EMPTY_INBOX_COUNTS);
  // 頁首同步狀態與右側概況欄。失敗時各區塊顯示「無法讀取」，不擋頁面。
  // 同步由 Queue 非同步執行：有來源執行中時每 10 秒、平常每分鐘重新讀取。
  const jobs = createQuery(
    {
      ...syncJobsQuery(() => api),
      refetchInterval: (query) =>
        query.state.data?.some((job) => job.running) ? 10_000 : 60_000,
    },
    queryClient,
  );
  const cardsSummary = createQuery(
    cardsSummaryQuery(() => api),
    queryClient,
  );
  const syncOverview = $derived(
    $jobs.data ? summarizeSyncJobs($jobs.data) : undefined,
  );
  const cardDues = $derived(upcomingCardDues($cardsSummary.data));

  // 右側概況欄：寬螢幕（≥ 1680px）常駐並記住開關；較窄時以抽屜開啟。
  const PANEL_STORAGE_KEY = "taiwan-fin-hub-right-panel";
  const WIDE_QUERY = "(min-width: 1680px)";
  function readPanelPinned() {
    try {
      return localStorage.getItem(PANEL_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  }
  // 首次渲染前就決定寬度與開關，避免寬螢幕第一幀沒有概況欄而跳版。
  let panelPinned = $state(readPanelPinned());
  let drawerOpen = $state(false);
  let wide = $state(window.matchMedia(WIDE_QUERY).matches);
  let drawerReturnFocus: HTMLElement | null = null;
  const panelOpen = $derived(wide ? panelPinned : drawerOpen);

  function openDrawer() {
    drawerReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    drawerOpen = true;
  }
  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    const target =
      drawerReturnFocus ??
      document.querySelector<HTMLElement>("[data-panel-toggle]");
    drawerReturnFocus = null;
    // 等背景解除 inert 後再還原焦點；原按鈕已隱藏（跨過斷點）時改聚焦主內容。
    void tick().then(() => {
      if (target?.isConnected && target.getClientRects().length > 0) {
        target.focus();
        return;
      }
      document
        .querySelector<HTMLElement>("main")
        ?.focus({ preventScroll: true });
    });
  }
  // 抽屜開啟時把焦點移到關閉鈕；背景以 inert 排除在 Tab 順序外。
  let drawerElement = $state<HTMLElement>();
  $effect(() => {
    if (!drawerOpen) return;
    // 一般瀏覽器捲動 html；PWA（standalone）捲動的是 #root。
    const scroller = isStandalone()
      ? document.getElementById("root")
      : document.documentElement;
    if (!scroller) return;
    const previous = scroller.style.overflow;
    scroller.style.overflow = "hidden";
    return () => {
      scroller.style.overflow = previous;
    };
  });
  $effect(() => {
    if (!drawerOpen || !drawerElement) return;
    drawerElement.querySelector<HTMLElement>("[data-drawer-close]")?.focus();
  });

  function togglePanel() {
    if (!wide) {
      if (drawerOpen) closeDrawer();
      else openDrawer();
      return;
    }
    panelPinned = !panelPinned;
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, String(panelPinned));
    } catch {
      // 無法寫入時只影響本次瀏覽。
    }
  }
  // 首次渲染前就依網址決定頁面（含舊網址導向），避免先掛載本月頁再切換。
  let view = $state<View>(
    resolveViewHash(window.location.hash)?.view ?? "month",
  );
  let connectorTarget = $state<ConnectorId | null>(null);
  let runtime = $state<RuntimeInfo>({ demoMode: false });
  // sticky 頁首高度（所有寬度），供頁面內的 sticky 工具列接在頁首下方。
  let headerHeight = $state(0);
  const activeView = $derived(activeNavigationView(view));
  const detail = $derived(isDetailView(view) ? detailLabels[view] : undefined);
  const currentItem = $derived(
    view === "more"
      ? { label: "更多", description: "資料來源、待處理與設定。" }
      : (detail ?? navigationItem(view) ?? navItems[0]!),
  );
  const parentLabel = $derived(
    detail ? (navigationItem(detail.parent)?.label ?? "") : "",
  );

  const pagePromise = $derived.by(() => {
    if (!isPageKey(view)) return Promise.resolve(undefined);
    return (pagePromises[view] ??= pageLoaders[view]());
  });

  function retryPage() {
    window.location.reload();
  }

  const isStandalone = () =>
    document.documentElement.classList.contains("is-standalone");
  function scrollToTop() {
    const options: ScrollToOptions = { top: 0, behavior: "smooth" };
    if (isStandalone()) document.getElementById("root")?.scrollTo(options);
    else window.scrollTo(options);
  }
  function replaceHash(hash: string) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  }

  /** 依網址決定目前頁；舊路徑（總覽、活動、設定子頁）換成新網址並保留 query。 */
  function syncFromLocation() {
    const route = resolveViewHash(window.location.hash);
    if (!route) {
      view = "month";
      replaceHash(viewHash("month"));
      return;
    }
    if (route.redirected) replaceHash(route.hash);
    view = route.view;
  }

  onMount(() => {
    // 抽屜只在 xl（1280px）到 1679px 之間提供；跨出這個區間時走統一的關閉流程。
    const wideMedia = window.matchMedia(WIDE_QUERY);
    const drawerMedia = window.matchMedia("(min-width: 1280px)");
    const updateWide = () => {
      wide = wideMedia.matches;
      if (wide || !drawerMedia.matches) closeDrawer();
    };
    updateWide();
    wideMedia.addEventListener("change", updateWide);
    drawerMedia.addEventListener("change", updateWide);
    const closeDrawerOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", closeDrawerOnEscape);
    syncFromLocation();
    const handleHashChange = () => {
      syncFromLocation();
      scrollToTop();
    };
    window.addEventListener("hashchange", handleHashChange);

    void api
      .get<RuntimeInfo>("/api/runtime")
      .then((info) => (runtime = info))
      .catch(() => (runtime = { demoMode: false }));
    moneyState.hidden =
      localStorage.getItem("taiwan-fin-hub-money-hidden") === "true";
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", closeDrawerOnEscape);
      wideMedia.removeEventListener("change", updateWide);
      drawerMedia.removeEventListener("change", updateWide);
    };
  });

  function navigate(next: View, options: NavigateOptions = {}) {
    const samePage = view === next;
    view = next;
    connectorTarget =
      next === "data-sources" ? (options.connectorId ?? null) : null;
    const nextHash = viewHash(next, options.query);
    if (window.location.hash !== nextHash) {
      // 帶 query 的導覽（例如本月 → 交易篩選）在頁面掛載前換好網址，讓頁面
      // 由網址還原狀態；PWA 不留上一頁紀錄。
      if (samePage && options.query) {
        // 已在同一頁（例如在交易頁用頁首搜尋）：取代網址後送出 popstate，讓頁面由網址
        // 重新還原，不增加上一頁紀錄。
        replaceHash(nextHash);
        window.dispatchEvent(
          new PopStateEvent("popstate", { state: window.history.state }),
        );
      } else if (isStandalone() || options.query) replaceHash(nextHash);
      else window.location.hash = nextHash;
    }
    scrollToTop();
  }
  function navigateBack() {
    if (detail) navigate(detail.parent);
  }
  function toggleMoneyVisibility() {
    moneyState.hidden = !moneyState.hidden;
    localStorage.setItem(
      "taiwan-fin-hub-money-hidden",
      String(moneyState.hidden),
    );
  }
</script>

<QueryClientProvider client={queryClient}>
  <div
    class="min-h-screen bg-paper text-ink xl:grid xl:grid-cols-[240px_minmax(0,1fr)]"
    inert={drawerOpen && !wide}
    use:swipeBack={{
      enabled: isStandalone() && Boolean(detail),
      onBack: navigateBack,
    }}
  >
    <AppSidebar {activeView} {inboxCounts} {navigate} />

    <div
      class="flex min-h-screen min-w-0 flex-col pb-20 md:pb-0"
      style={`--app-sticky-top:${headerHeight}px`}
    >
      <nav
        aria-label="頁面導覽"
        class="no-scrollbar hidden border-b border-ink/10 bg-paper px-4 py-2 md:flex md:gap-1 md:overflow-x-auto xl:hidden"
      >
        {#each [inboxItem, ...navItems, settingsItem] as item (item.view)}
          {@const NavIcon = item.icon}
          <button
            type="button"
            class={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium ${activeView === item.view ? "bg-ink text-white" : "text-subtle hover:bg-ink/5"}`}
            aria-current={activeView === item.view ? "page" : undefined}
            aria-label={item.view === "inbox"
              ? inboxAccessibleLabel(inboxCounts)
              : undefined}
            onclick={() => navigate(item.view)}
            ><NavIcon
              class="size-4"
            />{item.label}{#if item.view === "inbox"}<InboxBadge
                counts={inboxCounts}
              />{/if}</button
          >
        {/each}
      </nav>
      <AppHeader
        {view}
        title={currentItem.label}
        description={currentItem.description}
        backLabel={detail ? parentLabel : undefined}
        onBack={detail ? () => navigate(detail.parent) : undefined}
        {inboxCounts}
        sync={syncOverview}
        syncError={$jobs.isError}
        {panelOpen}
        panelIsDrawer={!wide}
        onTogglePanel={togglePanel}
        onToggleMoney={toggleMoneyVisibility}
        {navigate}
        bind:height={headerHeight}
      />

      <div class="flex min-w-0 flex-1 items-start">
        <main
          tabindex="-1"
          class="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 outline-none pb-5 pt-0 sm:px-6 md:py-5 xl:px-8 xl:py-6"
        >
          {#if view === "month"}
            <MonthPage {api} {navigate} {inboxCounts} />
          {:else if view === "more"}
            <MoreMenu {inboxCounts} demoMode={runtime.demoMode} {navigate} />
          {:else}
            {#await pagePromise}
              <EmptyState title="載入頁面中" body="正在準備內容。" />
            {:then module}
              {#if module}
                {#if view === "cards"}
                  {@const Page =
                    module.default as typeof import("@/features/cards/CardsPage.svelte").default}
                  <Page {api} />
                {:else if view === "transactions"}
                  {@const Page =
                    module.default as typeof import("@/features/activity/ActivityPage.svelte").default}
                  <Page {api} {navigate} />
                {:else if view === "transaction-rules"}
                  {@const Page =
                    module.default as typeof import("@/features/activity/TransactionRulesPage.svelte").default}
                  <Page {api} />
                {:else if view === "assets"}
                  {@const Page =
                    module.default as typeof import("@/features/assets/AssetsPage.svelte").default}
                  <Page {api} {navigate} />
                {:else if view === "investments"}
                  {@const Page =
                    module.default as typeof import("@/features/assets/Investments.svelte").default}
                  <Page {api} />
                {:else if view === "manual-assets"}
                  {@const Page =
                    module.default as typeof import("@/features/assets/ManualAssets.svelte").default}
                  <Page {api} />
                {:else if view === "own-accounts"}
                  {@const Page =
                    module.default as typeof import("@/features/assets/OwnAccountsPage.svelte").default}
                  <Page {api} demoMode={runtime.demoMode} />
                {:else if view === "data-sources"}
                  {@const Page =
                    module.default as typeof import("@/features/data-sources/DataSourcesPage.svelte").default}
                  <Page {api} demoMode={runtime.demoMode} {connectorTarget} />
                {:else if view === "inbox"}
                  {@const Page =
                    module.default as typeof import("@/features/inbox/InboxPage.svelte").default}
                  <Page {api} {navigate} />
                {:else}
                  {@const Page =
                    module.default as typeof import("@/features/settings/SettingsPage.svelte").default}
                  <Page {api} demoMode={runtime.demoMode} />
                {/if}
              {/if}
            {:catch}
              <section class="min-w-0 py-16" role="alert" aria-live="assertive">
                <h2 class="text-base font-semibold tracking-tight">
                  頁面載入失敗
                </h2>
                <p class="mt-2 text-caption text-subtle">請再試一次。</p>
                <Button class="mt-5" variant="outline" onclick={retryPage}
                  >重新載入</Button
                >
              </section>
            {/await}
          {/if}
        </main>
        {#if wide && panelPinned}
          <aside
            aria-label="概況"
            class="sticky w-[320px] shrink-0 self-start overflow-y-auto border-l border-ink/10"
            style={`top:${headerHeight}px;max-height:calc(100vh - ${headerHeight}px)`}
          >
            <AppRightRail
              inboxItems={$inbox.data?.items ?? []}
              inboxLoading={$inbox.isPending}
              inboxError={$inbox.isError}
              dues={cardDues}
              duesLoading={$cardsSummary.isPending}
              duesError={$cardsSummary.isError}
              sync={syncOverview}
              syncError={$jobs.isError}
              {navigate}
            />
          </aside>
        {/if}
      </div>

      <AppFooter lastSyncAt={syncOverview?.lastSuccessAt} />
    </div>

    <MobileTabBar {activeView} {inboxCounts} {navigate} />
  </div>

  {#if drawerOpen && !wide}
    <div class="fixed inset-0 z-40 flex justify-end">
      <div
        class="absolute inset-0 bg-ink/30"
        aria-hidden="true"
        onclick={closeDrawer}
      ></div>
      <div
        bind:this={drawerElement}
        id="right-rail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="right-rail-title"
        class="relative h-full w-[340px] max-w-[90vw] overflow-y-auto overscroll-contain bg-paper shadow-xl"
      >
        <AppRightRail
          inboxItems={$inbox.data?.items ?? []}
          inboxLoading={$inbox.isPending}
          inboxError={$inbox.isError}
          dues={cardDues}
          duesLoading={$cardsSummary.isPending}
          duesError={$cardsSummary.isError}
          sync={syncOverview}
          syncError={$jobs.isError}
          {navigate}
          onClose={closeDrawer}
        />
      </div>
    </div>
  {/if}
</QueryClientProvider>
