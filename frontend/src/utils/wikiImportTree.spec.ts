import { describe, it, expect } from 'vitest'
import { buildImportTree, toSegments } from './wikiImportTree'

/** Depth-first list of "title(content|folder)" for compact assertions. */
const flatten = (
  nodes: ReturnType<typeof buildImportTree>['roots'],
  depth = 0,
): string[] =>
  nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.title}${n.hasContent ? '' : '/'}`,
    ...flatten(n.children, depth + 1),
  ])

describe('toSegments', () => {
  it('splits and strips the leaf extension', () => {
    expect(toSegments('a/b/c.md')).toEqual(['a', 'b', 'c'])
  })

  it('ignores blank, dot and dot-dot segments', () => {
    expect(toSegments('a//./b/../c.markdown')).toEqual(['a', 'b', 'c'])
  })

  it('handles a bare file', () => {
    expect(toSegments('README.md')).toEqual(['README'])
  })
})

describe('buildImportTree', () => {
  it('nests files under their folders', () => {
    const { roots, pageCount, folderCount } = buildImportTree([
      { path: 'Docs/Intro.md', content: '# Intro' },
      { path: 'Docs/Guide/Setup.md', content: '# Setup' },
    ])
    expect(flatten(roots)).toEqual([
      'Docs/',
      '  Guide/',
      '    Setup',
      '  Intro',
    ])
    expect(pageCount).toBe(2)
    expect(folderCount).toBe(2) // Docs + Guide are pure folders
  })

  it('merges a sibling folder note (Foo/ + Foo.md) into one page', () => {
    const { roots, pageCount, folderCount } = buildImportTree([
      { path: 'Entwicklung.md', content: '# Dev' },
      { path: 'Entwicklung/Sub.md', content: '# Sub' },
    ])
    // one Entwicklung page (with content) that parents Sub — no duplicate
    expect(flatten(roots)).toEqual(['Entwicklung', '  Sub'])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.hasContent).toBe(true)
    expect(pageCount).toBe(2)
    expect(folderCount).toBe(0)
  })

  it('merges README/index/_index into the folder page', () => {
    const { roots } = buildImportTree([
      { path: 'Handbook/README.md', content: '# Handbook' },
      { path: 'Handbook/Chapter.md', content: '# Chapter' },
      { path: 'Api/index.md', content: '# Api' },
      { path: 'Legacy/_index.md', content: '# Legacy' },
    ])
    const handbook = roots.find((n) => n.title === 'Handbook')!
    expect(handbook.hasContent).toBe(true)
    expect(handbook.children.map((c) => c.title)).toEqual(['Chapter'])
    expect(roots.find((n) => n.title === 'Api')!.hasContent).toBe(true)
    expect(roots.find((n) => n.title === 'Legacy')!.hasContent).toBe(true)
  })

  it('merges an in-folder same-named note (Foo/Foo.md)', () => {
    const { roots } = buildImportTree([
      { path: 'Team/Team.md', content: '# Team' },
      { path: 'Team/Member.md', content: '# Member' },
    ])
    expect(flatten(roots)).toEqual(['Team', '  Member'])
    expect(roots[0]!.hasContent).toBe(true)
  })

  it('creates empty container pages for folders without a note', () => {
    const { roots, folderCount } = buildImportTree([
      { path: 'Projects/Alpha/Notes.md', content: 'x' },
    ])
    expect(flatten(roots)).toEqual(['Projects/', '  Alpha/', '    Notes'])
    expect(folderCount).toBe(2)
  })

  it('treats an empty file as a folder, not a content page', () => {
    const { roots } = buildImportTree([
      { path: 'Empty.md', content: '   \n  ' },
      { path: 'Empty/Child.md', content: 'x' },
    ])
    expect(roots[0]!.title).toBe('Empty')
    expect(roots[0]!.hasContent).toBe(false)
    expect(roots[0]!.children.map((c) => c.title)).toEqual(['Child'])
  })

  it('reports a duplicate when two files target the same page', () => {
    const { roots, skipped } = buildImportTree([
      { path: 'Foo.md', content: 'a' },
      { path: 'Foo/index.md', content: 'b' },
    ])
    // the shorter sibling note wins; the in-folder index is skipped
    expect(roots).toHaveLength(1)
    expect(roots[0]!.hasContent).toBe(true)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.path).toBe('Foo/index.md')
  })

  it('strips the common wrapper folder when asked', () => {
    const files = [
      { path: 'my-repo/a.md', content: 'a' },
      { path: 'my-repo/sub/b.md', content: 'b' },
    ]
    const kept = buildImportTree(files)
    expect(kept.roots.map((n) => n.title)).toEqual(['my-repo'])

    const stripped = buildImportTree(files, { stripCommonRoot: true })
    expect(flatten(stripped.roots)).toEqual(['a', 'sub/', '  b'])
  })

  it('does not strip when files do not share a single root', () => {
    const { roots } = buildImportTree(
      [
        { path: 'a/x.md', content: 'x' },
        { path: 'b/y.md', content: 'y' },
      ],
      { stripCommonRoot: true },
    )
    expect(roots.map((n) => n.title).sort()).toEqual(['a', 'b'])
  })

  it('skips a root-level index that cannot be placed', () => {
    const { roots, skipped } = buildImportTree([
      { path: 'index.md', content: 'root' },
    ])
    // a bare index at the very root maps to its own page (nothing to merge into)
    expect(roots.map((n) => n.title)).toEqual(['index'])
    expect(skipped).toHaveLength(0)
  })
})
