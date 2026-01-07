const fs = require('fs');
const path = require('path');
const sdk = require('postman-collection');

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPrimitive(value) {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function buildQueryArray(queryObject) {
  if (queryObject == null) return [];
  if (!isPlainObject(queryObject)) {
    throw new Error('tc.query must be a plain JSON object');
  }

  const queryArray = [];
  for (const [key, value] of Object.entries(queryObject)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (element === null || element === undefined) continue;
        if (!isPrimitive(element)) {
          throw new Error(
            `Query param "${key}" contains non-primitive array element`
          );
        }
        queryArray.push({ key: String(key), value: String(element) });
      }
      continue;
    }

    if (value === null || value === undefined) continue;
    if (!isPrimitive(value)) {
      throw new Error(`Query param "${key}" must be a primitive or array`);
    }
    queryArray.push({ key: String(key), value: String(value) });
  }

  return queryArray;
}

function toQueryString(queryArray) {
  if (!queryArray.length) return '';
  const parts = queryArray.map(({ key, value }) => {
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  });
  return `?${parts.join('&')}`;
}

function buildIntendedUrl(tc) {
  const cleanPath = String(tc.path || '').split('?')[0];
  const pathSegments = cleanPath
    .split('/')
    .filter(Boolean)
    .map((s) => String(s));

  const queryArray = buildQueryArray(tc.query || {});

  return {
    raw: `{{baseUrl}}${cleanPath}${toQueryString(queryArray)}`,
    host: ['{{baseUrl}}'],
    path: pathSegments,
    query: queryArray
  };
}

function mergeHeaders(defaultHeaders, testcaseHeaders) {
  const merged = new Map();

  const add = (headersObj) => {
    if (!headersObj) return;
    if (!isPlainObject(headersObj)) {
      throw new Error('headers must be a plain JSON object');
    }

    const keys = Object.keys(headersObj).sort((a, b) =>
      a.localeCompare(b, 'en')
    );
    for (const key of keys) {
      const value = headersObj[key];
      if (value === null || value === undefined) continue;
      merged.set(String(key).toLowerCase(), { key: String(key), value: String(value) });
    }
  };

  add(defaultHeaders);
  add(testcaseHeaders);

  return Array.from(merged.values());
}

function buildIntendedHeaders(headersArray) {
  const out = [];
  for (const h of headersArray || []) {
    if (!h || typeof h !== 'object') continue;
    if (!h.key) continue;
    out.push({ key: String(h.key), value: String(h.value ?? '') });
  }
  return out;
}

function hasHeader(headersArray, headerName) {
  const target = String(headerName).toLowerCase();
  return headersArray.some((h) => String(h.key).toLowerCase() === target);
}

