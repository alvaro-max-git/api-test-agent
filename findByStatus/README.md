# QA Agent Postman PoC (findByStatus)

This folder contains a minimal Node.js generator that reads `testcases.json` and produces a Postman Collection v2.1 (`collection.json`) using `postman-collection`.

## Usage

1) Install dependencies:

```bash
npm install
```

2) Build the Postman collection:

```bash
npm run build
```

This generates `collection.json` in this same folder.

## Notes

- The collection and request tests are generated from `testcases.json` assertions.
- The collection `info.description` is populated from `findByStatus.feature`.
- The generator applies a required Postman SDK export workaround to avoid malformed URLs containing internal `_postman_*` query keys.
