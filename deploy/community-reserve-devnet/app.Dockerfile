FROM fundedapp-app:wolf-ui-20261001a
USER root
COPY deploy/community-reserve-devnet/patch-index.mjs /tmp/patch-community-index.mjs
RUN node /tmp/patch-community-index.mjs && node --check /app/server/index.mjs
COPY --chown=node:node server/mint-router-payout.mjs /app/server/mint-router-payout.mjs
COPY --chown=node:node server/automatic-reward-chain.mjs /app/server/automatic-reward-chain.mjs
COPY --chown=node:node server/reward-funding-processor.mjs /app/server/reward-funding-processor.mjs
COPY --chown=node:node server/reward-experience.mjs /app/server/reward-experience.mjs
COPY --chown=node:node server/coin-fee-overview.mjs /app/server/coin-fee-overview.mjs
COPY --chown=node:node distribution-policy.js /app/distribution-policy.js
USER node
