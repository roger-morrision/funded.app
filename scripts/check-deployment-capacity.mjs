// Read-only upgrade preflight. Never creates containers or prunes storage.
import { statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GiB = 1024n ** 3n;
export const CAPACITY_THRESHOLDS = Object.freeze({
  build: { freeBytes: 4n * GiB, freeInodes: 10_000n },
  switch: { freeBytes: 2n * GiB, freeInodes: 5_000n },
});
const containerPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const decimal = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);

export function assessCapacity(sample, phase = 'build') {
  const threshold = CAPACITY_THRESHOLDS[phase];
  if (!threshold) throw new Error('Phase must be build or switch.');
  if (!decimal(sample?.freeBytes) || !decimal(sample?.freeInodes)) {
    return { ready: false, reason: 'capacity-unavailable' };
  }
  const reasons = [];
  if (BigInt(sample.freeBytes) < threshold.freeBytes) reasons.push('insufficient-free-bytes');
  if (BigInt(sample.freeInodes) < threshold.freeInodes) reasons.push('insufficient-free-inodes');
  return { ready: reasons.length === 0, reasons, freeBytes: sample.freeBytes, freeInodes: sample.freeInodes };
}

export async function workspaceCapacity(path) {
  const stats = await statfs(path, { bigint: true });
  // bavail excludes blocks unavailable to the nonroot runtime user.
  return { freeBytes: String(stats.bavail * stats.bsize), freeInodes: String(stats.ffree) };
}

export function containerCapacity(container, execute = execFileSync) {
  if (!containerPattern.test(container || '')) throw new Error('Select an existing application container by name or ID.');
  const env = { ...process.env };
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
  const code = "const fs=require('node:fs');const s=fs.statfsSync('/',{bigint:true});console.log(JSON.stringify({freeBytes:String(s.bavail*s.bsize),freeInodes:String(s.ffree)}));";
  const output = execute('docker', ['--host=unix:///var/run/docker.sock', 'exec', container, 'node', '-e', code],
    { env, encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output);
}

export async function deploymentCapacity({ container, workspace = process.cwd(), phase = 'build' },
  { readWorkspace = workspaceCapacity, readContainer = containerCapacity } = {}) {
  const threshold = CAPACITY_THRESHOLDS[phase];
  if (!threshold) throw new Error('Phase must be build or switch.');
  if (!containerPattern.test(container || '')) throw new Error('Select an existing application container by name or ID.');
  const sources = [
    { name: 'workspace', selector: resolve(workspace), read: () => readWorkspace(resolve(workspace)) },
    { name: 'application-container-root', selector: container, read: () => readContainer(container) },
  ];
  const samples = await Promise.all(sources.map(async source => {
    try { return { source: source.name, selector: source.selector, ...assessCapacity(await source.read(), phase) }; }
    catch { return { source: source.name, selector: source.selector, ready: false, reason: 'capacity-unavailable' }; }
  }));
  return { readOnly: true, phase, ready: samples.every(sample => sample.ready),
    minimumFreeBytes: String(threshold.freeBytes), minimumFreeInodes: String(threshold.freeInodes), samples,
    scope: 'workspace-and-existing-container-root; excludes separate volumes, daemon quotas and future writes',
  };
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = { '--container': 'container', '--workspace': 'workspace', '--phase': 'phase' }[args[i]];
    if (!name || !args[i + 1] || options[name] !== undefined) throw new Error('Use --container NAME [--workspace PATH] [--phase build|switch].');
    options[name] = args[i + 1];
  }
  const report = await deploymentCapacity(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
