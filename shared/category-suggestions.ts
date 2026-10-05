import { meaningfulInvoiceItems, type InvoiceItemLike } from "./merchant";

/**
 * 自動分類建議的來源，優先序由高到低：
 * 1. merchant_history：同一商家過去被使用者分類最多的類別。
 * 2. merchant_keywords：商家名稱關鍵字（品牌明確者，如全聯、中油、Uber、Netflix）。
 * 3. item_keywords：發票品項關鍵字（以金額加權，需占可辨識品項金額的 40% 以上）。
 * 4. merchant_keywords（需依品項細分的商家，如 7-ELEVEN、全家）的預設分類。
 * 5. ai：保留介面，本批未實作。
 *
 * 前三種來源（{@link AUTO_APPLY_SUGGESTION_SOURCES}）的建議在讀取時直接成為
 * categoryId（categorySource = auto_suggestion）；使用者覆寫、商家規則與使用者規則仍優先。
 */
export const CATEGORY_SUGGESTION_SOURCES = [
  "merchant_history",
  "merchant_keywords",
  "item_keywords",
  "ai",
] as const;
export type CategorySuggestionSource =
  (typeof CATEGORY_SUGGESTION_SOURCES)[number];

/** 讀取時直接套用成 categoryId 的建議來源。 */
export const AUTO_APPLY_SUGGESTION_SOURCES: ReadonlySet<CategorySuggestionSource> =
  new Set(["merchant_history", "merchant_keywords", "item_keywords"]);

export interface CategorySuggestion {
  categoryId: string;
  source: CategorySuggestionSource;
}

interface KeywordRule {
  pattern: RegExp;
  categoryId: string;
  /** 商家販售多種類別（超商、量販）：品項可判斷時以品項為準。 */
  refineByItems?: boolean;
  /** 只適用於流入（收入）或流出（消費）。未指定時只適用於流出。 */
  direction?: "inflow" | "outflow";
}

/**
 * 台灣常見商家名稱關鍵字 → 分類。比對對象為 NFKC、小寫後的商家文字。
 * 順序有意義：較具體的條目（如 Uber Eats）必須排在較廣的條目（Uber）之前。
 */
