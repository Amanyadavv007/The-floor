import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Cloud sync for The Floor.
// One document per account: { accountNumber, passwordSalt, passwordHash, config, logs, updatedAt }.
// Passwords are hashed+salted in the browser (PBKDF2) before they ever reach this code.

export const createAccount = mutation({
  args: {
    accountNumber: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    config: v.any(),
    logs: v.any(),
  },
  handler: async (ctx, args) => {
    const accountNumber = args.accountNumber.trim();
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_account_number", (q) => q.eq("accountNumber", accountNumber))
      .first();
    if (existing) {
      return { ok: false as const, error: "That account number is already taken." };
    }
    const id = await ctx.db.insert("accounts", {
      accountNumber,
      passwordSalt: args.passwordSalt,
      passwordHash: args.passwordHash,
      config: args.config,
      logs: args.logs,
      updatedAt: Date.now(),
    });
    return { ok: true as const, accountId: id };
  },
});

// Login needs the account's salt to derive the password hash client-side.
// Returning only the salt is safe: it's public by design in PBKDF2 and does
// not let anyone verify a password without doing the hash work themselves.
export const getSalt = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_account_number", (q) => q.eq("accountNumber", args.accountNumber.trim()))
      .first();
    if (!account) {
      return { ok: false as const, error: "No account with that number." };
    }
    return { ok: true as const, salt: account.passwordSalt };
  },
});

export const login = query({
  args: { accountNumber: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_account_number", (q) => q.eq("accountNumber", args.accountNumber.trim()))
      .first();
    if (!account || account.passwordHash !== args.passwordHash) {
      return { ok: false as const, error: "Wrong account number or password." };
    }
    return {
      ok: true as const,
      config: account.config ?? null,
      logs: account.logs ?? null,
      updatedAt: account.updatedAt,
    };
  },
});

// Deletes an account after verifying credentials — used for cleanup or a
// future "delete my account" option. Requires the correct password hash.
export const deleteAccount = mutation({
  args: { accountNumber: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_account_number", (q) => q.eq("accountNumber", args.accountNumber.trim()))
      .first();
    if (!account || account.passwordHash !== args.passwordHash) {
      return { ok: false as const, error: "Not authorized to delete this account." };
    }
    await ctx.db.delete(account._id);
    return { ok: true as const };
  },
});

export const push = mutation({
  args: {
    accountNumber: v.string(),
    passwordHash: v.string(),
    config: v.any(),
    logs: v.any(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_account_number", (q) => q.eq("accountNumber", args.accountNumber.trim()))
      .first();
    if (!account || account.passwordHash !== args.passwordHash) {
      return { ok: false as const, error: "Not signed in — reload and sign in again." };
    }
    await ctx.db.patch(account._id, {
      config: args.config,
      logs: args.logs,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});
