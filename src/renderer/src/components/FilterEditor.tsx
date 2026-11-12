import { useEffect, useMemo, useState } from 'react'
import { Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { FilterCondition, FilterOp, FilterQuery, SavedFilter } from '@shared/types'
import {
  DATE_PRESETS,
  FILTER_FIELDS,
  FILTER_OPS,
  PRIORITY_OPTIONS,
  emptyFilterQuery,
  filterSummary,
  parseFilterText
} from '@shared/filter-query'
import { useStore } from '../store'

export function FilterEditor(): React.JSX.Element | null {
  const {
    filterEditorOpen,
    editingFilter,
    closeFilterEditor,
    sidebar,
    loadFilters,
    setView,
    showToast
  } = useStore()
  const [name, setName] = useState('')
  const [query, setQuery] = useState<FilterQuery>(emptyFilterQuery())
  const [match, setMatch] = useState<'all' | 'any'>('all')
  const [preview, setPreview] = useState<number | null>(null)
  const [nl, setNl] = useState('')

  useEffect(() => {
    if (!filterEditorOpen) return
    setName(editingFilter?.name ?? '')
    setQuery(editingFilter?.query ?? emptyFilterQuery())
    setMatch(editingFilter?.query.match ?? 'all')
    setNl('')
    setPreview(null)
  }, [filterEditorOpen, editingFilter])

  useEffect(() => {
    if (!filterEditorOpen) return
    const timer = setTimeout(() => {
      window.api.filters
        .preview({ match, conditions: query.conditions })
        .then(setPreview)
        .catch(() => setPreview(null))
    }, 220)
    return () => clearTimeout(timer)
  }, [filterEditorOpen, match, query])

  const updateCondition = (index: number, patch: Partial<FilterCondition>): void => {
    setQuery((current) => ({
      ...current,
      conditions: current.conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition))
    }))
  }

  const addCondition = (): void => {
    setQuery((current) => ({
      ...current,
      conditions: [...current.conditions, { field: 'scheduled', op: 'is', value: 'today' }]
    }))
  }

  const removeCondition = (index: number): void => {
    setQuery((current) => ({
      ...current,
      conditions: current.conditions.filter((_, i) => i !== index)
    }))
  }

  const applyNaturalLanguage = (): void => {
    const parsed = parseFilterText(nl, sidebar.lists, sidebar.tags)
    if (!parsed.query.conditions.length) {
      showToast('没识别出条件，试试「本周到期的高优先级任务」')
      return
    }
    setQuery(parsed.query)
    setMatch(parsed.query.match)
    if (parsed.unresolved.length) {
      showToast(`有 ${parsed.unresolved.length} 个词没认出来：${parsed.unresolved.join('、')}`)
    } else {
      showToast(`已识别 ${parsed.used.length} 个条件`)
    }
  }

  const save = async (): Promise<void> => {
    const clean = name.trim()
    if (!clean) {
      showToast('请给过滤器起个名字')
      return
    }
    const payload: FilterQuery = { match, conditions: query.conditions }
    try {
      if (editingFilter) {
        await window.api.filters.update(editingFilter.id, { name: clean, query: payload })
        await loadFilters()
        if (useStore.getState().view.type === 'filter') {
          setView('filter', { filterId: editingFilter.id, title: clean })
        }
        showToast('过滤器已更新')
      } else {
        const created = await window.api.filters.create({ name: clean, query: payload })
        await loadFilters()
        setView('filter', { filterId: created.id, title: created.name })
        showToast('过滤器已创建')
      }
      closeFilterEditor()
    } catch (error) {
      showToast(`保存失败：${String(error)}`)
    }
  }

  const remove = async (): Promise<void> => {
    if (!editingFilter) return
    if (!window.confirm(`删除过滤器「${editingFilter.name}」？`)) return
    await window.api.filters.remove(editingFilter.id)
    await loadFilters()
    closeFilterEditor()
    setView('today', { title: '今天' })
    showToast('过滤器已删除')
  }

  const summary = useMemo(
    () => filterSummary({ match, conditions: query.conditions }, sidebar.lists, sidebar.tags),
    [match, query, sidebar.lists, sidebar.tags]
  )

  if (!filterEditorOpen) return null

  return (
    <div className="overlay" onMouseDown={closeFilterEditor}>
      <div className="filter-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="filter-head">
          <div>
            <h2>{editingFilter ? '编辑过滤器' : '新建过滤器'}</h2>
            <p>把常用条件保存成侧栏里的动态视图。</p>
          </div>
          <button className="icon-btn" aria-label="关闭" onClick={closeFilterEditor}>
            <X size={16} />
          </button>
        </div>

        <label className="filter-name">
          <span>名称</span>
          <input
            autoFocus
            value={name}
            placeholder="例如：本周客户跟进"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="filter-nl">
          <Sparkles size={14} />
          <input
            value={nl}
            placeholder="用一句话描述：本周到期的高优先级任务"
            onChange={(event) => setNl(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') applyNaturalLanguage()
            }}
          />
          <button className="mini-btn" onClick={applyNaturalLanguage}>
            识别
          </button>
        </div>

        <div className="filter-match">
          <span>满足</span>
          <select value={match} onChange={(event) => setMatch(event.target.value as 'all' | 'any')}>
            <option value="all">全部条件（AND）</option>
            <option value="any">任一条件（OR）</option>
          </select>
        </div>

        <div className="filter-conditions">
          {query.conditions.map((condition, index) => (
            <div className="filter-row" key={index}>
              <select
                aria-label="字段"
                value={condition.field}
                onChange={(event) => {
                  const field = event.target.value as FilterCondition['field']
                  const op = FILTER_OPS[field][0].value
                  updateCondition(index, {
                    field,
                    op,
                    value: field === 'priority' ? '3' : field === 'scheduled' || field === 'due' ? 'today' : ''
                  })
                }}
              >
                {FILTER_FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>

              <select
                aria-label="操作"
                value={condition.op}
                onChange={(event) => updateCondition(index, { op: event.target.value as FilterOp })}
              >
                {(FILTER_OPS[condition.field] ?? []).map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              <FilterValue
                condition={condition}
                onChange={(value) => updateCondition(index, { value })}
              />

              <button className="icon-btn" title="删除条件" onClick={() => removeCondition(index)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button className="ghost-btn filter-add" onClick={addCondition}>
            <Plus size={14} /> 添加条件
          </button>
        </div>

        <div className="filter-preview">
          <span>{summary}</span>
          <strong>{preview === null ? '—' : `${preview} 项`}</strong>
        </div>

        <div className="filter-foot">
          {editingFilter && (
            <button className="danger-btn" onClick={() => void remove()}>
              删除
            </button>
          )}
          <span className="filter-foot-spacer" />
          <button className="ghost-btn" onClick={closeFilterEditor}>
            取消
          </button>
          <button className="primary-btn" onClick={() => void save()}>
            {editingFilter ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FilterValue({
  condition,
  onChange
}: {
  condition: FilterCondition
  onChange: (value: string) => void
}): React.JSX.Element | null {
  if (condition.field === 'priority') {
    return (
      <select aria-label="优先级" value={condition.value} onChange={(event) => onChange(event.target.value)}>
        {PRIORITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }
  if (condition.field === 'status') {
    return (
      <select aria-label="状态" value={condition.value} onChange={(event) => onChange(event.target.value)}>
        <option value="active">未完成</option>
        <option value="done">已完成</option>
      </select>
    )
  }
  if (condition.field === 'someday') {
    return (
      <select aria-label="也许" value={condition.value} onChange={(event) => onChange(event.target.value)}>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    )
  }
  if (condition.field === 'list') {
    return <ListValue value={condition.value} onChange={onChange} />
  }
  if (condition.field === 'tag') {
    return <TagValue value={condition.value} onChange={onChange} />
  }
  if (condition.field === 'scheduled' || condition.field === 'due') {
    if (condition.op === 'empty' || condition.op === 'notEmpty') return <span className="filter-no-value">—</span>
    return (
      <span className="filter-date-value">
        <select aria-label="日期" value={condition.value} onChange={(event) => onChange(event.target.value)}>
          {DATE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="具体日期"
          value={/^\d{4}-\d{2}-\d{2}$/.test(condition.value) ? condition.value : ''}
          onChange={(event) => event.target.value && onChange(event.target.value)}
        />
      </span>
    )
  }
  if (condition.field === 'text') {
    return (
      <input
        aria-label="包含文字"
        value={condition.value}
        placeholder="包含的文字"
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  return <span className="filter-no-value">—</span>
}

function ListValue({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const { sidebar } = useStore()
  return (
    <select aria-label="清单" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">选择清单</option>
      <option value="none">未分类</option>
      {sidebar.lists.map((list) => (
        <option key={list.id} value={list.id}>
          {list.name}
        </option>
      ))}
    </select>
  )
}

function TagValue({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const { sidebar } = useStore()
  return (
    <select aria-label="标签" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">选择标签</option>
      {sidebar.tags.map((tag) => (
        <option key={tag.id} value={tag.id}>
          #{tag.name}
        </option>
      ))}
    </select>
  )
}
