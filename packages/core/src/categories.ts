/**
 * 消費分類（9 個頂層，沒有子類）。分類只描述「錢花在哪」；收入、轉到自己帳戶、投資與
 * 繳卡費由經濟角色（economic-role.ts）表達，不是分類。收入另有少量子類（income.*），
 * 只在收入角色使用，不出現在消費分類選單。
 *
 * 2026-09 使用者回饋「分類太多太細，不知道選哪個」：0067 把舊的兩層分類（food.*、
 * transport.*、lifestyle.*、social.*、fees.* 等）併成下列 8 類：
 * 餐飲、交通、居住、購物、3C 數位、娛樂、醫療保險、其他（人情、稅、手續費、學習等），
 * 並依使用者要求另加「捐款」（定期捐款不再混在其他）。「捐款」在 0067 建立，舊的
 * social.donations 直接對到 donation；0069 為冪等補齊（撞名的自訂分類加註、慈善機構
 * 商家規則由「其他」改為「捐款」）。使用者自訂分類（user:*）保留，不併入系統分類。
 *
 * id 是穩定契約：資料庫 `classification_categories`、覆寫、規則與商家規則都以
 * 這些 id 參照，改名只改 label，不改 id。
 *
 * 顏色依實體固定（不依排名）：八個有色消費分類依序使用經 CVD 驗證的類別色板 8 色
 * （validate_palette：淺色相鄰 ΔE 9.1、深色 8.4）。「其他」「未分類」與收入使用中性灰，
 * 必須搭配文字標籤。
 */

export type CategoryKind = "spending" | "income" | "uncategorized";

export interface CategoryColor {
  light: string;
  dark: string;
  /** 中性灰（不在類別色板內），圖表需以文字標籤辨識。 */
  neutral?: true;
}

export interface CategoryDefinition {
  id: string;
  label: string;
  emoji: string;
  parentId: string | null;
  kind: CategoryKind;
  color: CategoryColor;
  sortOrder: number;
}

/** 沒有任何分類的消費。沿用舊版的 `other`（標籤「未分類」），不是「其他」。 */
export const UNCATEGORIZED_CATEGORY_ID = "other";
/** 「其他」消費：使用者明確歸入，或舊分類遷移時對應不到的項目。 */
export const MISC_CATEGORY_ID = "misc";
export const INCOME_CATEGORY_ID = "income";

interface TreeNode {
  id: string;
  label: string;
  emoji: string;
  color?: CategoryColor;
  children?: Array<{ id: string; label: string; emoji: string }>;
}

const NEUTRAL_MISC: CategoryColor = {
  light: "#8f8e89",
  dark: "#8f8e89",
  neutral: true,
};
const NEUTRAL_UNCATEGORIZED: CategoryColor = {
  light: "#c3c2b7",
  dark: "#52514e",
  neutral: true,
};
const NEUTRAL_INCOME: CategoryColor = {
  light: "#52514e",
  dark: "#c3c2b7",
  neutral: true,
};

const SPENDING_TREE: TreeNode[] = [
  {
    id: "food",
    label: "餐飲",
    emoji: "🍜",
    color: { light: "#2a78d6", dark: "#3987e5" },
  },
  {
    id: "transport",
    label: "交通",
    emoji: "🚇",
    color: { light: "#eb6834", dark: "#d95926" },
  },
  {
    id: "housing",
    label: "居住",
    emoji: "🏠",
    color: { light: "#1baf7a", dark: "#199e70" },
  },
  {
    id: "shopping",
    label: "購物",
    emoji: "🛍️",
    color: { light: "#eda100", dark: "#c98500" },
  },
  {
    id: "tech",
    label: "3C 數位",
    emoji: "💻",
    color: { light: "#e87ba4", dark: "#d55181" },
  },
  {
    id: "entertainment",
    label: "娛樂",
    emoji: "🎬",
    color: { light: "#008300", dark: "#008300" },
  },
  {
    id: "health",
    label: "醫療保險",
    emoji: "🩺",
    color: { light: "#4a3aa7", dark: "#9085e9" },
  },
  {
    id: "donation",
    label: "捐款",
    emoji: "🙏",
    color: { light: "#e34948", dark: "#e66767" },
  },
  { id: MISC_CATEGORY_ID, label: "其他", emoji: "📌", color: NEUTRAL_MISC },
];

const INCOME_TREE: TreeNode = {
  id: INCOME_CATEGORY_ID,
  label: "收入",
  emoji: "💰",
  color: NEUTRAL_INCOME,
  children: [
    { id: "income.salary", label: "薪資", emoji: "💼" },
    { id: "income.investment", label: "股利利息", emoji: "📈" },
    { id: "income.other", label: "其他收入", emoji: "🪙" },
  ],
};

function flatten(tree: TreeNode[], kind: CategoryKind, start: number) {
  const result: CategoryDefinition[] = [];
  let order = start;
  for (const node of tree) {
    const color = node.color ?? NEUTRAL_MISC;
    result.push({
      id: node.id,
      label: node.label,
      emoji: node.emoji,
      parentId: null,
      kind,
      color,
      sortOrder: order++,
    });
    for (const child of node.children ?? [])
      result.push({
        ...child,
        parentId: node.id,
        kind,
        color,
        sortOrder: order++,
      });
  }
  return result;
}

/** 全部系統分類（消費、收入與「未分類」），依顯示順序排列。 */
export const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  ...flatten(SPENDING_TREE, "spending", 1),
  ...flatten([INCOME_TREE], "income", 100),
  {
    id: UNCATEGORIZED_CATEGORY_ID,
    label: "未分類",
    emoji: "❔",
    parentId: null,
    kind: "uncategorized",
    color: NEUTRAL_UNCATEGORIZED,
    sortOrder: 200,
  },
];

const CATEGORY_BY_ID = new Map(
  CATEGORY_DEFINITIONS.map((category) => [category.id, category]),
);

export function getCategoryDefinition(id: string | null | undefined) {
  return id ? CATEGORY_BY_ID.get(id) : undefined;
}

/** 系統頂層消費分類 id，依固定色板順序。 */
export const SPENDING_TOP_LEVEL_CATEGORY_IDS: readonly string[] =
  CATEGORY_DEFINITIONS.filter(
    (category) => category.kind === "spending" && category.parentId === null,
  ).map((category) => category.id);

/**
 * 分類所屬的頂層 id。使用者自訂分類（`user:*`）與未知 id 歸入「其他」；
 * 未提供分類歸入「未分類」。
 */
export function topLevelCategoryId(id: string | null | undefined) {
  if (!id || id === UNCATEGORIZED_CATEGORY_ID) return UNCATEGORIZED_CATEGORY_ID;
  const definition = CATEGORY_BY_ID.get(id);
  if (!definition) return MISC_CATEGORY_ID;
  return definition.parentId ?? definition.id;
}

export function isUncategorizedCategoryId(id: string | null | undefined) {
  return !id || id === UNCATEGORIZED_CATEGORY_ID;
}

export function isIncomeCategoryId(id: string | null | undefined) {
  return topLevelCategoryId(id) === INCOME_CATEGORY_ID;
}

/** 系統分類的顯示名稱（子類只回傳子類名稱）；使用者自訂分類回傳 undefined。 */
export function categoryLabel(id: string | null | undefined) {
  return getCategoryDefinition(id)?.label;
}
