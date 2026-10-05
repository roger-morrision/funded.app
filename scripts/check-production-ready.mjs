#!/usr/bin/env node
import { validateRuntimeEnv, getSafeEnvSnapshot } from './src/lib/env.js';

const snapshot = getSafeEnvSnapshot(process.env);

try {
  const config = validateRuntimeEnv(process.env);
  console.log('Production readiness validation passed');
  console.log(JSON.stringify({ config, snapshot }, null, 2));
} catch (error) {
  console.error('Production readiness validation failed');
  console.error(error.message);
  process.exit(1);
}
