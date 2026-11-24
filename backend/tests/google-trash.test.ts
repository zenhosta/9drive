import { assertTrashAction } from '../src/modules/google/google-trash.service.js'

function expectTrashError(fn: () => void) {
  expect(fn).toThrow()
  try {
    fn()
  } catch (error) {
    expect((error as Error).name).toBe('TrashError')
  }
}

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
    expectTrashError(() => assertTrashAction(notTrashedFile, 'restore'))
    expectTrashError(() => assertTrashAction(notTrashedFile, 'delete'))
  })

  test('assertTrashAction throws for not owned', () => {
    expectTrashError(() => assertTrashAction(notOwnedFile, 'restore'))
    expectTrashError(() => assertTrashAction(notOwnedFile, 'delete'))
  })

  test('assertTrashAction throws when cannot untrash', () => {
    expectTrashError(() => assertTrashAction(cannotUntrashFile, 'restore'))
  })

  test('assertTrashAction throws when cannot delete', () => {
    expectTrashError(() => assertTrashAction(cannotDeleteFile, 'delete'))
  })
})
