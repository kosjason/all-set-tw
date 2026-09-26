<script lang="ts">
  import { onMount } from "svelte";
  import { Eye, EyeOff, Inbox } from "@lucide/svelte";
  import { createQuery, QueryClientProvider } from "@tanstack/svelte-query";
  import MonthPage from "@/features/month/MonthPage.svelte";
  import type { ConnectorId } from "@/data/connectors/types";
  import { createApiClient } from "@/shared/api/client";
  import { swipeBack } from "@/shared/actions/swipe-back";
  import { moneyState } from "@/shared/state/money-visibility.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Icon from "@/shared/ui/Icon.svelte";
  import { inboxQuery } from "@/data/inbox/queries";
  import AppSidebar from "./AppSidebar.svelte";
  import InboxBadge from "./InboxBadge.svelte";
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
  // 首次渲染前就依網址決定頁面（含舊網址導向），避免先掛載本月頁再切換。
  let view = $state<View>(
    resolveViewHash(window.location.hash)?.view ?? "month",
  );
  let connectorTarget = $state<ConnectorId | null>(null);
  let runtime = $state<RuntimeInfo>({ demoMode: false });
  // 窄螢幕的 sticky 頁首高度，供頁面內的 sticky 工具列接在頁首下方。
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
    return () => window.removeEventListener("hashchange", handleHashChange);
  });

  function navigate(next: View, options: NavigateOptions = {}) {
    view = next;
    connectorTarget =
      next === "data-sources" ? (options.connectorId ?? null) : null;
    const nextHash = viewHash(next, options.query);
    if (window.location.hash !== nextHash) {
      // 帶 query 的導覽（例如本月 → 交易篩選）在頁面掛載前換好網址，讓頁面
      // 由網址還原狀態；PWA 不留上一頁紀錄。
      if (isStandalone() || options.query) replaceHash(nextHash);
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
    use:swipeBack={{
      enabled: isStandalone() && Boolean(detail),
      onBack: navigateBack,
    }}
  >
    <AppSidebar {activeView} {inboxCounts} {navigate} />

    <div class="min-w-0 pb-20" style={`--app-sticky-top:${headerHeight}px`}>
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
      <header
        bind:offsetHeight={headerHeight}
        class="sticky top-0 z-20 border-b border-ink/10 bg-paper/95 backdrop-blur-sm xl:static xl:bg-transparent xl:backdrop-blur-0"
      >
        <div
          class="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-4 sm:px-6 xl:px-8 xl:py-6"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              {#if detail}
                <button
                  type="button"
                  class="mb-1 inline-flex items-center gap-1 text-xs font-medium text-steel"
                  onclick={() => navigate(detail.parent)}
                  >← 返回{parentLabel}</button
                >
              {/if}
              <h1
                class="truncate text-2xl font-semibold tracking-tight xl:text-3xl"
              >
                {currentItem.label}
              </h1>
              <p class="mt-1 hidden text-sm leading-6 text-subtle md:block">
                {currentItem.description}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class={`relative flex size-10 items-center justify-center rounded-full md:hidden ${view === "inbox" ? "bg-ink text-white" : "bg-secondary text-ink"}`}
                aria-label={inboxAccessibleLabel(inboxCounts)}
                onclick={() => navigate("inbox")}
                ><Inbox class="size-5" /><span aria-hidden="true"
                  ><InboxBadge counts={inboxCounts} variant="overlay" /></span
                ></button
              >
              <Button
                class="rounded-full"
                aria-label={moneyState.hidden ? "顯示金額" : "隱藏金額"}
                onclick={toggleMoneyVisibility}
                size="icon"
                variant="secondary"
                ><Icon
                  icon={moneyState.hidden ? Eye : EyeOff}
                  size="lg"
                /></Button
              >
            </div>
          </div>
        </div>
      </header>

      <main
        class="mx-auto max-w-[1440px] px-4 pb-5 pt-0 sm:px-6 md:py-5 xl:px-8 xl:py-6"
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
      <footer
        class="mx-auto hidden max-w-[1440px] border-t border-ink/8 px-4 py-6 sm:px-6 md:block xl:px-8"
      >
        <p class="text-xs leading-relaxed text-ink/35">
          <strong class="font-medium text-ink/50">免責聲明：</strong
          >本程式僅供個人研究與自用，未與臺灣集中保管結算所、財政部、金融監督管理委員會、各銀行或任何金融機構合作，亦未獲前述機構授權或背書。本程式所呈現的資料以您自行提供之憑證取得，作者不保證資料的即時性、正確性與完整性，亦不對因使用本程式所產生的任何直接或間接損失負責。請勿將本程式用於任何商業用途。
        </p>
      </footer>
    </div>

    <MobileTabBar {activeView} {inboxCounts} {navigate} />
  </div>
</QueryClientProvider>
