# packages/py — CI Makefile (Python / uv workspace, llmorch_* packages)
#
# Thin wrapper around uv for local + CI parity. Operates at the workspace
# root; uv resolves all llmorch-* members from the single workspace lock.
# Every target is idempotent. `make ci` is the single command CI runs.

SHELL          := /bin/bash
.SHELLFLAGS    := -eu -o pipefail -c
.DEFAULT_GOAL  := help

PKG_DIR        := $(abspath $(CURDIR))
UV             ?= uv
RUFF           := $(UV) run ruff
PYTEST         := $(UV) run pytest
MYPY           := $(UV) run mypy

# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN{FS=":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: print-env
print-env: ## Print tool versions (debug)
	@echo "pkg-dir : $(PKG_DIR)"
	@$(UV) --version
	@$(UV) run python --version

# ---------------------------------------------------------------------------
# lifecycle
# ---------------------------------------------------------------------------

.PHONY: install
install: ## Install dependencies (mutable lockfile OK)
	@$(UV) sync --all-packages

.PHONY: ci-install
ci-install: ## Deterministic install for CI (frozen lockfile)
	@$(UV) sync --all-packages --frozen

.PHONY: lint
lint: ## Static checks (ruff check + mypy)
	@$(RUFF) check .
	@$(RUFF) format --check .
	@$(MYPY) .

.PHONY: test
test: ## Run the pytest suite across all packages (parity is a separate gate)
	@$(PYTEST) -q -m "not parity"

.PHONY: build
build: ## Build wheels/sdists for every workspace member into ./dist
	@rm -rf dist
	@$(UV) build --all-packages --out-dir dist

.PHONY: clean
clean: ## Remove generated artifacts (dist, caches)
	@rm -rf dist
	@find . -type d -name __pycache__ -prune -exec rm -rf '{}' +
	@rm -rf .pytest_cache .ruff_cache .mypy_cache

.PHONY: distclean
distclean: clean ## Also remove the virtual environment
	@rm -rf .venv

# ---------------------------------------------------------------------------
# parity (cross-language equivalence harness — see Feature 07, Story 03)
# ---------------------------------------------------------------------------

.PHONY: parity
parity: ## Run the Python side of the polyglot parity harness against shared fixtures
	@$(PYTEST) -q -m parity

# ---------------------------------------------------------------------------
# CI aggregate
# ---------------------------------------------------------------------------

.PHONY: ci
ci: ci-install lint test build ## Full CI pipeline (install → lint → test → build)
