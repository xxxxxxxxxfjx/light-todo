export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'link'; text: string; href: string }

export type ListItem = {
  text: string
  inlines: Inline[]
  checked?: boolean
  /** 0-based source line, used by the checklist toggle. */
  line: number
}

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'code'; text: string; lang: string }

const LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/

/** Parse a deliberately small, safe Markdown subset used by task notes. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: Extract<Block, { type: 'list' }> | null = null
  let code: { text: string[]; lang: string } | null = null

  const flushParagraph = (): void => {
    if (!paragraph.length) return
    const text = paragraph.join('\n')
    blocks.push({ type: 'paragraph', inlines: parseInline(text) })
    paragraph = []
  }
  const flushList = (): void => {
    if (!list) return
    blocks.push(list)
    list = null
  }

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      if (code) {
        blocks.push({ type: 'code', text: code.text.join('\n'), lang: code.lang })
        code = null
      } else {
        flushParagraph()
        flushList()
        code = { text: [], lang: fence[1] ?? '' }
      }
      continue
    }
    if (code) {
      code.text.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: heading[1].length, inlines: parseInline(heading[2]) })
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'quote', inlines: parseInline(quote[1]) })
      continue
    }

    const item = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
    if (item) {
      flushParagraph()
      const ordered = /^\d+\.$/.test(item[2])
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { type: 'list', ordered, items: [] }
      }
      const body = item[3]
      const checklist = body.match(/^\[([ xX])\]\s+(.*)$/)
      list.items.push({
        text: checklist ? checklist[2] : body,
        inlines: parseInline(checklist ? checklist[2] : body),
        checked: checklist ? checklist[1].toLowerCase() === 'x' : undefined,
        line: lineNo
      })
      continue
    }

    flushList()
    paragraph.push(line)
  }

  if (code) blocks.push({ type: 'code', text: code.text.join('\n'), lang: code.lang })
  flushParagraph()
  flushList()
  return blocks
}

/** Parse inline emphasis/link tokens. Unclosed tokens stay literal text. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    if (rest.startsWith('`')) {
      const end = source.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'code', text: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (rest.startsWith('**')) {
      const end = source.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'strong', text: source.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    if (rest.startsWith('[')) {
      const match = rest.match(LINK_RE)
      if (match) {
        flush()
        out.push({ type: 'link', text: match[1], href: match[2] })
        i += match[0].length
        continue
      }
    }
    if (rest.startsWith('*') && !rest.startsWith('**')) {
      const end = source.indexOf('*', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'em', text: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    text += source[i]
    i++
  }
  flush()
  return out
}

/** Toggle a `- [ ]` / `- [x]` marker on one source line. */
export function toggleChecklistLine(source: string, lineNo: number): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (lineNo < 0 || lineNo >= lines.length) return source
  const line = lines[lineNo]
  if (/^(\s*[-*+]\s+)\[\s\]\s+/.test(line)) {
    lines[lineNo] = line.replace(/^(\s*[-*+]\s+)\[\s\]\s+/, '$1[x] ')
  } else if (/^(\s*[-*+]\s+)\[[xX]\]\s+/.test(line)) {
    lines[lineNo] = line.replace(/^(\s*[-*+]\s+)\[[xX]\]\s+/, '$1[ ] ')
  } else {
    return source
  }
  return lines.join('\n')
}
