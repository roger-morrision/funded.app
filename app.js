import { appDependencies } from './src/app/dependencies.js';
import { createAppRuntime } from './src/app/runtime.js';
import { appStateSchema } from './src/app/state-schema.js';
import { registerAppControllers } from './src/app/controllers.js';
import { startApp } from './src/app/start.js';

const appState = createAppRuntime(appDependencies, appStateSchema);
registerAppControllers(appState);
await startApp(appState);
