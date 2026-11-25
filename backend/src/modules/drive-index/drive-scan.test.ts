import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPath } from './drive-scan.js'

const folders = new Map([
  ['a', { name: 'Photos', parent: 'root1' }],
  ['b', { name: '2023', parent: 'a' }],
  ['loop1', { name: 'x', parent: 'loop2' }],
  ['loop2', { name: 'y', parent: 'loop1' }],
  ['orphan', { name: 'Inner', parent: 'someone-elses' }],
])

test('paths from the drive root', () => {
  assert.equal(buildPath('root1', folders, 'root1'), 'My Drive')
  assert.equal(buildPath(undefined, folders, 'root1'), 'My Drive')
  assert.equal(buildPath('a', folders, 'root1'), 'My Drive/Photos')
  assert.equal(buildPath('b', folders, 'root1'), 'My Drive/Photos/2023')
})

test('unknown parents and cycles do not hang', () => {
  assert.equal(buildPath('orphan', folders, 'root1'), 'My Drive/(shared folder)/Inner')
  assert.ok(buildPath('loop1', folders, 'root1').startsWith('My Drive/'))
})
