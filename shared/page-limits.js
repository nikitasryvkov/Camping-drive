export const MAX_BUILDER_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_BLOCKS = 60;
export const MAX_PAGE_COLLECTION_ITEMS = 300;
export const MAX_PAGE_CONTENT_BYTES = 512 * 1024;

export function getPageBudgetViolation(blocks) {
  if (blocks.length > MAX_PAGE_BLOCKS) {
    return { kind: "blocks", actual: blocks.length, limit: MAX_PAGE_BLOCKS };
  }

  const contentBytes = new TextEncoder()
    .encode(JSON.stringify(blocks.map((block) => block.content)))
    .byteLength;
  if (contentBytes > MAX_PAGE_CONTENT_BYTES) {
    return { kind: "contentBytes", actual: contentBytes, limit: MAX_PAGE_CONTENT_BYTES };
  }

  const itemCount = blocks.reduce(
    (total, block) => total + countCollectionItems(block.content),
    0,
  );
  if (itemCount > MAX_PAGE_COLLECTION_ITEMS) {
    return { kind: "items", actual: itemCount, limit: MAX_PAGE_COLLECTION_ITEMS };
  }

  return undefined;
}

function countCollectionItems(value) {
  if (Array.isArray(value)) {
    return value.length + value.reduce((total, item) => total + countCollectionItems(item), 0);
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  return Object.values(value).reduce(
    (total, item) => total + countCollectionItems(item),
    0,
  );
}
