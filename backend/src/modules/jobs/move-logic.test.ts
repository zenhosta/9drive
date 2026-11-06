import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backoffDelayMs, classifyDriveError, computeJobStatus, isNativeGoogleMime, nativeExportFor, splitSubpath, subpathFor, verifyCopy, withExtension } from './move-logic.js'

test('native mime detection', () => {
  assert.equal(isNativeGoogleMime('application/vnd.google-apps.document'), true)
  assert.equal(isNativeGoogleMime('application/vnd.google-apps.folder'), false)
  assert.equal(isNativeGoogleMime('application/pdf'), false)
})

test('native export mapping', () => {
  assert.equal(nativeExportFor('application/vnd.google-apps.spreadsheet')?.extension, '.xlsx')
  assert.equal(nativeExportFor('application/vnd.google-apps.drawing')?.convertBack, false)
  assert.equal(nativeExportFor('application/vnd.google-apps.form'), null)
  assert.equal(withExtension('Report', '.docx'), 'Report.docx')
  assert.equal(withExtension('Report.DOCX', '.docx'), 'Report.DOCX')
})

test('error classification', () => {
  assert.equal(classifyDriveError({ code: 429 }).retryable, true)
  assert.equal(classifyDriveError({ code: 503 }).retryable, true)
  assert.equal(classifyDriveError({ code: 403, errors: [{ reason: 'userRateLimitExceeded' }] }).retryable, true)
  assert.equal(classifyDriveError({ code: 403, errors: [{ reason: 'storageQuotaExceeded' }] }).retryable, false)
  assert.equal(classifyDriveError({ status: 403, reason: 'dailyLimitExceeded' }).retryable, false)
  assert.equal(classifyDriveError({ code: 404 }).retryable, false)
  assert.equal(classifyDriveError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })).retryable, true)
  assert.equal(classifyDriveError(new Error('something odd')).retryable, false)
})

test('backoff grows and is capped', () => {
  assert.equal(backoffDelayMs(0, () => 0), 500)
  assert.equal(backoffDelayMs(1, () => 1), 2000)
  assert.ok(backoffDelayMs(20, () => 1) <= 60_000)
})

test('verifyCopy', () => {
  assert.equal(verifyCopy({ size: '10', md5Checksum: 'AB' }, { size: '10', md5Checksum: 'ab' }), null)
  assert.match(verifyCopy({ size: '10' }, { size: '9' }) ?? '', /Size mismatch/)
  assert.match(verifyCopy({ size: '10', md5Checksum: 'a' }, { size: '10', md5Checksum: 'b' }) ?? '', /md5/)
  assert.match(verifyCopy({ size: '10', md5Checksum: 'a' }, { size: '10' }) ?? '', /checksum/)
  assert.match(verifyCopy({ size: '10' }, { size: '10', trashed: true }) ?? '', /trash/)
  assert.equal(verifyCopy({ size: '0' }, { size: '0' }), null)
})

test('job status aggregation', () => {
  const c = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0 }
  assert.equal(computeJobStatus({ ...c, done: 3 }, false), 'completed')
  assert.equal(computeJobStatus({ ...c, done: 2, failed: 1 }, false), 'completed_with_errors')
  assert.equal(computeJobStatus({ ...c, failed: 2 }, false), 'failed')
  assert.equal(computeJobStatus({ ...c, running: 1, done: 1 }, false), 'running')
  assert.equal(computeJobStatus({ ...c, queued: 2 }, false), 'queued')
  assert.equal(computeJobStatus({ ...c, done: 1, cancelled: 2 }, true), 'cancelled')
})

test('folder structure is kept when a whole folder is moved or copied', () => {
  assert.equal(subpathFor('My Drive/Photos', 'My Drive/Photos'), 'Photos')
  assert.equal(subpathFor('My Drive/Photos', 'My Drive/Photos/2023'), 'Photos/2023')
  assert.equal(subpathFor('My Drive/Photos/', 'My Drive/Photos/2023/Trip'), 'Photos/2023/Trip')
  assert.equal(subpathFor('My Drive/A/B', 'My Drive/A/B/C'), 'B/C')
  assert.deepEqual(splitSubpath('Photos//2023/ '), ['Photos', '2023'])
  assert.deepEqual(splitSubpath(null), [])
})
