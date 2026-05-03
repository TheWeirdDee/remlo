import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownTextProps {
  text: string
  className?: string
}

export function MarkdownText({ text, className }: MarkdownTextProps) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed text-[var(--text-secondary)] space-y-2',
        '[&_strong]:font-semibold [&_strong]:text-[var(--text-primary)]',
        '[&_em]:italic',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1',
        '[&_code]:rounded [&_code]:bg-[var(--bg-base)] [&_code]:px-1 [&_code]:py-0.5',
        '[&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-[var(--text-primary)]',
        '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-[var(--text-primary)]',
        '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-[var(--text-primary)]',
        '[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wider [&_h3]:text-[var(--text-muted)]',
        '[&_a]:text-[var(--accent)] [&_a]:underline',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
}
