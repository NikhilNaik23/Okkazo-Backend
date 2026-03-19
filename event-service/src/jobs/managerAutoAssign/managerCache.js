'use strict';

const logger = require('../../utils/logger');
const { fetchActiveManagers } = require('../../services/userServiceClient');

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const isAssignedRoleEligible = (assignedRole) => {
  if (!assignedRole) return false;
  const role = normalizeLoose(assignedRole);
  return role.includes('junior') || role.includes('senior');
};

const extractManagerId = (manager) => {
  const id = manager?._id || manager?.id;
  return id ? String(id) : null;
};

class ManagerCache {
  constructor({ ttlMs, fetchLimit }) {
    this.ttlMs = ttlMs;
    this.fetchLimit = fetchLimit;
    this._snapshot = null;
    this._inflight = null;
  }

  _isFresh() {
    if (!this._snapshot) return false;
    return Date.now() - this._snapshot.fetchedAtMs < this.ttlMs;
  }

  async getEligibleManagerBuckets({ forceRefresh = false } = {}) {
    if (!forceRefresh && this._isFresh()) {
      return { buckets: this._snapshot.buckets, fromCache: true };
    }

    if (this._inflight) {
      try {
        const buckets = await this._inflight;
        return { buckets, fromCache: true };
      } catch (err) {
        this._inflight = null;
        throw err;
      }
    }

    this._inflight = (async () => {
      const managers = await fetchActiveManagers({ limit: this.fetchLimit });
      const buckets = new Map();

      for (const manager of managers || []) {
        if (normalizeLoose(manager?.role) !== 'manager') continue;
        if (manager?.isActive === false) continue;
        if (!isAssignedRoleEligible(manager?.assignedRole)) continue;

        const managerId = extractManagerId(manager);
        if (!managerId) continue;

        const deptKey = normalizeLoose(manager?.department);
        if (!deptKey) continue;

        if (!buckets.has(deptKey)) buckets.set(deptKey, []);
        buckets.get(deptKey).push(managerId);
      }

      // Stabilize order so round-robin and tie-breaking is deterministic.
      for (const [deptKey, ids] of buckets) {
        buckets.set(deptKey, Array.from(new Set(ids)).sort());
      }

      this._snapshot = {
        fetchedAtMs: Date.now(),
        buckets,
      };

      return buckets;
    })();

    try {
      const buckets = await this._inflight;
      return { buckets, fromCache: false };
    } catch (err) {
      logger.warn(`ManagerCache refresh failed: ${err.message}`);
      throw err;
    } finally {
      this._inflight = null;
    }
  }
}

module.exports = {
  ManagerCache,
};
