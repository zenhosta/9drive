import { googleFilesQuery } from '../src/modules/google/google-files.service.js'

describe('google-files', () => {
  test('googleFilesQuery builds root query', () => {
    const q = googleFilesQuery()
    expect(q).toContain("trashed = false")
    expect(q).toContain("'me' in owners")
    expect(q).toContain("'root' in parents")
  })

  test('googleFilesQuery builds parent query', () => {
    const q = googleFilesQuery('folder123')
    expect(q).toContain("'folder123' in parents")
    expect(q).not.toContain("'root' in parents")
  })

  test('googleFilesQuery builds search query', () => {
    const q = googleFilesQuery(undefined, 'test file')
    expect(q).toContain("name contains 'test file'")
    expect(q).not.toContain("'root' in parents")
  })

  test('googleFilesQuery escapes single quotes', () => {
    const q = googleFilesQuery(undefined, "test'file")
    expect(q).toContain("name contains 'test\\'file'")
  })

  test('googleFilesQuery escapes backslashes', () => {
    const q = googleFilesQuery('folder\\name')
    expect(q).toContain("'folder\\\\name' in parents")
  })
})