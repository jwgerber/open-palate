/** Map a pointer x on the slider track to one of the five stops. */
export const valueFromPointer = (clientX, rect) => {
  if (!rect.width) return 1;
  const ratio = (clientX - rect.left) / rect.width;
  return 1 + Math.max(0, Math.min(4, Math.round(ratio * 4)));
};
