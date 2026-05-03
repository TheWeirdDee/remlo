import * as React from 'react'
import { ManageCookiesLink } from '@/components/legal/ManageCookiesLink'

export const metadata = { title: 'Cookie Policy | Remlo' }

export default function CookiePolicyPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-8 tracking-tight">Cookie Policy</h1>
      <p className="text-lg text-[var(--text-secondary)] mb-12">Last updated: May 3, 2026</p>

      <div className="space-y-12">
        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">What cookies are</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Cookies are small files a website stores on your device. They keep you signed in, remember preferences, and help us understand how the product is used. Some are essential for the site to function. Others are optional and only set if you choose to allow them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">How Remlo uses cookies</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-6">
            We group cookies into four categories. You control three of them. Essential cookies are always on because the site cannot function without them.
          </p>
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 uppercase tracking-wider">Essential</h3>
              <p className="text-[var(--text-secondary)]">
                Required for sign-in sessions, security tokens, CSRF protection, and the consent record itself. These cannot be disabled. The consent record is stored as an essential cookie so we know which categories you have allowed.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 uppercase tracking-wider">Preferences</h3>
              <p className="text-[var(--text-secondary)]">
                Remember choices you make: theme (light or dark), language, dashboard layout. Off by default. Useful but not required to use the product.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 uppercase tracking-wider">Analytics</h3>
              <p className="text-[var(--text-secondary)]">
                Help us understand which features are used, where users get stuck, and how performance varies across regions. Anonymized in aggregate. We do not sell it. Off by default.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 uppercase tracking-wider">Marketing</h3>
              <p className="text-[var(--text-secondary)]">
                Third-party pixels for retargeting and ad attribution on platforms where we run campaigns. Off by default. Currently we run no marketing campaigns, so this category is reserved for future use and remains inert until needed.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Your choice</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
            On your first visit to remlo.xyz, a banner asks you to accept all cookies, reject everything except essential, or pick categories. Whatever you choose is recorded and applied immediately. Your choice persists for one year, then we ask again.
          </p>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
            You can revisit your choice at any time:
          </p>
          <p>
            <ManageCookiesLink className="inline-flex h-10 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90">
              Manage cookie preferences
            </ManageCookiesLink>
          </p>
          <p className="text-[var(--text-secondary)] leading-relaxed mt-4">
            You can also clear cookies through your browser settings. Disabling essential cookies prevents sign-in and breaks core dashboard features.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Changes to this policy</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            If we materially change which categories we use or what each category covers, we bump the policy version. The next time you visit, the banner reappears so you can review the new categories before consent applies. Minor wording updates do not trigger a new prompt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Contact</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Questions about this policy or how we handle data? Email <span className="font-semibold text-[var(--text-primary)]">hello@remlo.xyz</span>.
          </p>
        </section>
      </div>
    </article>
  )
}
