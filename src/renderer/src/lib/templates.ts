/** 快速添加模板：保存原始输入文本，应用时走同一条 NLP 解析链路。 */
export interface QuickAddTemplate {
  id: string
  name: string
  text: string
  createdAt: string
}

export const TEMPLATE_SETTING_KEY = 'quick_add_templates'
export const TEMPLATE_LIMIT = 20

export function parseTemplates(raw: string | null | undefined): QuickAddTemplate[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is QuickAddTemplate => {
      if (!item || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.text === 'string'
    }).slice(0, TEMPLATE_LIMIT)
  } catch {
    return []
  }
}

export function templateName(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? ''
  return firstLine.length > 20 ? `${firstLine.slice(0, 20)}…` : firstLine
}

export function addTemplate(
  templates: QuickAddTemplate[],
  text: string,
  now = new Date()
): QuickAddTemplate[] {
  const trimmed = text.trim()
  if (!trimmed) return templates
  const name = templateName(trimmed) || '未命名模板'
  // 同名模板覆盖旧内容，避免列表里出现多个完全一样的入口。
  const rest = templates.filter((item) => item.name !== name)
  const next: QuickAddTemplate = {
    id: `tpl-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    text: trimmed,
    createdAt: now.toISOString()
  }
  return [next, ...rest].slice(0, TEMPLATE_LIMIT)
}

export function removeTemplate(templates: QuickAddTemplate[], id: string): QuickAddTemplate[] {
  return templates.filter((item) => item.id !== id)
}
