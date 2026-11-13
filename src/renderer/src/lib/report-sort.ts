/**
 * 日报/周报的标题排序：
 * 1. 短的在前；
 * 2. 相似的任务尽量挨在一起（先按相似度聚类，再按簇内长度排序）。
 *
 * 只做纯文本的 bigram 重叠，不依赖分词库，中文短句也够用。
 */

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:()[\]{}"'“”‘’《》<>·\-—_/\\|]+/g, '')
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>()
  if (text.length <= 2) {
    if (text) set.add(text)
    return set
  }
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2))
  return set
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const gram of a) if (b.has(gram)) overlap++
  return overlap / Math.min(a.size, b.size)
}

class UnionFind {
  private parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index)
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]
      x = this.parent[x]
    }
    return x
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

export function sortReportTitles<T extends { title: string }>(tasks: T[]): T[] {
  const items = tasks.map((task, index) => {
    const title = task.title.replace(/\s*\n+\s*/g, ' ').trim()
    return { task, title, index, size: normalize(title).length, grams: bigrams(normalize(title)) }
  })

  const uf = new UnionFind(items.length)
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (similarity(items[i].grams, items[j].grams) >= 0.5) uf.union(i, j)
    }
  }

  const clusters = new Map<number, typeof items>()
  for (let i = 0; i < items.length; i++) {
    const root = uf.find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(items[i])
  }

  const ordered = [...clusters.values()]
    .map((cluster) => cluster.sort((a, b) => a.size - b.size || a.index - b.index))
    .sort((a, b) => a[0].size - b[0].size || a[0].index - b[0].index)

  return ordered.flatMap((cluster) => cluster.map((item) => item.task))
}
