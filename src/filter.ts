// ============================================================
// filter.ts - 过滤引擎: 协调缓存/黑名单/AI, 做最终判定
// ============================================================
import type {
  FilterConfig,
  BiliReply,
  AIVerdict,
  ReplyContext,
  AccumulatedStats,
} from "./types";
import { warn, log } from "./debug";
import {
  isBlacklisted,
  addToBlacklist,
  getCache,
  setCache,
  commentHash,
  shouldSyncToBilibili,
  syncBlockToBilibili,
} from "./db";
import { batchJudge } from "./api";

const TAG = "[ruozhi-filter]";

export interface FilterResult {
  violations: Map<number, { reason: string; severity: AIVerdict["severity"] }>;
  newBlacklistEntries: number;
}

export async function filterReplies(
  config: FilterConfig,
  replies: BiliReply[],
  ctx: ReplyContext,
  stats?: AccumulatedStats,
): Promise<FilterResult> {
  const violations = new Map<
   number,
   { reason: string; severity: AIVerdict["severity"] }
  >();
  let newBlacklistEntries = 0;

  if (replies.length === 0) return { violations, newBlacklistEntries };

  // Step 1: 本地黑名单 + LRU缓存（并行执行，不再逐条 await）
  const needAICheck: BiliReply[] = [];

  const preChecks = await Promise.all(
   replies.map(async (reply) => {
    if (config.enableBlacklist) {
      const blRecord = await isBlacklisted(reply.mid, reply.member.uname);
      if (blRecord) {
       return {
        reply,
        hit: "blacklist" as const,
        reason: `[黑名单] ${blRecord.reason}`,
        severity: blRecord.severity,
       };
      }
    }

    const hash = commentHash(reply.content.message, reply.mid);
    const cached = await getCache(hash);
    if (cached && cached.violation) {
      return {
       reply,
       hit: "cache" as const,
       reason: `[缓存] ${cached.reason}`,
       severity: cached.severity,
      };
    }

    return { reply, hit: null as null };
   }),
  );

  for (const result of preChecks) {
   if (result.hit) {
    violations.set(result.reply.rpid, {
      reason: result.reason,
      severity: result.severity,
    });
    if (stats) {
      stats.totalFiltered++;
      stats.severityCounts[result.severity] =
       (stats.severityCounts[result.severity] ?? 0) + 1;
    }
   } else if (config.enableAI) {
    needAICheck.push(result.reply);
   }
  }

  // Step 2: AI 批量判定
  if (needAICheck.length > 0 && config.enableAI && config.apiKey) {
   try {
    const result = await batchJudge(config, needAICheck, ctx);

    // 累计token
    if (stats && result.usage) {
      stats.totalTokens += result.usage.total_tokens ?? 0;
      stats.promptTokens += result.usage.prompt_tokens ?? 0;
      stats.completionTokens += result.usage.completion_tokens ?? 0;
      stats.apiCalls++;
    }

    for (const v of result.verdicts) {
      const reply = needAICheck.find((r) => r.rpid === v.rpid);
      if (reply) {
       const hash = commentHash(reply.content.message, reply.mid);
       await setCache({
        hash,
        violation: v.violation,
        reason: v.reason,
        severity: v.severity,
        timestamp: Date.now(),
       });
      }

      if (v.violation) {
       violations.set(v.rpid, {
        reason: v.reason,
        severity: v.severity,
       });

       if (stats) {
        stats.totalFiltered++;
        stats.severityCounts[v.severity] =
          (stats.severityCounts[v.severity] ?? 0) + 1;
       }

          // block 或 high 级别自动拉黑
          if ((v.severity === "block" || v.severity === "high") && reply) {
              log(TAG, `Auto-blocking: uid=${v.mid} ${reply.member.uname}`);
              await addToBlacklist({
                  mid: v.mid,
                  uname: reply.member.uname,
                  rpid: v.rpid,
                  message: reply.content.message,
                  reason: v.reason,
                  videoTitle: ctx.videoTitle,
                  videoUrl: window.location.href,
                  timestamp: Date.now(),
                  severity: v.severity,
                  source: "auto",
              });
              newBlacklistEntries++;
          }

          // 同步拉黑到 B站（根据配置，独立于本地黑名单逻辑）
          if (reply && reply.mid > 0 && shouldSyncToBilibili(v.severity, "auto")) {
              syncBlockToBilibili(reply.mid).catch(() => { });
          }
      }
    }
   } catch (err) {
    console.error(TAG, "AI judgment failed:", err);
   }
  } else if (needAICheck.length > 0 && !config.apiKey) {
   warn(TAG, "No API key configured，跳过 AI 判定");
  }

  if (stats) stats.lastUpdate = Date.now();
  return { violations, newBlacklistEntries };
}