export const MERCHANT_KEYWORD_RULES: readonly KeywordRule[] = [
  // 收入
  {
    pattern: /薪|salary|payroll|工資|獎金|bonus/u,
    categoryId: "income.salary",
    direction: "inflow",
  },
  {
    pattern: /股利|股息|配息|利息|收益分配|dividend|interest/u,
    categoryId: "income.investment",
    direction: "inflow",
  },
  {
    pattern: /回饋|退稅|補助|津貼|稿費|cashback/u,
    categoryId: "income.other",
    direction: "inflow",
  },
  // 平台與禮物：付款平台的名稱常和品牌同時出現（例如「Google Play 星巴克」「LINE禮物 咖啡券」），
  // 必須排在所有品牌之前。App Store／Google Play 等數位內容歸 3C 數位；LINE禮物是人情，歸其他。
  {
    pattern:
      /apple\.com\/bill|\bapp\s*store\b|google\s*\*?\s*play|tradingview|trend\s*micro|趨勢科技/u,
    categoryId: "tech",
  },
  { pattern: /line\s*禮物|line\s*gift/u, categoryId: "misc" },
  // 餐飲（餐廳、便當、飲料、咖啡、超市、超商）
  {
    pattern: /uber\s*\*?\s*eats|foodpanda|熊貓/u,
    categoryId: "food",
  },
  {
    pattern:
      /星巴克|starbucks|路易莎|louisa|\bcama\b|85度c|五十嵐|50嵐|清心福全|可不可|迷客夏|茶湯會|coco都可|春水堂|大苑子|得正|麻古|鶴茶樓|comebuy|老虎堂|珍煮丹|咖啡|coffee|cafe|茶飲|飲料|飲品|手搖|豆花|冰(?!箱|櫃)/u,
    categoryId: "food",
  },
  {
    pattern:
      /全聯|家樂福|carrefour|好市多|costco|美廉社|頂好|wellcome|楓康|愛買|城市超市|jasons|超市|市場|果菜|生鮮/u,
    categoryId: "food",
  },
  {
    pattern:
      /7-?eleven|7-?11|統一超商|全家(?!福)|familymart|family mart|萊爾富|hi-?life|ok\s*mart|ok超商|ok便利|超商/u,
    // 超商依品項判斷（衛生紙→購物、電池→3C…），判斷不出來時歸入餐飲。
    categoryId: "food",
    refineByItems: true,
  },
  {
    pattern:
      /麥當勞|mcdonald|肯德基|kfc|摩斯|mos burger|漢堡王|burger king|popeyes|\bsubway\b|牛排(?!刀)|steak\s*house|必勝客|pizza hut|達美樂|domino|拿坡里|鼎泰豐|八方雲集|四海遊龍|爭鮮|壽司郎|sushiro|藏壽司|瓦城|王品|饗賓|築間|海底撈|胡椒|牛肉麵|便當|自助餐|小吃|麵店|麵館|餐廳|餐館|餐飲|食堂|火鍋|燒肉|拉麵|早餐|美食|小館|飯館|食品行|壽司|麵(?!粉)|(?<!電子?)飯(?!店)|餐(?!具|桌|椅|券)|(?<!電子?)鍋(?!具)/u,
    categoryId: "food",
  },
  // 交通
  {
    pattern: /uber|計程車|taxi|台灣大車隊|55688|yoxi|line\s*taxi|linego|bolt/u,
    categoryId: "transport",
  },
  {
    pattern:
      /中油|cpc|台塑石油|全國加油|加油站|停車|parking|嘟嘟房|俥亭|etag|遠通電收|洗車/u,
    categoryId: "transport",
  },
  {
    pattern:
      /悠遊卡|easycard|捷運|metro|高鐵|thsr|台鐵|臺鐵|鐵路局|客運|國光|統聯|youbike|微笑單車/u,
    categoryId: "transport",
  },
  // 居住
  {
    pattern: /台電|台灣電力|自來水|台水|瓦斯|天然氣|水費|電費/u,
    categoryId: "housing",
  },
  {
    pattern:
      /中華電信|遠傳|台灣大哥大|台哥大|台灣之星|亞太電信|中嘉|凱擘|hinet|電信|寬頻/u,
    categoryId: "housing",
  },
  {
    pattern: /房租|租金|房貸|管理費|物業/u,
    categoryId: "housing",
  },
  // 3C 數位：軟體、AI 訂閱與雲端（在購物之前，避免 amazon web services 被歸為購物）
  {
    pattern:
      /chatgpt|openai|anthropic|claude|cursor|github|gitlab|jetbrains|notion|dropbox|adobe|figma|slack|zoom|microsoft\s*365|office\s*365|google\s*\*?\s*(?:one|storage|workspace|cloud)|\baws\b|amazon\s*web\s*services|cloudflare|godaddy|namecheap|gandi|digitalocean|linode|vercel|heroku|icloud|網域|虛擬主機|主機代管|\bssl\b|\bdomain\b|\bhosting\b|雲端/u,
    categoryId: "tech",
  },
  // 娛樂：影音串流訂閱
  {
    pattern:
      /netflix|spotify|youtube|disney\s*\+|disney plus|kkbox|friday影音|linetv|nintendo\s*online|playstation\s*plus|訂閱/u,
    categoryId: "entertainment",
  },
  // 購物
  {
    pattern:
      /momo|富邦媒體|pchome|網路家庭|蝦皮|shopee|酷澎|coupang|amazon|淘寶|taobao|露天|yahoo\s*購物|博客來|books\.com/u,
    categoryId: "shopping",
  },
  {
    pattern:
      /燦坤|全國電子|三創|nova|順發|apple\s*store|studio\s*a|小米|xiaomi|良興|迪卡儂/u,
    categoryId: "tech",
  },
  {
    pattern:
      /uniqlo|zara|h&m|lativ|nike|adidas|new balance|asics|net服飾|gu\b|服飾|鞋/u,
    categoryId: "shopping",
  },
  {
    pattern:
      /屈臣氏|康是美|寶雅|小北百貨|大創|daiso|無印良品|muji|ikea|宜家|特力屋|hola|生活工場|日藥本舖|松本清|光南/u,
    categoryId: "shopping",
  },
  {
    pattern: /百貨|新光三越|遠東|sogo|微風|京站|誠品生活/u,
    categoryId: "shopping",
    refineByItems: true,
  },
  // 娛樂：旅遊、電影、遊戲（Steam 等遊戲平台）；學習進修歸其他
  {
    pattern:
      /航空|airlines|長榮|華航|星宇|starlux|虎航|tigerair|agoda|booking\.com|airbnb|klook|kkday|trip\.com|雄獅|可樂旅遊|飯店|酒店|hotel|旅館|民宿|旅行社/u,
    categoryId: "entertainment",
  },
  {
    pattern:
      /威秀|vieshow|影城|秀泰|錢櫃|好樂迪|steam|valve|playstation|nintendo|任天堂|拓元|kktix|年代售票|健身|world gym|遊樂/u,
    categoryId: "entertainment",
  },
  {
    pattern: /補習|課程|hahow|udemy|coursera|書店|金石堂|誠品書店/u,
    categoryId: "misc",
  },
  // 醫療保險
  {
    pattern: /人壽|產險|保險|健保|勞保|保費|insurance/u,
    categoryId: "health",
  },
  {
    pattern: /醫院|診所|牙醫|醫療|掛號|藥局|藥房|杏一|大樹藥局|長庚|榮總|馬偕/u,
    categoryId: "health",
  },
  // 捐款
  {
    pattern: /捐款|基金會|慈濟|家扶|世界展望會|創世|紅十字|donation/u,
    categoryId: "donation",
  },
  // 其他：人情（紅包禮金）
  { pattern: /紅包|禮金|喜宴|奠儀/u, categoryId: "misc" },
  // 其他：稅金、手續費
  {
    pattern: /國稅局|稅務局|牌照稅|燃料稅|所得稅|綜所稅|房屋稅|地價稅|稅款/u,
    categoryId: "misc",
  },
  {
    pattern: /手續費|年費|服務費|遲繳|違約金|循環利息|\bfee\b/u,
    categoryId: "misc",
  },
  // 其他：現金提領（錢的去向未知）。「提款卡」「提款機」本身不是提款。
  {
    pattern: /無卡提款|atm\s*提款|跨行提款|提款(?!卡|機)/u,
    categoryId: "misc",
  },
];

