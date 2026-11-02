/**
 * 보정 스크립트: 서버가 꺼져 있던 동안 놓친 댓글(최근 7일)을 찾아서 처리합니다.
 * 사용법: npm run backfill            → 최근 게시물 10개
 *        npm run backfill -- 25       → 최근 게시물 25개
 * TARGET_MEDIA_IDS 가 있으면 그 게시물만 확인합니다.
 */
import { config, validateConfig } from '../src/config.js';
import { listRecentMedia, listComments } from '../src/graph.js';
import { handleComment } from '../src/processor.js';
import { store } from '../src/store.js';

validateConfig({ needsWebhook: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  const limit = Number(process.argv[2]) || 10;
  const mediaIds = config.targetMediaIds.length
    ? config.targetMediaIds
    : (await listRecentMedia(limit)).data.map((m) => m.id);

  console.log(`🔎 게시물 ${mediaIds.length}개의 최근 7일 댓글을 확인합니다`);
  let checked = 0;

  for (const mediaId of mediaIds) {
    let after;
    do {
      const page = await listComments(mediaId, after);
      for (const c of page.data || []) {
        if (c.timestamp && Date.now() - new Date(c.timestamp).getTime() > SEVEN_DAYS) continue;
        if (store.get(c.id)?.status === 'done') continue;
        checked++;
        const r = await handleComment({ ...c, media: { id: mediaId } });
        if (!r.skipped) await sleep(1500); // 호출 한도 여유
      }
      after = page.paging?.next ? page.paging?.cursors?.after : undefined;
    } while (after);
  }

  await store.flush();
  console.log(`🏁 완료: ${checked}개 확인`, store.stats());
}

main().catch(async (e) => {
  console.error(`❌ 보정 실패: ${e.message}`);
  await store.flush();
  process.exit(1);
});
