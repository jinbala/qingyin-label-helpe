import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewScheduler } from '../src/ui/preview-scheduler.mjs';

test('连续 100 次更新最多运行两次任务，过期任务取消且渲染不并发', async () => {
  let release, calls = 0, active = 0, maximum = 0;
  const barrier = new Promise(resolve => { release = resolve; }), tasks = [];
  const scheduler = createPreviewScheduler(async task => {
    tasks.push(task); calls++; active++; maximum = Math.max(maximum, active);
    if (calls === 1) await barrier;
    active--;
  });
  const promises = [scheduler.request()];
  for (let i = 0; i < 100; i++) promises.push(scheduler.request());
  assert.equal(calls, 1); assert.equal(tasks[0].signal.aborted, true);
  release(); assert((await Promise.all(promises)).every(Boolean));
  assert.equal(calls, 2); assert.equal(maximum, 1); assert.equal(tasks[0].isCurrent(), false); assert.equal(tasks[1].isCurrent(), true);
  scheduler.dispose(); assert.equal(await scheduler.request(), false);
});

test('关闭页面时排队任务结束等待，正在加载的任务收到取消', async () => {
  let release, signal;
  const barrier = new Promise(resolve => { release = resolve; });
  const scheduler = createPreviewScheduler(async task => { signal = task.signal; await barrier; });
  const result = scheduler.request(); scheduler.dispose();
  assert.equal(await result, false); assert.equal(signal.aborted, true); release();
});
