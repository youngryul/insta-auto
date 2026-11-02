import { config } from './config.js';
import { store } from './store.js';
import { sendPrivateReply, likeComment } from './graph.js';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const inFlight = new Set();

const log = (icon, id, msg) => console.log(`${new Date().toISOString()} ${icon} [${id}] ${msg}`);

/** 웹훅/조회 결과를 공통 형태로 바꿉니다. */
export function normalizeComment(v = {}) {
  return {
    id: v.id || v.comment_id,
    text: v.text || '',
    fromId: v.from?.id,
    username: v.from?.username || v.username || '',
    mediaId: v.media?.id || v.media_id,
    parentId: v.parent_id,
    timestamp: v.timestamp,
  };
}

/** 이 댓글을 처리해야 하는지 판단. 처리 안 하면 이유를 반환 */
function skipReason(c) {
  if (!c.id) return '댓글 ID 없음';
  if (c.fromId && c.fromId === config.igUserId) return '내 계정이 단 댓글';
  if (c.parentId && !config.includeReplies) return '대댓글';
  if (config.targetMediaIds.length && !config.targetMediaIds.includes(c.mediaId)) return '대상 게시물 아님';
  if (config.keywords.length) {
    const t = c.text.toLowerCase();
    if (!config.keywords.some((k) => t.includes(k))) return '키워드 없음';
  }
  if (c.timestamp && Date.now() - new Date(c.timestamp).getTime() > SEVEN_DAYS) return '7일 지난 댓글';
  return null;
}

/**
 * 댓글 하나 처리: DM 전송 → 성공하면 좋아요.
 * DM이 실패하면 좋아요를 누르지 않으므로, 인스타 앱에서 "좋아요 없는 댓글 = 아직 DM 안 간 댓글"로 구분됩니다.
 */
export async function handleComment(raw) {
  const c = normalizeComment(raw);
  const reason = skipReason(c);
  if (reason) {
    if (c.id) log('⏭️ ', c.id, `건너뜀: ${reason}`);
    return { skipped: reason };
  }

  const rec = store.get(c.id);
  if (rec?.status === 'done') return { skipped: '이미 처리됨' };
  if (inFlight.has(c.id)) return { skipped: '처리 중' };
  inFlight.add(c.id);

  const base = { username: c.username, mediaId: c.mediaId, text: c.text.slice(0, 200) };

  try {
    // 1) DM (비공개 답장) — 댓글당 한 번만 가능하므로 이미 보냈으면 다시 보내지 않음
    if (!rec?.dmSentAt) {
      const text = config.dmMessage.replaceAll('{username}', c.username || '');
      if (config.dryRun) {
        log('🧪', c.id, `(DRY_RUN) DM 보냈다고 가정: ${text.split('\n')[0]}`);
      } else {
        const r = await sendPrivateReply(c.id, text);
        store.update(c.id, { ...base, dmSentAt: new Date().toISOString(), messageId: r.message_id });
        log('✉️ ', c.id, `DM 전송 완료 → @${c.username}`);
      }
    }

    // 2) 좋아요 — DM이 성공한 댓글에만
    if (config.dryRun) {
      log('🧪', c.id, '(DRY_RUN) 좋아요 눌렀다고 가정');
      return { dryRun: true };
    }
    await likeComment(c.id);
    store.update(c.id, { ...base, status: 'done', likedAt: new Date().toISOString(), error: null });
    log('❤️ ', c.id, '좋아요 완료');
    return { done: true };
  } catch (e) {
    const stage = store.get(c.id)?.dmSentAt ? 'like' : 'dm';
    store.update(c.id, {
      ...base,
      status: 'error',
      error: { stage, message: e.message, code: e.code, subcode: e.subcode, at: new Date().toISOString() },
    });
    log('❌', c.id, `${stage === 'dm' ? 'DM' : '좋아요'} 실패: ${e.message} (code ${e.code ?? '-'})`);
    return { error: e.message, stage };
  } finally {
    inFlight.delete(c.id);
  }
}

/** 웹훅 본문에서 댓글 이벤트만 뽑아냅니다. (Facebook 로그인 / Instagram 로그인 형식 둘 다 지원) */
export function extractComments(body) {
  const out = [];
  if (body?.object !== 'instagram') return out;
  for (const entry of body.entry || []) {
    const changes = entry.changes || (entry.field ? [{ field: entry.field, value: entry.value }] : []);
    for (const ch of changes) {
      if (ch.field === 'comments' && ch.value) out.push(ch.value);
    }
  }
  return out;
}
