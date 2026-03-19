'use strict';

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

class RoundRobinCursorStore {
  constructor({ redis, keyPrefix } = {}) {
    this.redis = redis || null;
    this.keyPrefix = String(keyPrefix || '').trim() || 'event-service:manager-autoassign:rr';
    this.memory = new Map();
  }

  _key(deptKey) {
    return `${this.keyPrefix}:${normalizeLoose(deptKey)}`;
  }

  async getCursor(deptKey) {
    const normalized = normalizeLoose(deptKey);
    if (!normalized) return 0;

    if (this.redis) {
      const raw = await this.redis.get(this._key(normalized));
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
    }

    const existing = this.memory.get(normalized);
    return Number.isFinite(existing) && existing >= 0 ? existing : 0;
  }

  async setCursor(deptKey, cursor) {
    const normalized = normalizeLoose(deptKey);
    if (!normalized) return;

    const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;

    if (this.redis) {
      await this.redis.set(this._key(normalized), String(safeCursor));
      return;
    }

    this.memory.set(normalized, safeCursor);
  }
}

module.exports = {
  RoundRobinCursorStore,
};
