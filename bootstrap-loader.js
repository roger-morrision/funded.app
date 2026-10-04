// Keep module order: later presentation modules can extend earlier markup.
// A failed optional panel must not prevent unrelated routes from initializing.
export async function loadBootstrapModules(modules, onFailure = () => {}) {
  const failures = [];
  for (const { name, load, required = false } of modules) {
    try { await load(); }
    catch (error) {
      const failure = { name, required, error };
      failures.push(failure);
      onFailure(failure);
      if (required) break;
    }
  }
  return failures;
}
