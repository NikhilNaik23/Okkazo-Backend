const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const readEnvDefaultEnabled = () => {
  return normalizeLoose(process.env.ENABLE_MANAGER_AUTOASSIGN || 'true') !== 'false';
};

let enabledOverride = null;
let updatedAt = null;
let updatedByAuthId = null;

const getState = () => {
  const envEnabled = readEnvDefaultEnabled();
  const enabled = enabledOverride === null ? envEnabled : Boolean(enabledOverride);

  return {
    enabled,
    source: enabledOverride === null ? 'env' : 'runtime',
    updatedAt,
    updatedByAuthId,
    envEnabled,
  };
};

const setEnabledOverride = ({ enabled, updatedByAuthId: by } = {}) => {
  enabledOverride = Boolean(enabled);
  updatedAt = new Date();
  updatedByAuthId = by ? String(by) : null;
  return getState();
};

module.exports = {
  getState,
  setEnabledOverride,
};
