# Legacy review ledger contract release

These migrations are intentionally outside `prisma/migrations`. The normal
application release is an expand-only release: it deploys the new writer while
the legacy trigger remains available. Run the dedicated contract workflow only
after every old application instance is gone and the quiet-window check passes.

The workflow builds a temporary Prisma migration path containing the regular
migrations plus these contract migrations, so the contract is still recorded
in `_prisma_migrations` when it is applied.
