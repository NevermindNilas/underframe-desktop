# Contributing

- Contributions are accepted under the project license, `AGPL-3.0-only` (see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md)).
- Run `npm test` before sending changes; all tests must pass.
- Keep stat and game logic in `src/shared/` as plain ES modules, with tests in `test/`. The renderer and main process should stay thin.
- Never commit contents of `core/` (engine, loader, data) to this public repository. Only the submodule pointer is tracked here.
- Questions or bugs about the damage engine itself go to the Underframe developer (Discord linked on [underframe.site](https://www.underframe.site)), not this repo.
