# Role
Act as a Code Generator for an API QA PoC. Build a Postman Collection v2.1 from testcases.json using the npm library "postman-collection".

# Goal
Generate a minimal set of files for a Node.js project that:
- Reads testcases.json.
- Generates collection.json (Postman Collection v2.1) using `postman-collection`.
- Inserts tests into the "test" event for each request, based on "assertions".
- Supports collection variables and default headers.
- Does not require Postman GUI; must run via CLI.

# Rules
- Do not hardcode any specific endpoint: EVERYTHING is derived from testcases.json.
- Generate deterministic, readable, and robust code.
- Handle query params: if the value is an array, serialize properly.
- Handle raw JSON body when body != null:
  - Add `Content-Type: application/json` if missing.
  - Set Postman raw body language so Postman UI treats it as JSON:
    - `body.options.raw.language = "json"`
- Handle requiresAuth: if true and variables.accessToken exists, add Authorization: Bearer {{accessToken}} header. If missing, log a warning in the generated script but proceed.
- Generate Postman tests (pm.test()) for each assertion:
  - status/equals -> pm.response.to.have.status(...)
  - header_present -> pm.expect(pm.response.headers.has(name)).to.eql(true)
  - content_type_includes -> pm.expect(pm.response.headers.get("Content-Type")).to.include(value)
  - json_is_array -> pm.expect(pm.response.json()).to.be.an("array")
  - json_array_min_length -> pm.expect(pm.response.json().length).to.be.at.least(min)
  - json_path_exists -> Evaluate safely using a helper function `resolvePath(json, path)` that handles nested fields (dot notation) and arrays, checking !== undefined.

## Known Failure Mode: Malformed URLs with `_postman_*` query keys
If Newman prints URLs like:
`...?members&reference&Type&_postman_listIndexKey=key&_postman_listAllowsMultipleValues`
that indicates the generated `collection.json` accidentally serialized Postman SDK internal `PropertyList` metadata into the URL query.

To prevent this:
- Treat `tc.query` as a plain JSON object only (keys -> primitive or array of primitives).
- NEVER pass Postman SDK objects (like `url.query`, `sdk.PropertyList`, etc.) into `url.query.add(...)`.
- Avoid generic helpers that accept unknown objects for `query`.
- Prefer adding query params inline with strict guards + string coercion.
- Prefer passing `url.toJSON()` into `sdk.Request` rather than the live `sdk.Url` instance.

### IMPORTANT: Postman SDK export bug workaround (required)
In some versions of `postman-collection` (including "latest" at times), exporting a full `sdk.Collection` can still serialize the URL query into internal SDK metadata (keys like `members`, `reference`, `Type`, `_postman_listIndexKey`, etc.), even if you pass `url.toJSON()` into `sdk.Request`.

Therefore, to guarantee a valid Postman collection:
- Track the intended URL for each testcase as plain JSON (no SDK objects):
  - `raw`: `{{baseUrl}}` + `tc.path` plus a querystring if present
  - `host`: `["{{baseUrl}}"]`
  - `path`: `tc.path` split by `/` into segments (ignore any `?`)
  - `query`: array of `{ key, value }` where arrays become repeated keys
- After building the collection, do `const exported = collection.toJSON()`.
- For each exported item in order, overwrite `exported.item[i].request.url = intendedUrls[i]`.
- ALSO overwrite headers/body in exported JSON to avoid SDK export omissions and to ensure Postman sends JSON correctly:
  - `exported.item[i].request.header = intendedHeaders[i]`
  - If body exists: `exported.item[i].request.body = intendedBodies[i]` (with `options.raw.language = "json"`)
- Write `collection.json` from `exported`.

# Files to Generate (MANDATORY)
Create exactly these files (with content):
- package.json
- build_collection.js
- README.md

# package.json
- name: "qa-agent-postman-poc"
- scripts:
  - "build": "node build_collection.js"
- dependencies:
  - postman-collection (latest)

# build_collection.js: Minimum Requirements
- Validate that testcases.json exists, read it, parse JSON.
- Create Collection with info.name.
- Add collection variables:
  - baseUrl
  - all keys from "variables"
- For each testcase:
  - Create Item with Request.
  - Apply defaultHeaders + testcase headers (testcase headers override).
  - Construct URL:
    - Instantiate `const url = new sdk.Url("{{baseUrl}}" + tc.path)`.
    - For query params, iterate and add safely *inline* (no generic helper):
      - `const query = tc.query || {}`
      - Guard: if `query` is not a plain object, throw.
      - For each entry:
        - If value is an array: for each element `v`, add `url.query.add({ key, value: String(v) })`.
        - Else if value is not null/undefined: add `url.query.add({ key, value: String(value) })`.
      - IMPORTANT: only add primitives (string/number/boolean). If an element is an object, throw.
    - When creating the request, pass `url: url.toJSON()` (not the `sdk.Url` instance) to avoid leaking SDK internal state into the serialized JSON.
    - ALSO build and store a plain-JSON "intended URL" object for this testcase (raw/host/path/query) and use the export-workaround described above to overwrite `request.url` in the final exported JSON.
  - Add "test" Event with an Exec Script (array of strings) generated from assertions.
- Export collection.json using JSON.stringify(..., null, 2).
- Console log: Number of processed testcases and path of generated file.

# README.md
- Short instructions:
  - npm install
  - Place testcases.json in root
  - npm run build (generates collection.json)

# Output: Response Format (MANDATORY)
Respond ONLY with 3 blocks in this order:
1) ```json``` (package.json)
2) ```javascript``` (build_collection.js)
3) ```md``` (README.md)

Do not add text outside these blocks.