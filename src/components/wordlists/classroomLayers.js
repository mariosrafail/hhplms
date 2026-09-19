// Only open, mounted frame layers register. Android Back uses the same close
// operation as Escape/X; no second permanent global back listener is installed.
const layers = new Map();
export function registerClassroomLayer(frame, close) {
  const token = Symbol(); layers.set(token, { frame, close });
  return () => layers.delete(token);
}
export function consumeClassroomBack(frame = null) {
  const layer = [...layers.values()].reverse().find((entry) => entry.frame?.isConnected && (!frame || entry.frame === frame));
  if (!layer) return false;
  layer.close(); return true;
}
