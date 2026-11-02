import crypto from 'node:crypto';
import http from 'node:http';
import { config, validateConfig } from './src/config.js';
import { store } from './src/store.js';
import { extractComments, handleComment } from './src/processor.js';

validateConfig();

// 좋아요는 5초에 50번을 넘기면 1시간 잠기므로, 웹훅이 몰려도 한 건씩 간격을 두고 처리합니다.
const COMMENT_GAP_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queue = Promise.resolve();

/** Meta가 보낸 요청이 맞는지 X-Hub-Signature-256 헤더로 확인 */
function isValidSignature(header, rawBody) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(header.slice(7), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('본문이 너무 큽니다'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const send = (res, status, body = '', type = 'text/plain') => {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // 1) 웹훅 등록 확인 (Meta 대시보드에서 "확인 및 저장" 누를 때 호출됨)
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const q = url.searchParams;
    if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === config.verifyToken) {
      console.log('✅ 웹훅 등록 확인 완료');
      return send(res, 200, q.get('hub.challenge') || '');
    }
    return send(res, 403, 'Forbidden');
  }

  // 2) 댓글 이벤트 수신
  if (req.method === 'POST' && url.pathname === '/webhook') {
    let raw;
    try {
      raw = await readBody(req);
    } catch {
      return send(res, 413, 'Too Large');
    }
    if (!isValidSignature(req.headers['x-hub-signature-256'], raw)) {
      console.warn('🚫 서명이 맞지 않는 요청을 거부했습니다');
      return send(res, 403, 'Forbidden');
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, 'Bad JSON');
    }
    // Meta는 빨리 200을 받지 못하면 재전송하므로 먼저 응답하고 처리는 뒤에서
    send(res, 200, 'EVENT_RECEIVED');

    const comments = extractComments(body);
    queue = queue
      .then(async () => {
        for (const c of comments) {
          const r = await handleComment(c);
          if (!r.skipped) await sleep(COMMENT_GAP_MS);
        }
      })
      .catch((e) => console.error('❌ 처리 중 예외:', e));
    return;
  }

  // 3) 상태 확인
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, JSON.stringify({ ok: true, dryRun: config.dryRun, stats: store.stats() }), 'application/json');
  }

  send(res, 404, 'Not Found');
});

server.listen(config.port, () => {
  console.log(`🚀 서버 시작: http://localhost:${config.port}  (웹훅 경로: /webhook)`);
  if (config.dryRun) console.log('🧪 DRY_RUN 모드: 실제 DM/좋아요는 보내지 않습니다');
  if (config.keywords.length) console.log(`🔑 키워드: ${config.keywords.join(', ')}`);
  if (config.targetMediaIds.length) console.log(`🎯 대상 게시물: ${config.targetMediaIds.join(', ')}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await store.flush();
    process.exit(0);
  });
}
