const mongoose = require('mongoose');

const PromoteConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
    },
    serviceChargePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    normalDayMinMultiplier: {
      type: Number,
      required: true,
      min: 0.01,
      default: 1,
    },
    normalDayMaxMultiplier: {
      type: Number,
      required: true,
      min: 0.01,
      default: 1,
    },
    highDemandMinMultiplier: {
      type: Number,
      required: true,
      min: 0.01,
      default: 1.5,
    },
    highDemandMaxMultiplier: {
      type: Number,
      required: true,
      min: 0.01,
      default: 2.25,
    },
    updatedByAuthId: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'promote_config',
  }
);

module.exports = mongoose.model('PromoteConfig', PromoteConfigSchema);
