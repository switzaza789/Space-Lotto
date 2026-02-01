---
name: vercel-react-best-practices
description: React & Next.js performance optimization guidelines. Use when writing, reviewing, or refactoring React/Next.js code for optimal performance patterns.
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# React & Next.js Performance Best Practices

Comprehensive performance optimization guidelines from Vercel Engineering (40+ rules, 8 categories).

## When to Use

Apply this skill when:
- Writing React components
- Building Next.js pages
- Implementing data fetching
- Optimizing bundle size
- Reviewing code for performance

## Rule Categories (Priority Order)

### 1. CRITICAL: Eliminating Waterfalls
- **async-defer-await**: Don't await sequentially; use `Promise.all()` for parallel fetches
- **parallel-data-fetching**: Fetch data in parallel at route level, not in components
- **streaming-suspense**: Use `<Suspense>` boundaries for streaming SSR
- **avoid-client-fetch-cascade**: Don't fetch parent → child → grandchild sequentially

### 2. CRITICAL: Bundle Size Optimization
- **bundle-dynamic-imports**: Use `dynamic()` for heavy components not needed on first paint
- **tree-shaking**: Import specific functions, not entire libraries (`import { debounce } from 'lodash-es'`)
- **lazy-load-below-fold**: Code-split components below the fold
- **avoid-barrel-files**: Don't re-export everything from `index.ts`
- **analyze-bundle**: Use `@next/bundle-analyzer` to find bloat

### 3. HIGH: Server-Side Performance
- **server-cache-react**: Use React `cache()` for request deduplication
- **unstable-cache**: Use `unstable_cache` for cross-request caching
- **revalidate-patterns**: Choose correct ISR revalidation strategy
- **server-components-first**: Default to Server Components; opt into Client only when needed
- **avoid-use-client-at-top**: Push `'use client'` as low as possible in component tree

### 4. MEDIUM-HIGH: Client-Side Data Fetching
- **swr-for-client**: Use SWR or React Query for client data fetching
- **prefetch-on-hover**: Prefetch data on hover for instant navigations
- **optimistic-updates**: Update UI before server confirms for perceived speed
- **stale-while-revalidate**: Show stale data immediately while fetching fresh

### 5. MEDIUM: Re-render Optimization
- **memo-expensive-components**: Wrap expensive components in `React.memo()`
- **callback-stability**: Use `useCallback` for stable function references
- **memoize-computations**: Use `useMemo` for expensive calculations
- **avoid-inline-objects**: Don't pass `{{ color: 'red' }}` inline in JSX
- **state-colocation**: Keep state as close to where it's used as possible
- **context-splitting**: Split contexts to prevent unnecessary re-renders

### 6. MEDIUM: Rendering Performance
- **virtualize-lists**: Use `@tanstack/virtual` for lists > 50 items
- **skeleton-loading**: Show skeleton UI instead of spinners
- **image-optimization**: Always use `next/image` with proper sizing
- **font-optimization**: Use `next/font` for zero-layout-shift fonts

### 7. LOW-MEDIUM: JavaScript Performance
- **debounce-inputs**: Debounce search inputs and resize handlers
- **avoid-blocking-main-thread**: Offload heavy computation to Web Workers
- **requestAnimationFrame**: Use rAF for animations, not setInterval
- **intersection-observer**: Use IO for lazy loading, not scroll listeners

### 8. LOW: Advanced Patterns
- **partial-prerendering**: Use PPR for static shell + dynamic holes
- **edge-runtime**: Use Edge Runtime for geo-aware, low-latency responses
- **route-handlers-streaming**: Stream large responses from Route Handlers

## Output Format

When reviewing code, output findings as:
```
file:line - [PRIORITY] rule-name: description of issue and fix
```

Example:
```
src/app/page.tsx:15 - [CRITICAL] async-defer-await: Sequential awaits cause waterfall. Use Promise.all([fetchA(), fetchB()])
src/components/Chart.tsx:1 - [CRITICAL] bundle-dynamic-imports: Heavy chart library should use dynamic() import
```

## Usage

1. When asked to review React/Next.js code, apply ALL rules above
2. Prioritize CRITICAL and HIGH rules first
3. Provide specific code fixes, not just descriptions
4. Consider the full component tree, not just individual files
