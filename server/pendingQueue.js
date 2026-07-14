// Photos captured on a phone but not yet signed and sent to the wall.
// Pure list management: no disk or socket I/O, so the caller owns image files
// and broadcasts. Oldest-first — the signing station always works on items[0].

export const DEFAULT_MAX_PENDING = 50;

export const sanitizePending = (record) => ({
  id: record.id,
  imageUrl: record.imageUrl,
  timestamp: record.timestamp,
  rotation: record.rotation,
});

export const createPendingQueue = ({ maxPending = DEFAULT_MAX_PENDING } = {}) => {
  let items = [];

  return {
    size: () => items.length,
    isFull: () => items.length >= maxPending,
    list: () => [...items],

    add: (record) => {
      if (items.length >= maxPending) return false;
      items.push(record);
      return true;
    },

    remove: (id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const [removed] = items.splice(index, 1);
      return removed;
    },

    skip: (id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const [moved] = items.splice(index, 1);
      items.push(moved);
      return moved;
    },
  };
};
