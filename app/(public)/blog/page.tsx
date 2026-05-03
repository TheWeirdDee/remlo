import * as React from 'react'

export const metadata = { title: 'Blog | Remlo' }

const POSTS = [
  {
    category: 'Engineering',
    title: 'Multi-rail x402 in production: Tempo, Base, and Solana in one 402 response',
    excerpt: 'How we route a single API call to three different facilitators based on which protocol header the agent supplies, why state-mutating endpoints stay single-chain, and what the runtime 402 actually looks like.',
    author: 'Engineering team',
    date: 'May 3, 2026',
  },
  {
    category: 'Product',
    title: 'Three primitives, two settlement chains',
    excerpt: 'Why payroll, escrow, and reputation belong in one stack, and what changes when settled work writes portable on-chain credentials that other protocols can read.',
    author: 'Product team',
    date: 'April 21, 2026',
  },
]

export default function BlogPage() {
  return (
    <div className="space-y-16">
      <div className="max-w-xl">
        <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4 tracking-tight">The Remlo Blog</h1>
        <p className="text-lg text-[var(--text-secondary)]">Insights into the evolution of global labor markets and decentralized finance.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {POSTS.map((post) => (
          <div key={post.title} className="group p-6 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] hover:border-[var(--accent)] transition-all flex flex-col cursor-pointer">
            <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--accent)] mb-4">{post.category}</span>
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-3 group-hover:text-[var(--accent)] transition-colors">{post.title}</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-8 flex-1 leading-relaxed">
              {post.excerpt}
            </p>
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>By {post.author}</span>
              <span>{post.date}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
