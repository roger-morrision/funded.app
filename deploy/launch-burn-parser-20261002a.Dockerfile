FROM fundedapp-app:home-x-claim-totals-20261002a
COPY --chown=node:node server/launch-verification.mjs /app/server/launch-verification.mjs
