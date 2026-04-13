const mongoose = require('mongoose');

const PlanningRefundPolicySlabSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    minDays: {
      type: Number,
      default: null,
    },
    maxDays: {
      type: Number,
      default: null,
    },
    deductionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const PlanningRefundPolicyConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    timelineLabel: {
      type: String,
      trim: true,
      default: '5-7 working days',
    },
    slabs: {
      type: [PlanningRefundPolicySlabSchema],
      default: [],
    },
    roundRobinCursor: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedByAuthId: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'planning_refund_policy_config',
  }
);

module.exports = mongoose.model('PlanningRefundPolicyConfig', PlanningRefundPolicyConfigSchema);
