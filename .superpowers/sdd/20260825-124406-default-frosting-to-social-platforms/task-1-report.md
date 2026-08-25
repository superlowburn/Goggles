# Task 1 report: social-only default policy foundation

## Status

Implementation committed. The required live-site visual QA is not included in this task-level report and remains for the delivery-level gate.

## Files changed

- `src/shared/site-policy.ts`
- `src/background/service-worker.ts`
- `src/content/index.ts`
- `tests/unit/site-policy.test.ts`
- `tests/unit/service-worker.test.ts`
- `tests/unit/content-controller.test.ts`
- `.superpowers/sdd/20260825-124406-default-frosting-to-social-platforms/task-1-report.md`

## Red commands and expected failures

- `npm test -- tests/unit/site-policy.test.ts` — 22 failures: the non-social default was still `protected`; the social catalog, matcher, platform key helper, and migration were absent.
- `npm test -- tests/unit/service-worker.test.ts` — 2 failures: the non-social worker response was still `protected`, and update installation did not migrate a trusted legacy social rule.
- `npm test -- tests/unit/content-controller.test.ts` — 2 failures: failed policy messaging still used the hard-coded `protected` fallback on non-social origins.

## Green commands and exact results

- `npm test -- tests/unit/site-policy.test.ts` — 28 passed.
- `npm test -- tests/unit/service-worker.test.ts` — 12 passed.
- `npm test -- tests/unit/content-controller.test.ts` — 45 passed.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.

## Full-suite result

`npm run test:unit` — 20 files passed, 223 tests passed.

## Commit SHA

`9b7a186e628c905bc7f2c4428b74a4834fc6e5d5`

## Self-review

- The one ordered catalog uses URL-normalized hostnames and only accepts exact hosts or dot-boundary subdomains, excluding the listed short/embed hosts and deceptive suffixes.
- Social reads/writes/watches use platform keys with the required legacy exact-origin fallback; non-social rules retain normalized exact origin, including scheme and non-default port.
- The migration is non-destructive, only promotes explicitly trusted legacy rules, and preserves any existing platform key.
- No Blocked Subjects, classifier, media rendering, provider gating, manifest, or packaging code was changed.

## Concerns

- The project-wide required live visual QA on Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal remains to be run at the delivery level; it was not safe to run the repository's existing headed live test because the project rules prohibit focus-stealing browser automation.
