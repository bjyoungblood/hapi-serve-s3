ESLINT = node_modules/.bin/eslint
BABEL = node_modules/.bin/babel

export NODE_ENV = test

.PHONY: clean dist lint

dist: clean
	$(BABEL) src/ --modules common --out-dir dist

dist-watch: clean
	$(BABEL) src/ --modules common --out-dir dist --watch

clean:
	rm -r dist || true

lint:
	$(ESLINT) --ext .js --ext .jsx .
