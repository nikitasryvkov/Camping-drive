export const MAX_BUILDER_PAYLOAD_BYTES: number;
export const MAX_PAGE_BLOCKS: number;
export const MAX_PAGE_COLLECTION_ITEMS: number;
export const MAX_PAGE_CONTENT_BYTES: number;

export type PageBudgetViolation =
  | { kind: "blocks"; actual: number; limit: number }
  | { kind: "items"; actual: number; limit: number }
  | { kind: "contentBytes"; actual: number; limit: number };

export function getPageBudgetViolation(
  blocks: ReadonlyArray<{ content: Record<string, unknown> }>,
): PageBudgetViolation | undefined;
