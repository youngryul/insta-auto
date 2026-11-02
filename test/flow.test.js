import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';

const APP_SECRET = 'test-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 가짜 Graph API: 호출을 기록하고, failOn 에 지정된 경로는 권한 오류로 응답
const graph = { calls: [], failOn: new Set(), server: null, port: 0 };
let child;
let tmpDir;

before(async () => {
  graph.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const endpoint = req.url.split('/').pop();
      graph.calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      res.writeHead(graph.failOn.has(endpoint) ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          graph.failOn.has(endpoint) ? { error: { message: 'denied', code: 10 } } : { message_id: 'm1', success: true },
        ),
      );
    });
  });
  await new Promise((r) => graph.server.listen(0, r));
  graph.port = graph.server.address().port;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insta-dm-'));
});

afterEach(async () => {
  child?.kill();
  child = undefined;
  graph.calls = [];
  graph.failOn.clear();
  await sleep(50);
});

after(() => {
  graph.server.close();
  graph.server.closeAllConnections();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer(env = {}) {
  const port = await freePort();
  child = spawn(process.execPath, ['server.js'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: port,
      APP_SECRET,
      VERIFY_TOKEN: 'verify',
      IG_USER_ID: 'ig1',
      PAGE_ACCESS_TOKEN: 'page-token',
      LIKE_ACCESS_TOKEN: 'user-token',
      DM_MESSAGE: '@{username}님 링크\\nhttps://example.com',
      KEYWORDS: '',
      TARGET_MEDIA_IDS: '',
      INCLUDE_REPLIES: 'false',
      DRY_RUN: 'false',
      PAGE_ID: '',
      GRAPH_API_VERSION: 'v26.0',
      GRAPH_BASE_URL: `http://127.0.0.1:${graph.port}`,
      DATA_FILE: path.join(tmpDir, `${port}.json`),
      ...env,
    },
  });
  const base = `http://127.0.0.1:${port}`;
  // node.exe 실행이 느린 PC도 있어서 넉넉히 기다림
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/health`);
      return base;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('서버가 시작되지 않았습니다');
}

function postComment(base, value, { secret = APP_SECRET } = {}) {
  const raw = JSON.stringify({
    object: 'instagram',
    entry: [{ id: 'ig1', changes: [{ field: 'comments', value }] }],
  });
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'X-Hub-Signature-256': `sha256=${sig}` },
    body: raw,
  });
}

const comment = (id, extra = {}) => ({
  id,
  text: '분석 부탁드려요',
  from: { id: 'u1', username: 'kim' },
  media: { id: 'media1' },
  ...extra,
});

const endpoints = () => graph.calls.map((c) => c.path.split('/').pop());

async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await sleep(20);
}

test('댓글이 오면 페이지 토큰으로 DM을 보내고 사용자 토큰으로 좋아요를 누른다', async () => {
  const base = await startServer();
  await postComment(base, comment('c1'));
  await until(() => graph.calls.length >= 2);

  assert.deepEqual(endpoints(), ['messages', 'likes']);
  const [dm, like] = graph.calls;
  assert.equal(dm.path, '/v26.0/ig1/messages');
  assert.equal(dm.auth, 'Bearer page-token');
  assert.deepEqual(dm.body, {
    recipient: { comment_id: 'c1' },
    message: { text: '@kim님 링크\nhttps://example.com' },
  });
  assert.equal(like.path, '/v26.0/ig1/likes');
  assert.equal(like.auth, 'Bearer user-token');
  assert.deepEqual(like.body, { comment_id: 'c1' });
});

test('PAGE_ID 가 있으면 페이지 경로로 DM을 보낸다', async () => {
  const base = await startServer({ PAGE_ID: 'page1' });
  await postComment(base, comment('c1'));
  await until(() => graph.calls.length >= 2);
  assert.equal(graph.calls[0].path, '/v26.0/page1/messages');
  assert.equal(graph.calls[1].path, '/v26.0/ig1/likes');
});

test('DM이 실패하면 좋아요를 누르지 않는다', async () => {
  graph.failOn.add('messages');
  const base = await startServer();
  await postComment(base, comment('c1'));
  await until(() => graph.calls.length >= 1);
  await sleep(100);
  assert.deepEqual(endpoints(), ['messages']);
  const { stats } = await (await fetch(`${base}/health`)).json();
  assert.equal(stats.error, 1);
});

test('같은 웹훅이 다시 와도 DM은 한 번만 보낸다', async () => {
  const base = await startServer();
  await postComment(base, comment('c1'));
  await postComment(base, comment('c1'));
  await until(() => graph.calls.length >= 2);
  await sleep(400);
  assert.deepEqual(endpoints(), ['messages', 'likes']);
});

test('좋아요만 실패한 댓글은 재처리 때 좋아요만 다시 시도한다', async () => {
  graph.failOn.add('likes');
  const base = await startServer();
  await postComment(base, comment('c1'));
  await until(() => graph.calls.length >= 2);
  await sleep(300);

  graph.failOn.clear();
  graph.calls = [];
  await postComment(base, comment('c1'));
  await until(() => graph.calls.length >= 1);
  await sleep(100);
  assert.deepEqual(endpoints(), ['likes']);
});

test('키워드 없는 댓글, 내 댓글, 대댓글, 대상 외 게시물은 건너뛴다', async () => {
  const base = await startServer({ KEYWORDS: '분석', TARGET_MEDIA_IDS: 'media1' });
  await postComment(base, comment('c1', { text: '좋아요' }));
  await postComment(base, comment('c2', { from: { id: 'ig1', username: 'me' } }));
  await postComment(base, comment('c3', { parent_id: 'c0' }));
  await postComment(base, comment('c4', { media: { id: 'other' } }));
  await sleep(200);
  assert.deepEqual(endpoints(), []);
});

test('DRY_RUN 이면 API를 호출하지 않는다', async () => {
  const base = await startServer({ DRY_RUN: 'true' });
  await postComment(base, comment('c1'));
  await sleep(200);
  assert.deepEqual(endpoints(), []);
});

test('서명이 틀린 웹훅은 거부한다', async () => {
  const base = await startServer();
  const res = await postComment(base, comment('c1'), { secret: 'wrong' });
  assert.equal(res.status, 403);
  await sleep(100);
  assert.deepEqual(endpoints(), []);
});

test('웹훅 등록 확인은 토큰이 맞을 때만 challenge 를 돌려준다', async () => {
  const base = await startServer();
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=abc`);
  assert.equal(await ok.text(), 'abc');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc`);
  assert.equal(bad.status, 403);
});

test('LIKE_ACCESS_TOKEN 이 없으면 서버가 시작을 거부한다', async () => {
  const proc = spawn(process.execPath, ['server.js'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      APP_SECRET,
      VERIFY_TOKEN: 'v',
      IG_USER_ID: 'ig1',
      PAGE_ACCESS_TOKEN: 'p',
      LIKE_ACCESS_TOKEN: '',
    },
  });
  const code = await new Promise((r) => proc.on('exit', r));
  assert.equal(code, 1);
});
