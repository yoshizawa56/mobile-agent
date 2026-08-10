## Summary

<!-- What changed and why? -->

## Verification

- [ ] `pnpm audit:public`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Storybook or browser behavior checked when UI changed

## Security and data review

- [ ] No credentials, private terminal output, personal data, local databases, logs, or machine-specific paths are included.
- [ ] Any changed trust boundary or credential handling is documented in `SECURITY.md`.
- [ ] This change does not expose agentd directly to the public internet.

## Notes for reviewers

<!-- Migration, limitations, follow-up work, or test setup. -->
