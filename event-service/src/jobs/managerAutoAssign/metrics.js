'use strict';

const createJobMetrics = () => {
  const counters = {
    startedAt: new Date(),
    promote: {
      candidatesFetched: 0,
      assigned: 0,
      skippedNoManager: 0,
      skippedAlreadyAssigned: 0,
      failed: 0,
    },
    planning: {
      candidatesFetched: 0,
      assigned: 0,
      skippedNoManager: 0,
      skippedAlreadyAssigned: 0,
      failed: 0,
    },
    lock: {
      acquired: false,
      skipped: false,
      errors: 0,
    },
    managerCache: {
      hit: false,
      miss: false,
      errors: 0,
    },
  };

  const finish = () => {
    const finishedAt = new Date();
    return {
      ...counters,
      finishedAt,
      durationMs: finishedAt.getTime() - counters.startedAt.getTime(),
    };
  };

  return {
    counters,
    finish,
  };
};

module.exports = {
  createJobMetrics,
};
