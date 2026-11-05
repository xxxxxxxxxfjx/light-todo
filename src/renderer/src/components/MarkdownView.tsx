import type { Block, Inline } from '../lib/markdown'

function Inlines({ nodes, onOpenLink }: { nodes: Inline[]; onOpenLink?: (href: string) => void }): React.JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'code') return <code key={index}>{node.text}</code>
        if (node.type === 'strong') return <strong key={index}>{node.text}</strong>
        if (node.type === 'em') return <em key={index}>{node.text}</em>
        if (node.type === 'link') {
          return (
            <a
              key={index}
              href={node.href}
              className="md-link"
              title={node.href}
              onClick={(event) => {
                event.preventDefault()
                onOpenLink?.(node.href)
              }}
            >
              {node.text}
            </a>
          )
        }
        return <span key={index}>{node.text}</span>
      })}
    </>
  )
}

export function MarkdownView({
  blocks,
  onToggleChecklist,
  onOpenLink
}: {
  blocks: Block[]
  onToggleChecklist?: (line: number) => void
  onOpenLink?: (href: string) => void
}): React.JSX.Element {
  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = (`h${Math.min(6, block.level)}` as 'h1')
          return (
            <Tag key={index} className={`md-heading md-h${block.level}`}>
              <Inlines nodes={block.inlines} onOpenLink={onOpenLink} />
            </Tag>
          )
        }
        if (block.type === 'code') {
          return (
            <pre key={index} className="md-code">
              <code>{block.text}</code>
            </pre>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={index} className="md-quote">
              <Inlines nodes={block.inlines} onOpenLink={onOpenLink} />
            </blockquote>
          )
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return (
            <ListTag key={index} className="md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className={item.checked !== undefined ? 'md-check-item' : ''}>
                  {item.checked !== undefined ? (
                    <button
                      type="button"
                      className={`md-check ${item.checked ? 'checked' : ''}`}
                      aria-label={item.checked ? '取消勾选' : '勾选'}
                      aria-pressed={item.checked}
                      onClick={() => onToggleChecklist?.(item.line)}
                    >
                      {item.checked ? '✓' : ''}
                    </button>
                  ) : null}
                  <span>
                    <Inlines nodes={item.inlines} onOpenLink={onOpenLink} />
                  </span>
                </li>
              ))}
            </ListTag>
          )
        }
        return (
          <p key={index} className="md-paragraph">
            <Inlines nodes={block.inlines} onOpenLink={onOpenLink} />
          </p>
        )
      })}
      {!blocks.length && <div className="md-empty">还没有备注</div>}
    </div>
  )
}
