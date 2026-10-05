import { readFile } from 'node:fs/promises';
import { createXPublisher } from '../server/x-post-client.mjs';

async function secret(name) {
  if (process.env[name]) return process.env[name];
  const file = process.env[`${name}_FILE`];
  return file ? (await readFile(file, 'utf8')).trim() : '';
}

try {
  const oauth1 = {
    apiKey: await secret('X_POST_API_KEY'), apiSecret: await secret('X_POST_API_SECRET'),
    accessToken: await secret('X_POST_ACCESS_TOKEN'), accessTokenSecret: await secret('X_POST_ACCESS_TOKEN_SECRET'),
  };
  const publisher = createXPublisher({ oauth1, expectedHandle: process.env.X_POST_EXPECTED_HANDLE || 'fundedvip',
    expectedAccountId: process.env.X_POST_ACCOUNT_ID || undefined });
  const account = await publisher.verifyAccount();
  console.log(JSON.stringify({ verified: true, account }));
} catch (error) {
  console.error(JSON.stringify({ verified: false, status: error.status || null, reason: error.message }));
  process.exitCode = 1;
}
