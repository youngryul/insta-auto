import fs from 'node:fs';

// .env 읽기 (외부 패키지 없이). 이미 설정된 환경변수가 있으면 그 값을 우선합니다.
function loadEnv(file = '.env') {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const csv = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  appSecret: process.env.APP_SECRET || '',
  verifyToken: process.env.VERIFY_TOKEN || '',
  igUserId: process.env.IG_USER_ID || '',
  pageId: process.env.PAGE_ID || '',
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN || '',
  likeAccessToken: process.env.LIKE_ACCESS_TOKEN || '',
  graphVersion: process.env.GRAPH_API_VERSION || 'v26.0',
  // 테스트 때 가짜 서버로 바꿔 끼우기 위한 값. 운영에서는 건드리지 마세요.
  graphBase: (process.env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, ''),
  dmMessage: (process.env.DM_MESSAGE || '댓글 남겨주셔서 감사해요!').replace(/\\n/g, '\n'),
  keywords: csv(process.env.KEYWORDS).map((k) => k.toLowerCase()),
  targetMediaIds: csv(process.env.TARGET_MEDIA_IDS),
  includeReplies: process.env.INCLUDE_REPLIES === 'true',
  dryRun: process.env.DRY_RUN === 'true',
  dataFile: process.env.DATA_FILE || './data/processed.json',
};

export function validateConfig({ needsWebhook = true } = {}) {
  const required = ['igUserId', 'pageAccessToken', 'likeAccessToken'];
  if (needsWebhook) required.push('appSecret', 'verifyToken');
  const envName = {
    igUserId: 'IG_USER_ID',
    pageAccessToken: 'PAGE_ACCESS_TOKEN',
    likeAccessToken: 'LIKE_ACCESS_TOKEN',
    appSecret: 'APP_SECRET',
    verifyToken: 'VERIFY_TOKEN',
  };
  const missing = required.filter((k) => !config[k]).map((k) => envName[k]);
  if (missing.length) {
    console.error(`❌ .env 에 필수 값이 없습니다: ${missing.join(', ')}`);
    process.exit(1);
  }
}