/** 台灣常見發票品項關鍵字 → 分類（比對清理後的品項名稱）。 */
export const ITEM_KEYWORD_RULES: readonly KeywordRule[] = [
  {
    pattern: /悠遊卡加值|一卡通加值|加值|車票|高鐵|台鐵|捷運|客運|票價/u,
    categoryId: "transport",
  },
  {
    pattern: /汽油|無鉛|柴油|停車費|洗車/u,
    categoryId: "transport",
  },
  {
    pattern:
      /拿鐵|美式|咖啡|latte|americano|cappuccino|珍奶|珍珠奶茶|奶茶|紅茶|綠茶|烏龍|青茶|果汁|豆漿|可樂|汽水|茶飲|冰沙|多多|氣泡水|礦泉水|飲料|奶昔|養樂多|檸檬|鮮奶茶|咖啡牛奶/u,
    categoryId: "food",
  },
  {
    pattern:
      /便當|餐盒|飯糰|御飯糰|三明治|漢堡|拉麵|炒飯|燴飯|丼|套餐|鍋|水餃|餃|包子|饅頭|粥|沙拉|壽司|披薩|pizza|雞排|鹹酥雞|關東煮|熱狗|滷味|早餐|午餐|晚餐|小籠包|排餐|義大利麵|咖哩|炸雞|薯條|蛋餅|吐司|貝果|鬆餅|麵包|蛋糕|甜點|布丁|麵$|牛肉麵|湯麵|乾麵|涼麵|燒肉|烤肉|餐$/u,
    categoryId: "food",
  },
  {
    pattern:
      /蔬菜|蔬果|水果|生鮮|豬肉|雞肉|牛肉(?!麵)|雞胸|雞蛋|鮮乳|牛奶|白米|麵條|醬油|沙拉油|調味|豆腐|冷凍|零食|餅乾|洋芋片|泡麵|罐頭|優格|起司|米$|蛋$/u,
    categoryId: "food",
  },
  {
    pattern:
      /衛生紙|面紙|抽取式|廚房紙巾|洗衣|洗碗|清潔|牙膏|牙刷|洗髮|沐浴|衛生棉|尿布|垃圾袋|電池|保鮮|濕紙巾|洗手|乳液|口罩|棉花棒|刮鬍|購物袋|塑膠袋/u,
    categoryId: "shopping",
  },
  {
    pattern:
      /\bssl\b|憑證|\bdomain\b|網域|\bhosting\b|虛擬主機|主機代管|雲端|\bapi\b|訂閱方案|軟體|授權|license/u,
    categoryId: "tech",
  },
  {
    pattern:
      /充電|傳輸線|耳機|滑鼠|鍵盤|記憶卡|隨身碟|行動電源|iphone|ipad|macbook|手機|螢幕|電腦|筆電|硬碟|吹風機|電風扇|家電/u,
    categoryId: "tech",
  },
  {
    pattern: /襪|上衣|長褲|短褲|外套|t恤|帽|鞋|內衣|洋裝|襯衫/u,
    categoryId: "shopping",
  },
  {
    pattern: /藥|維他命|ok繃|掛號費|部分負擔|診察|醫療/u,
    categoryId: "health",
  },
  {
    pattern: /書籍|雜誌|課程|教材|講義/u,
    categoryId: "misc",
  },
  {
    pattern: /電影票|門票|入場|遊戲點數|點數卡/u,
    categoryId: "entertainment",
  },
  { pattern: /電費|水費|瓦斯費/u, categoryId: "housing" },
  { pattern: /電信費|月租費|網路費/u, categoryId: "housing" },
  { pattern: /手續費/u, categoryId: "misc" },
];