function buildTestScript(assertions) {
  const lines = [];

  lines.push('function resolvePath(obj, path) {');
  lines.push('  if (obj === null || obj === undefined) return undefined;');
  lines.push('  if (!path) return undefined;');
  lines.push('  const parts = [];');
  lines.push('  const re = /[^.[\\]]+|\\[(\\d+)\\]/g;');
  lines.push('  let m;');
  lines.push('  while ((m = re.exec(path)) !== null) {');
  lines.push('    if (m[0][0] === "[") parts.push(Number(m[1]));');
  lines.push('    else parts.push(m[0]);');
  lines.push('  }');
  lines.push('  let cur = obj;');
  lines.push('  for (const part of parts) {');
  lines.push('    if (cur === null || cur === undefined) return undefined;');
  lines.push('    if (typeof part === "number") {');
  lines.push('      if (!Array.isArray(cur)) return undefined;');
  lines.push('      cur = cur[part];');
  lines.push('    } else {');
  lines.push('      cur = cur[part];');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return cur;');
  lines.push('}');
  lines.push('');

  lines.push('let __json;');
  lines.push('try { __json = pm.response.json(); } catch (e) { __json = undefined; }');
  lines.push('');

  const list = Array.isArray(assertions) ? assertions : [];

  for (const a of list) {
    if (!a || typeof a !== 'object') continue;

    if (a.type === 'status' && typeof a.equals === 'number') {
      lines.push(`pm.test("status/equals: ${a.equals}", function () {`);
      lines.push(`  pm.response.to.have.status(${a.equals});`);
      lines.push('});');
      lines.push('');
      continue;
    }

    if (a.type === 'header_present' && a.name) {
      const name = String(a.name).replace(/\\"/g, '\\\\"');
      lines.push(`pm.test("header_present: ${name}", function () {`);
      lines.push(`  pm.expect(pm.response.headers.has("${name}")).to.eql(true);`);
      lines.push('});');
      lines.push('');
      continue;
    }

    if (a.type === 'content_type_includes' && a.value) {
      const value = String(a.value).replace(/\\"/g, '\\\\"');
      lines.push(`pm.test("content_type_includes: ${value}", function () {`);
      lines.push('  const ct = pm.response.headers.get("Content-Type") || "";');
      lines.push(`  pm.expect(ct).to.include("${value}");`);
      lines.push('});');
      lines.push('');
      continue;
    }

    if (a.type === 'json_is_array') {
      lines.push('pm.test("json_is_array", function () {');
      lines.push('  pm.expect(__json).to.be.an("array");');
      lines.push('});');
      lines.push('');
      continue;
    }

    if (a.type === 'json_array_min_length' && typeof a.min === 'number') {
      lines.push(`pm.test("json_array_min_length: >= ${a.min}", function () {`);
      lines.push('  pm.expect(__json).to.be.an("array");');
      lines.push(`  pm.expect(__json.length).to.be.at.least(${a.min});`);
      lines.push('});');
      lines.push('');
      continue;
    }

    if (a.type === 'json_path_exists' && a.path) {
      const p = String(a.path).replace(/\\"/g, '\\\\"');
      lines.push(`pm.test("json_path_exists: ${p}", function () {`);
      lines.push('  pm.expect(resolvePath(__json, ' + `"${p}"` + ')).to.not.equal(undefined);');
      lines.push('});');
      lines.push('');
      continue;
    }

    lines.push(`pm.test("unhandled_assertion: ${String(a.type)}", function () {`);
    lines.push('  pm.expect(true).to.eql(true);');
    lines.push('});');
    lines.push('');
  }

  return lines;
}

function main() {
  const inputPath = path.join(__dirname, 'testcases.json');
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: testcases.json not found at ${inputPath}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error('ERROR: Failed to parse testcases.json as JSON');
    console.error(e);
    process.exit(1);
  }

  if (!data || typeof data !== 'object') {
    console.error('ERROR: testcases.json must contain a JSON object');
    process.exit(1);
  }

  const testcases = Array.isArray(data.testcases) ? data.testcases : null;
  if (!testcases) {
    console.error('ERROR: testcases.json must contain a "testcases" array');
    process.exit(1);
  }

  const variables = isPlainObject(data.variables) ? data.variables : {};

  const collection = new sdk.Collection({
    info: {
      name: String(data.name || 'API Test Collection')
    }
  });

  const baseUrlValue =
    (variables && typeof variables.baseUrl === 'string' && variables.baseUrl) ||
    (typeof data.baseUrl === 'string' && data.baseUrl) ||
    '';

  const variablePairs = [];
  variablePairs.push(['baseUrl', baseUrlValue]);

  const variableKeys = Object.keys(variables).sort((a, b) =>
    a.localeCompare(b, 'en')
  );
  for (const key of variableKeys) {
    if (key === 'baseUrl') continue;
    variablePairs.push([key, variables[key]]);
  }

  for (const [key, value] of variablePairs) {
    collection.variables.add(
      new sdk.Variable({
        key: String(key),
        value: value === undefined ? '' : String(value)
      })
    );
  }

  const intendedUrls = [];
  const intendedHeaders = [];
  const intendedBodies = [];

  for (const tc of testcases) {
    if (!tc || typeof tc !== 'object') continue;

    const method = String(tc.method || data?.endpoint?.method || 'GET').toUpperCase();
    const tcPath = String(tc.path || data?.endpoint?.path || '/');

    const intendedUrl = buildIntendedUrl({ ...tc, path: tcPath });
    intendedUrls.push(intendedUrl);

    const url = new sdk.Url(`{{baseUrl}}${tcPath}`);

    const query = tc.query || {};
    if (!isPlainObject(query)) {
      throw new Error(`Testcase ${tc.id || tc.name || ''}: tc.query must be a plain object`);
    }

    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          if (element === null || element === undefined) continue;
          if (!isPrimitive(element)) {
            throw new Error(
              `Testcase ${tc.id || tc.name || ''}: query param "${key}" contains non-primitive array element`
            );
          }
          url.query.add({ key: String(key), value: String(element) });
        }
        continue;
      }

      if (value === null || value === undefined) continue;
      if (!isPrimitive(value)) {
        throw new Error(
          `Testcase ${tc.id || tc.name || ''}: query param "${key}" must be a primitive or array`
        );
      }
      url.query.add({ key: String(key), value: String(value) });
    }

    let headersArray = mergeHeaders(data.defaultHeaders, tc.headers);

    const requiresAuth = Boolean(tc.requiresAuth);
    if (requiresAuth) {
      if (Object.prototype.hasOwnProperty.call(variables, 'accessToken')) {
        if (!hasHeader(headersArray, 'Authorization')) {
          headersArray.push({ key: 'Authorization', value: 'Bearer {{accessToken}}' });
        }
      } else {
        console.warn(
          `[WARN] ${tc.id || tc.name || 'testcase'} requiresAuth=true but variables.accessToken is missing; proceeding without Authorization header.`
        );
      }
    }

    const hasBody = tc.body !== null && tc.body !== undefined;
    if (hasBody && !hasHeader(headersArray, 'Content-Type')) {
      headersArray.push({ key: 'Content-Type', value: 'application/json' });
    }

    intendedHeaders.push(buildIntendedHeaders(headersArray));

    const requestOptions = {
      method,
      header: headersArray.map((h) => ({ key: h.key, value: h.value })),
      url: url.toJSON()
    };

    if (hasBody) {
      requestOptions.body = {
        mode: 'raw',
        raw: JSON.stringify(tc.body, null, 2),
        options: {
          raw: {
            language: 'json'
          }
        }
      };
      intendedBodies.push(requestOptions.body);
    } else {
      intendedBodies.push(null);
    }

    const request = new sdk.Request(requestOptions);

    const item = new sdk.Item({
      name: String(tc.name || tc.id || `${method} ${tcPath}`),
      request
    });

    item.events.add(
      new sdk.Event({
        listen: 'test',
        script: new sdk.Script({
          exec: buildTestScript(tc.assertions)
        })
      })
    );

    collection.items.add(item);
  }

  const exported = collection.toJSON();

  if (!Array.isArray(exported.item)) {
    throw new Error('Exported collection is missing item array');
  }

  if (exported.item.length !== intendedUrls.length) {
    throw new Error(
      `Exported item count (${exported.item.length}) does not match intended URL count (${intendedUrls.length})`
    );
  }

  if (exported.item.length !== intendedHeaders.length) {
    throw new Error(
      `Exported item count (${exported.item.length}) does not match intended header count (${intendedHeaders.length})`
    );
  }

  if (exported.item.length !== intendedBodies.length) {
    throw new Error(
      `Exported item count (${exported.item.length}) does not match intended body count (${intendedBodies.length})`
    );
  }

  for (let i = 0; i < intendedUrls.length; i++) {
    if (exported.item[i] && exported.item[i].request) {
      exported.item[i].request.url = intendedUrls[i];
      exported.item[i].request.header = intendedHeaders[i];
      if (intendedBodies[i]) {
        exported.item[i].request.body = intendedBodies[i];
      }
    }
  }

  const outPath = path.join(__dirname, 'collection.json');
  fs.writeFileSync(outPath, JSON.stringify(exported, null, 2), 'utf8');

  console.log(`Processed ${intendedUrls.length} testcases.`);
  console.log(`Generated Postman collection: ${outPath}`);
}

main();
