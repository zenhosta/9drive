import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATEGORY_KEYS, categoryWhere, classifyFile, extensionOf } from './file-types.js'

test('MIME decides first', () => {
  assert.equal(classifyFile('image/png', 'x.mp4'), 'images')
  assert.equal(classifyFile('application/pdf', 'x'), 'documents')
  assert.equal(classifyFile('application/vnd.google-apps.spreadsheet', 'Budget'), 'spreadsheets')
  assert.equal(classifyFile('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.bin'), 'presentations')
  assert.equal(classifyFile('application/zip', 'a.txt'), 'archives')
  assert.equal(classifyFile('text/x-python', 'noext'), 'code')
})

test('extension is the fallback, including for generic MIME types', () => {
  assert.equal(classifyFile('application/octet-stream', 'backup.7z'), 'archives')
  assert.equal(classifyFile('application/octet-stream', 'Song.MP3'), 'audio')
  assert.equal(classifyFile('text/plain', 'script.py'), 'code')
  assert.equal(classifyFile('text/plain', 'data.csv'), 'spreadsheets')
  assert.equal(classifyFile('', 'photo.JPG'), 'images')
})

test('defaults', () => {
  assert.equal(classifyFile('text/plain', 'notes'), 'documents')
  assert.equal(classifyFile('text/plain', 'notes.txt'), 'documents')
  assert.equal(classifyFile('application/octet-stream', 'thing'), 'other')
  assert.equal(classifyFile('application/x-unknown', '.hidden'), 'other')
  assert.equal(classifyFile('application/vnd.google-apps.form', 'Survey'), 'other')
})

test('extensionOf', () => {
  assert.equal(extensionOf('a.tar.gz'), 'gz')
  assert.equal(extensionOf('noext'), '')
  assert.equal(extensionOf('.bashrc'), '')
  assert.equal(extensionOf('trailing.'), '')
})

test('every category has a SQL filter', () => {
  for (const key of CATEGORY_KEYS) assert.ok(categoryWhere(key))
})
