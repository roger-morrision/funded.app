const runtimes = new WeakMap();

// One private context per application instance. Accessors retain live bindings
// across async operations and reject reads before lexical initialization.
export function createAppRuntime(dependencies, schema) {
  const appState = Object.create(null);
  const cells = new Map();
  for (const [name, value] of Object.entries(dependencies)) {
    Object.defineProperty(appState, name, { value, enumerable: true });
  }
  for (const [name, kind] of Object.entries(schema)) {
    if (Object.hasOwn(appState, name)) throw new Error(`Duplicate app binding: ${name}`);
    const cell = { kind, ready: kind === 'var', value: undefined };
    cells.set(name, cell);
    Object.defineProperty(appState, name, {
      enumerable: true,
      get() {
        if (!cell.ready) throw new ReferenceError(`Cannot access '${name}' before initialization`);
        return cell.value;
      },
      set(value) {
        if (!cell.ready) throw new ReferenceError(`Cannot access '${name}' before initialization`);
        if (cell.kind === 'const') throw new TypeError(`Assignment to constant app binding '${name}'`);
        cell.value = value;
      },
    });
  }
  runtimes.set(appState, cells);
  return appState;
}

export function initializeAppState(appState, name, value) {
  const cell = runtimes.get(appState)?.get(name);
  if (!cell) throw new Error(`Unknown app binding: ${name}`);
  if (cell.ready && cell.kind !== 'var') throw new Error(`App binding already initialized: ${name}`);
  cell.value = value;
  cell.ready = true;
}
