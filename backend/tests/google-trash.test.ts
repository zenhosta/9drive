import { assertTrashAction } from '../src/modules/google/google-trash.service.js'

describe('google-trash', () => {
  const trashedFile = {
    id: 'f1',
    name: 'test.txt',
    trashed: true,
    explicitlyTrashed: true,
    ownedByMe: true,
    capabilities: { canDelete: true, canUntrash: true },
    mimeType: 'text/plain',
    size: '100',
    quotaBytesUsed: '100',
    trashedTime: '2024-01-01T00:00:00.000Z',
  }

  const notTrashedFile = { ...trashedFile, trashed: false }

  const notOwnedFile = { ...trashedFile, ownedByMe: false }

  const cannotUntrashFile = { ...trashedFile, explicitlyTrashed: false, capabilities: { canDelete: true, canUntrash: false } }

  const cannotDeleteFile = { ...trashedFile, capabilities: { canDelete: false, canUntrash: true } }

  test('assertTrashAction passes for valid restore', () => {
    expect(() => assertTrashAction(trashedFile, 'restore')).not.toThrow()
  })

  test('assertTrashAction passes for valid delete', () => {
    expect(() => assertTrashAction(trashedFile, 'delete')).not.toThrow()
  })

  test('assertTrashAction throws for not trashed', () => {
    expect(() => assertTrashAction(notTrashedFile, 'restore')).toThrow('TrashError')
    expect(() => assertTrashAction(notTrashedFile, 'delete')).toThrow('TrashError')
  })

  test('assertTrashAction throws for not owned', () => {
    expect(() => assertTrashAction(notOwnedFile, 'restore')).toThrow('TrashError')
    expect(() => assertTrashAction(notOwnedFile, 'delete')).toThrow('TrashError')
  })

  test('assertTrashAction throws when cannot untrash', () => {
    expect(() => assertTrashAction(cannotUntrashFile, 'restore')).toThrow('TrashError')
  })

  test('assertTrashAction throws when cannot delete', () => {
    expect(() => assertTrashAction(cannotDeleteFile, 'delete')).toThrow('TrashError')
  })
})