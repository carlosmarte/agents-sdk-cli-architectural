.PHONY: ci ts py parity ci-parity lint test build

ci:
	$(MAKE) -C ts ci && $(MAKE) -C py ci

ts:
	$(MAKE) -C ts ci

py:
	$(MAKE) -C py ci

lint:
	$(MAKE) -C ts lint && $(MAKE) -C py lint

test:
	$(MAKE) -C ts test && $(MAKE) -C py test

build:
	$(MAKE) -C ts build && $(MAKE) -C py build

# Cross-language equivalence gate (Feature 07, Story 03): run BOTH twins against
# the shared packages/fixtures/parity/ golden fixtures. `&&` fails fast — a
# TS-side drift short-circuits before the Python run, so the single non-zero exit
# names the drifting language.
parity:
	$(MAKE) -C ts parity && $(MAKE) -C py parity

# Full gate CI runs: the per-language pipelines, then prove twin parity.
ci-parity: ci parity
