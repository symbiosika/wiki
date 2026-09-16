import { describe, expect, test } from 'vitest'
import { collectReaderHeadings, renderBlocksForReading } from './wikiReader'
import type { WikiBlock } from '@/types/wiki'

const OPTIONS = { imageDescriptionLabel: 'Image description' }

/** Render blocks the way the reader mounts them, and hand back the root. */
const render = (blocks: WikiBlock[]): HTMLElement => {
  const root = document.createElement('div')
  root.appendChild(renderBlocksForReading(blocks, OPTIONS))
  return root
}

const markdown = (content: string, id?: string): WikiBlock[] => [
  { id, type: 'markdown', content },
]

describe('renderBlocksForReading', () => {
  test('keeps the block id on the top-level element (deep-link contract)', () => {
    const root = render(markdown('# Title', 'block-1'))
    expect(root.children[0]!.getAttribute('data-block-id')).toBe('block-1')
  })

  test('renders a markdown table inside a scrollable wrapper, id and all', () => {
    const root = render(
      markdown('| a | b |\n| --- | --- |\n| 1 | 2 |', 'block-1'),
    )
    const wrapper = root.children[0]!
    expect(wrapper.className).toBe('tableWrapper')
    expect(wrapper.getAttribute('data-block-id')).toBe('block-1')
    expect(wrapper.querySelector('table')).not.toBeNull()
    // the id identifies the block, so it may not stay on the inner table too
    expect(wrapper.querySelector('table')!.hasAttribute('data-block-id')).toBe(
      false,
    )
  })

  test('renders a page reference as a chip carrying its target', () => {
    const root = render(markdown('See [[Other page]] for details.'))
    const chip = root.querySelector('[data-wiki-link]')!
    expect(chip.tagName).toBe('SPAN')
    expect(chip.getAttribute('data-wiki-link')).toBe('Other page')
    expect(chip.textContent).toBe('Other page')
    // no resolved page id yet: shown as a phantom reference
    expect(chip.className).toContain('wiki-link--phantom')
  })

  test('shows a reference alias as its visible text', () => {
    const root = render(markdown('[[Other page|the other one]]'))
    const chip = root.querySelector('[data-wiki-link]')!
    expect(chip.textContent).toBe('the other one')
    expect(chip.getAttribute('data-wiki-link')).toBe('Other page')
  })

  test('wraps an image in a figure with lazy loading', () => {
    const root = render(markdown('![alt](/files/db/knowledge/a.png)'))
    const figure = root.querySelector('figure.wiki-image')!
    const image = figure.querySelector('img')!
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('decoding')).toBe('async')
  })

  test('folds an image description into a collapsed caption', () => {
    const root = render([
      {
        type: 'html',
        content:
          '<p><img src="/files/db/knowledge/a.png" data-description="A red bicycle."></p>',
      },
    ])
    const caption = root.querySelector('details.wiki-image-description')!
    expect(caption.querySelector('summary')!.textContent).toBe(
      'Image description',
    )
    expect(caption.querySelector('p')!.textContent).toBe('A red bicycle.')
  })

  test('renders a task list with disabled checkboxes reflecting its state', () => {
    const root = render(markdown('- [x] done\n- [ ] open'))
    const items = Array.from(
      root.querySelectorAll('li[data-type="taskItem"]'),
    ) as HTMLElement[]
    expect(items).toHaveLength(2)
    const boxes = items.map(
      (item) =>
        item.querySelector('input[type="checkbox"]') as HTMLInputElement,
    )
    expect(boxes.map((box) => box.checked)).toEqual([true, false])
    expect(boxes.every((box) => box.disabled)).toBe(true)
    // the text keeps its own wrapper, as the editor's task item renders it
    expect(items[0]!.querySelector('div > p')!.textContent?.trim()).toBe('done')
  })

  test('strips scripts and event handlers from stored page html', () => {
    const root = render([
      {
        type: 'html',
        content: '<p onclick="steal()">text</p><script>steal()</script>',
      },
    ])
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('p')!.hasAttribute('onclick')).toBe(false)
  })
})

describe('collectReaderHeadings', () => {
  test('collects H1-H3 in document order with their scroll targets', () => {
    const root = render(
      markdown('# One\n\n## Two\n\n#### Four\n\ntext', 'block-1'),
    )
    const headings = collectReaderHeadings(root)
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'One'],
      [2, 'Two'],
    ])
    // the block id is the first heading's target; the rest are generated, and
    // every entry has to resolve to an element the page can scroll to
    for (const heading of headings) {
      expect(
        root.querySelector(`[data-block-id="${heading.id}"]`),
      ).not.toBeNull()
    }
    expect(headings[0]!.id).toBe('block-1')
  })

  test('skips headings without visible text', () => {
    const root = render([{ type: 'html', content: '<h2></h2><h2>Real</h2>' }])
    expect(collectReaderHeadings(root).map((h) => h.text)).toEqual(['Real'])
  })
})
