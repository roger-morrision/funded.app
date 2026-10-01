# Devnet-only overlay on the exact public image that preceded the reward UI.
# A Mainnet release must be built from a reconciled source tree and audited programs.
FROM fundedapp-app@sha256:94b30bd5611d2844296c78d038a6ccf038b7d5b03b2d4629bfe3f0192b2a04b7 AS build
USER root
WORKDIR /app
RUN NODE_ENV=development npm ci
COPY reward-experience-ui.js reward-experience.css ./
COPY server/reward-experience.mjs ./server/
COPY server/pump-fee-collection.mjs server/coin-fee-overview.mjs ./server/
COPY server/wrapped-sol-recovery-receipt.mjs server/receipt-evidence.mjs ./server/
COPY server/index.mjs ./scripts/recovery-index-patch-source.mjs
COPY deploy/reward-experience-devnet/apply-patch.mjs ./scripts/apply-reward-image-patch.mjs
RUN node scripts/apply-reward-image-patch.mjs
ARG VITE_API_BASE_URL=/
ARG VITE_SOLANA_CLUSTER=devnet
ARG VITE_EXPLORE_CLUSTER=devnet
ARG VITE_ALLOW_MAINNET=false
ARG VITE_DEV_MODE=false
ARG VITE_DEV_AUTOCONNECT=false
ARG VITE_DEV_WALLET_ROLE=creator
ARG VITE_FUNDED_FEE_ROUTER_PROGRAM_ID
ARG VITE_FUNDED_TRADE_FEE_OWNER
ARG VITE_FUNDED_TOKEN_MINT
ARG VITE_FUNDED_SWAP_POOL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SOLANA_CLUSTER=$VITE_SOLANA_CLUSTER \
    VITE_EXPLORE_CLUSTER=$VITE_EXPLORE_CLUSTER \
    VITE_ALLOW_MAINNET=$VITE_ALLOW_MAINNET \
    VITE_DEV_MODE=$VITE_DEV_MODE \
    VITE_DEV_AUTOCONNECT=$VITE_DEV_AUTOCONNECT \
    VITE_DEV_WALLET_ROLE=$VITE_DEV_WALLET_ROLE \
    VITE_FUNDED_FEE_ROUTER_PROGRAM_ID=$VITE_FUNDED_FEE_ROUTER_PROGRAM_ID \
    VITE_FUNDED_TRADE_FEE_OWNER=$VITE_FUNDED_TRADE_FEE_OWNER \
    VITE_FUNDED_TOKEN_MINT=$VITE_FUNDED_TOKEN_MINT \
    VITE_FUNDED_SWAP_POOL=$VITE_FUNDED_SWAP_POOL
RUN test "$VITE_SOLANA_CLUSTER" = devnet && test "$VITE_ALLOW_MAINNET" = false && npm run build

FROM fundedapp-app@sha256:94b30bd5611d2844296c78d038a6ccf038b7d5b03b2d4629bfe3f0192b2a04b7
COPY --from=build /app/dist /app/dist
COPY --from=build /app/bootstrap.js /app/bootstrap.js
COPY --from=build /app/server/index.mjs /app/server/index.mjs
COPY --from=build /app/server/reward-experience.mjs /app/server/reward-experience.mjs
COPY --from=build /app/server/pump-fee-collection.mjs /app/server/pump-fee-collection.mjs
COPY --from=build /app/server/coin-fee-overview.mjs /app/server/coin-fee-overview.mjs
COPY --from=build /app/server/wrapped-sol-recovery-receipt.mjs /app/server/wrapped-sol-recovery-receipt.mjs
COPY --from=build /app/server/receipt-evidence.mjs /app/server/receipt-evidence.mjs
COPY --from=build /app/reward-experience-ui.js /app/reward-experience-ui.js
COPY --from=build /app/reward-experience.css /app/reward-experience.css
