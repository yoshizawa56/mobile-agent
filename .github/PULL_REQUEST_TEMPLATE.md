<!--
  Pull request titles, descriptions, and review discussion must be written in English.
  Open this pull request from a feature branch; do not target a direct push workflow.
-->

## Summary

<!-- What changed, why was it needed, and what is the user-visible impact? -->

## Verification

- [ ] `bun audit:public`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] Storybook or browser behavior checked when UI changed

## Security and data review

- [ ] No credentials, private terminal output, personal data, local databases, logs, or machine-specific paths are included.
- [ ] Any changed trust boundary or credential handling is documented in `SECURITY.md`.
- [ ] This change does not expose agentd directly to the public internet.

## Notes for reviewers

<!-- Migration, limitations, follow-up work, or test setup. -->
