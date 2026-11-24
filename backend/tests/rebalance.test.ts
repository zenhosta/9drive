import { planBalance, verifyCopy, selectBalanceMoves, type BalanceAccount, type Candidate, type Move } from '../src/modules/rebalance/planner.js'

describe('planner', () => {
  const accounts: BalanceAccount[] = [
    { id: 'a1', label: 'Account 1', usedBytes: '100000000000', freeBytes: '50000000000' },
    { id: 'a2', label: 'Account 2', usedBytes: '50000000000', freeBytes: '100000000000' },
  ]

  const candidates: Candidate[] = [
    { sourceAccountId: 'a1', sourceFileId: 'f1', name: 'file1.txt', mimeType: 'text/plain', sizeBytes: '10000000000', md5: 'abc123', modifiedTime: '2024-01-01T00:00:00.000Z' },
    { sourceAccountId: 'a1', sourceFileId: 'f2', name: 'file2.txt', mimeType: 'text/plain', sizeBytes: '20000000000', md5: 'def456', modifiedTime: '2024-01-02T00:00:00.000Z' },
  ]

  test('planBalance reduces variance', () => {
    const { moves, projected } = planBalance(accounts, candidates)
    expect(moves.length).toBeGreaterThan(0)
    expect(moves[0].targetAccountId).toBe('a2')
  })

  test('verifyCopy passes on matching checksum', () => {
    const source = { sizeBytes: '100', md5: 'abc123' }
    const target = { size: '100', md5Checksum: 'abc123', trashed: false }
    expect(() => verifyCopy(source, target)).not.toThrow()
  })

  test('verifyCopy throws on mismatched checksum', () => {
    const source = { sizeBytes: '100', md5: 'abc123' }
    const target = { size: '100', md5Checksum: 'different', trashed: false }
    expect(() => verifyCopy(source, target)).toThrow()
  })

  test('verifyCopy throws on size mismatch', () => {
    const source = { sizeBytes: '100', md5: 'abc123' }
    const target = { size: '200', md5Checksum: 'abc123', trashed: false }
    expect(() => verifyCopy(source, target)).toThrow()
  })

  test('selectBalanceMoves selects approved moves', () => {
    const moves: Move[] = [
      { ...candidates[0], id: 'm1', targetAccountId: 'a2', status: 'pending' },
      { ...candidates[1], id: 'm2', targetAccountId: 'a2', status: 'pending' },
    ]
    const { moves: selected, projected } = selectBalanceMoves(accounts, moves, ['m1'])
    expect(selected.length).toBe(1)
    expect(selected[0].id).toBe('m1')
  })

  test('selectBalanceMoves throws on invalid selection', () => {
    const moves: Move[] = [
      { ...candidates[0], id: 'm1', targetAccountId: 'a2', status: 'pending' },
    ]
    expect(() => selectBalanceMoves(accounts, moves, ['invalid'])).toThrow('BalanceError')
  })
})