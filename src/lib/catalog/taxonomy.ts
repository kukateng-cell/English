export const CATALOG_TAXONOMY_VERSION = "catalog-taxonomy-v1" as const;

export const CATALOG_CATEGORIES = [
  "people-family",
  "time-calendar",
  "numbers-quantity",
  "body-health",
  "food-drink",
  "clothing-appearance",
  "home-household",
  "school-education",
  "work-business",
  "places-community",
  "travel-transport",
  "nature-weather",
  "animals-plants",
  "sports-leisure",
  "arts-culture-media",
  "technology",
  "science-mathematics",
  "society-law-politics",
  "emotions-personality",
  "communication-language",
  "actions-events",
  "descriptions-qualities",
  "abstract-concepts",
  "function-words",
  "other",
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const CATALOG_CATEGORY_ORDER: Record<string, readonly string[]> = {
  A1: CATALOG_CATEGORIES,
  A2: CATALOG_CATEGORIES,
  B1: CATALOG_CATEGORIES,
  B2: CATALOG_CATEGORIES,
};

export function isCatalogCategory(value: string): value is CatalogCategory {
  return (CATALOG_CATEGORIES as readonly string[]).includes(value);
}
