import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * 처리한 댓글 기록 (JSON 파일)
 * 인스타 API는 "내가 이 댓글에 좋아요를 눌렀는지"를 읽어오는 기능이 없어서,
 * 어떤 댓글에 DM을 보냈고 좋아요를 눌렀는지는 여기에 따로 적어 둡니다.
 *
 * 레코드: { status: 'done'|'error'|'skipped', dmSentAt, messageId, likedAt, error, username, mediaId, text }
 */
const file = path.resolve(config.dataFile);
let data = {};

try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn(`⚠️ 기록 파일을 읽지 못해 새로 시작합니다: ${e.message}`);
}

let writeChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(data, null, 2);
  writeChain = writeChain
    .then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, snapshot);
      await fs.promises.rename(tmp, file); // 중간에 꺼져도 파일이 깨지지 않도록
    })
    .catch((e) => console.error(`❌ 기록 저장 실패: ${e.message}`));
  return writeChain;
}

export const store = {
  get: (id) => data[id],
  update(id, patch) {
    data[id] = { ...(data[id] || {}), ...patch, updatedAt: new Date().toISOString() };
    persist();
    return data[id];
  },
  stats() {
    const s = { done: 0, error: 0, skipped: 0, pending: 0 };
    for (const r of Object.values(data)) s[r.status in s ? r.status : 'pending']++;
    return s;
  },
  flush: () => writeChain,
};
