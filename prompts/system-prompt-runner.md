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
- Handle raw JSON body when body != null (add Content-Type: application/json if missing).
- Handle requiresAuth: if true and variables.accessToken exists, add Authorization: Bearer {{accessToken}} header. If missing, log a warning in the generated script but proceed.
- Generate Postman tests (pm.*) for each assertion:
  - status/equals -> pm.response.to.have.status(...)
  - header_present -> pm.expect(pm.response.headers.has(name)).to.eql(true)
  - content_type_includes -> pm.expect(pm.response.headers.get("Content-Type")).to.include(value)
  - json_is_array -> pm.expect(pm.response.json()).to.be.an("array")
  - json_array_min_length -> pm.expect(pm.response.json().length).to.be.at.least(min)
  - json_path_exists -> Evaluate safely using a helper function `resolvePath(json, path)` that handles nested fields (dot notation) and arrays, checking !== undefined.

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
    - Instantiate `const url = new sdk.Url("{{baseUrl}}" + path)`.
    - For query params, iterate and add safely: `url.query.add(new sdk.QueryParam({ key, value }))`. Do NOT use `addQueryParams` with an array to avoid serialization artifacts.
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