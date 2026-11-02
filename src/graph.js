import { config } from './config.js';

// 일시적인 오류(서버 오류, 호출 한도)는 잠깐 쉬었다가 다시 시도합니다.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GraphError extends Error {
  constructor(message, { status, code, subcode, fbtraceId } = {}) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.fbtraceId = fbtraceId;
  }
  get transient() {
    return this.status >= 500 || TRANSIENT_CODES.has(this.code);
  }
}

async function call(method, path, { token, body, query, retries = 2 } = {}) {
  const url = new URL(`${config.graphBase}/${config.graphVersion}/${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; ; attempt++) {
    let res;
    let data = {};
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      data = await res.json().catch(() => ({}));
    } catch (networkErr) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new GraphError(`네트워크 오류: ${networkErr.message}`, { status: 0 });
    }

    if (res.ok && !data.error) return data;

    const e = data.error || {};
    const err = new GraphError(e.message || `HTTP ${res.status}`, {
      status: res.status,
      code: e.code,
      subcode: e.error_subcode,
      fbtraceId: e.fbtrace_id,
    });
    if (err.transient && attempt < retries) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw err;
  }
}

/** 댓글 작성자에게 비공개 답장(DM)을 보냅니다. 댓글당 1번, 댓글 작성 후 7일 이내만 가능. */
export function sendPrivateReply(commentId, text) {
  return call('POST', `${config.pageId || config.igUserId}/messages`, {
    token: config.pageAccessToken,
    body: { recipient: { comment_id: commentId }, message: { text } },
  });
}

/** 댓글에 좋아요를 누릅니다. (사용자 토큰 + instagram_manage_engagement 권한 필요) */
export function likeComment(commentId) {
  return call('POST', `${config.igUserId}/likes`, {
    token: config.likeAccessToken,
    body: { comment_id: commentId },
  });
}

/** 최근 게시물 목록 (보정 스크립트용) */
export function listRecentMedia(limit = 10) {
  return call('GET', `${config.igUserId}/media`, {
    token: config.pageAccessToken,
    query: { fields: 'id,timestamp,permalink', limit },
  });
}

/** 게시물의 댓글 목록 (보정 스크립트용) */
export function listComments(mediaId, after) {
  return call('GET', `${mediaId}/comments`, {
    token: config.pageAccessToken,
    query: { fields: 'id,text,timestamp,username,from,parent_id', limit: 50, after },
  });
}