const ITEM_SHARE_THRESHOLD = 0.4;

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function appliesTo(rule: KeywordRule, direction: "inflow" | "outflow") {
  return (rule.direction ?? "outflow") === direction;
}

/** 商家名稱關鍵字的比對結果（第一個符合的條目）。 */
export function matchMerchantKeywords(
  text: string | null | undefined,
  direction: "inflow" | "outflow" = "outflow",
) {
  if (!text) return undefined;
  const normalized = normalizedText(text);
  return MERCHANT_KEYWORD_RULES.find(
    (rule) => appliesTo(rule, direction) && rule.pattern.test(normalized),
  );
}

/**
 * 依品項金額加權推測分類；符合關鍵字的品項金額需占可辨識品項金額 40% 以上。
 * 沒有金額的品項以 1 計。
 */
export function suggestCategoryFromItems(items: InvoiceItemLike[]) {
  const totals = new Map<string, number>();
  let total = 0;
  for (const { name, item } of meaningfulInvoiceItems(items)) {
    const weight = item.amount != null && item.amount > 0 ? item.amount : 1;
    total += weight;
    const normalized = normalizedText(name);
    const rule = ITEM_KEYWORD_RULES.find((candidate) =>
      candidate.pattern.test(normalized),
    );
    if (rule)
      totals.set(rule.categoryId, (totals.get(rule.categoryId) ?? 0) + weight);
  }
  let best: { categoryId: string; weight: number } | undefined;
  for (const [categoryId, weight] of totals)
    if (!best || weight > best.weight) best = { categoryId, weight };
  if (!best || total === 0 || best.weight / total < ITEM_SHARE_THRESHOLD)
    return undefined;
  return best.categoryId;
}

export interface CategorySuggestionInput {
  /** 商家名稱與原始文字（顯示名稱、描述、對方、發票賣方）。 */
  texts: Array<string | null | undefined>;
  items?: InvoiceItemLike[];
  /** 同商家過去最常被使用者選的分類。 */
  merchantHistoryCategoryId?: string | null;
  direction?: "inflow" | "outflow";
}

/** 依優先序產生分類建議；都不符合時回傳 undefined。 */
export function suggestCategory(
  input: CategorySuggestionInput,
): CategorySuggestion | undefined {
  if (input.merchantHistoryCategoryId)
    return {
      categoryId: input.merchantHistoryCategoryId,
      source: "merchant_history",
    };
  const direction = input.direction ?? "outflow";
  const text = input.texts.filter(Boolean).join(" ");
  const merchant = matchMerchantKeywords(text, direction);
  if (merchant && !merchant.refineByItems)
    return { categoryId: merchant.categoryId, source: "merchant_keywords" };
  if (direction === "outflow" && input.items?.length) {
    const fromItems = suggestCategoryFromItems(input.items);
    if (fromItems) return { categoryId: fromItems, source: "item_keywords" };
  }
  if (merchant)
    return { categoryId: merchant.categoryId, source: "merchant_keywords" };
  return undefined;
}
