# packages/ts — CI Makefile (TypeScript / pnpm workspace, scope @llmorch)
#
# Thin wrapper around pnpm for local + CI parity. Operates at the workspace
# root and fans out to every @llmorch/* member package via `pnpm -r`.
# Every target is idempotent. `make ci` is the single command CI runs.

SHELL          := /bin/bash
.SHELLFLAGS    := -eu -o pipefail -c
.DEFAULT_GOAL  := help

PKG_DIR        := $(abspath $(CURDIR))
PNPM           ?= pnpm
NODE           ?= node
# Recurse across all workspace packages, fail if a script is missing only
# where we expect it (use --if-present for optional per-pkg scripts).
PNPM_REC       := $(PNPM) -r

# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN{FS=":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: print-env
print-env: ## Print tool versions (debug)
	@echo "pkg-dir : $(PKG_DIR)"
	@$(NODE) --version
	@$(PNPM) --version

# ---------------------------------------------------------------------------
# lifecycle
# ---------------------------------------------------------------------------

.PHONY: install
install: ## Install dependencies (mutable lockfile OK)
	@$(PNPM) install

.PHONY: ci-install
ci-install: ## Deterministic install for CI (frozen lockfile)
	@$(PNPM) install --frozen-lockfile

.PHONY: lint
lint: ## Static checks (eslint + tsc --noEmit) across all packages
	@$(PNPM_REC) lint
	@$(PNPM_REC) exec tsc --noEmit

.PHONY: test
test: ## Run the vitest suite across all packages
	@$(PNPM_REC) test

.PHONY: build
build: ## Compile every package to its ./dist via tsc
	@$(PNPM_REC) run build

.PHONY: clean
clean: ## Remove generated artifacts (dist, tsbuildinfo)
	@$(PNPM_REC) exec rm -rf dist
	@find . -name '*.tsbuildinfo' -delete

.PHONY: distclean
distclean: clean ## Also remove installed dependencies (node_modules)
	@find . -name node_modules -type d -prune -exec rm -rf '{}' +

# ---------------------------------------------------------------------------
# parity (cross-language equivalence harness — see Feature 07, Story 03)
# ---------------------------------------------------------------------------

.PHONY: parity
parity: ## Run the TS side of the polyglot parity harness against shared fixtures
	@$(PNPM) --filter @llmorch/core run parity

# ---------------------------------------------------------------------------
# CI aggregate
# ---------------------------------------------------------------------------

.PHONY: ci
ci: ci-install lint test build ## Full CI pipeline (install → lint → test → build)
