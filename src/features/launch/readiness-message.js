export function launchConfigurationBlocked(config) {
  return config?.ready === false && (!config.programId || !config.initialAuthority
    || (Array.isArray(config.reasons) && config.reasons.some(reason => /(?:registration|collection|settlement|worker|route) is disabled|not configured|authority signer is unavailable/i.test(reason))));
}

export function launchReadinessMessage(state) {
  if (state?.configurationBlocked) return 'Launching is not enabled on this site yet. The site operator must finish server setup. You can prepare your token details meanwhile.';
  if (state?.status === 'checking') return 'Checking launch availability…';
  return 'Launch checks could not be completed. Retry checks before signing.';
}
