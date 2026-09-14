import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  accounts: defineTable({
    accountNumber: v.string(),
    passwordSalt: v.string(),
    passwordHash: v.string(),
    config: v.optional(v.any()),
    logs: v.optional(v.any()),
    updatedAt: v.number(),
  }).index("by_account_number", ["accountNumber"]),
});
