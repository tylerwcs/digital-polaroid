import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingQueue, sanitizePending, DEFAULT_MAX_PENDING } from './pendingQueue.js';

const makeRecord = (id) => ({
  id,
  imageUrl: `/uploads/${id}.jpg`,
  storageFile: `${id}.jpg`,
  timestamp: Number(id),
  rotation: 0,
});

test('add appends so the queue is oldest-first', () => {
  const queue = createPendingQueue();
  assert.equal(queue.add(makeRecord('1')), true);
  assert.equal(queue.add(makeRecord('2')), true);
  assert.deepEqual(queue.list().map((r) => r.id), ['1', '2']);
  assert.equal(queue.size(), 2);
});

test('add refuses new records once the queue is full', () => {
  const queue = createPendingQueue({ maxPending: 2 });
  queue.add(makeRecord('1'));
  queue.add(makeRecord('2'));

  assert.equal(queue.isFull(), true);
  assert.equal(queue.add(makeRecord('3')), false);
  assert.deepEqual(queue.list().map((r) => r.id), ['1', '2']);
});

test('remove pulls the record out and returns it', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));
  queue.add(makeRecord('2'));

  const removed = queue.remove('1');
  assert.equal(removed.id, '1');
  assert.equal(removed.storageFile, '1.jpg');
  assert.deepEqual(queue.list().map((r) => r.id), ['2']);
});

test('remove returns null for an unknown id and leaves the queue alone', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  assert.equal(queue.remove('nope'), null);
  assert.equal(queue.size(), 1);
});

test('skip moves the record to the back of the queue', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));
  queue.add(makeRecord('2'));
  queue.add(makeRecord('3'));

  const skipped = queue.skip('1');
  assert.equal(skipped.id, '1');
  assert.deepEqual(queue.list().map((r) => r.id), ['2', '3', '1']);
});

test('skip on the only record keeps it at the head', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  assert.equal(queue.skip('1').id, '1');
  assert.deepEqual(queue.list().map((r) => r.id), ['1']);
});

test('skip returns null for an unknown id', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  assert.equal(queue.skip('nope'), null);
  assert.deepEqual(queue.list().map((r) => r.id), ['1']);
});

test('list returns a copy so callers cannot mutate internal state', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  const list = queue.list();
  list.push(makeRecord('2'));

  assert.equal(queue.size(), 1);
});

test('sanitizePending drops the server-only storageFile', () => {
  const publicRecord = sanitizePending(makeRecord('1'));

  assert.deepEqual(publicRecord, {
    id: '1',
    imageUrl: '/uploads/1.jpg',
    timestamp: 1,
    rotation: 0,
  });
  assert.equal('storageFile' in publicRecord, false);
});

test('the default cap is 50', () => {
  assert.equal(DEFAULT_MAX_PENDING, 50);
});
