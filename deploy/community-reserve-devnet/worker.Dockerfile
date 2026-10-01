FROM fundedapp-app:qa-reward-pool-exclusion-v2-20261001
COPY --chown=node:node server/mint-router-payout.mjs /app/server/mint-router-payout.mjs
COPY --chown=node:node server/automatic-reward-chain.mjs /app/server/automatic-reward-chain.mjs
COPY --chown=node:node server/reward-funding-processor.mjs /app/server/reward-funding-processor.mjs
COPY --chown=node:node scripts/verify-community-sol-reserve-devnet.mjs /app/scripts/verify-community-sol-reserve-devnet.mjs
