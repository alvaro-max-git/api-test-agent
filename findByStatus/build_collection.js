/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sdk = require("postman-collection");

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function ensurePrimitive(value, context) {
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return;
  throw new Error(
    `Invalid ${context}: expected primitive (string/number/boolean), got ${t}`
  );
}

function splitPathSegments(p) {
  const clean = String(p || "").split("?")[0];
  return clean
    .split("/")
    .filter(Boolean)
    .map((s) => String(s));
}

function buildQueryEntries(queryObj) {
  if (queryObj == null) return [];
  if (!isPlainObject(queryObj)) {
    throw new Error(`tc.query must be a plain object; got ${typeof queryObj}`);
  }

  const entries = [];
  for (const [key, value] of Object.entries(queryObj)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === null || v === undefined) continue;
        ensurePrimitive(v, `query value for key '${key}'`);
        entries.push({ key: String(key), value: String(v) });
      }
      continue;
    }

    ensurePrimitive(value, `query value for key '${key}'`);
    entries.push({ key: String(key), value: String(value) });
  }

  return entries;
}

function buildRawUrl(rawBase, queryEntries) {
  if (!queryEntries || queryEntries.length === 0) return rawBase;
  const qs = queryEntries
    .map(
      ({ key, value }) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
  return `${rawBase}?${qs}`;
}

function hasHeader(headersObj, headerName) {
  const target = String(headerName).toLowerCase();
  return Object.keys(headersObj || {}).some((k) => String(k).toLowerCase() === target);
}

function buildTestScript(assertions) {
  const lines = [];

  // Helpers first
  lines.push("function resolvePath(obj, path) {");
  lines.push("  if (obj === null || obj === undefined) return undefined;");
  lines.push("  if (!path || typeof path !== 'string') return undefined;");
  lines.push("  // Supports dot notation and array indices like [0].id");
  lines.push("  const normalized = path.replace(/\\[(\\d+)\\]/g, '.$1');");
  lines.push("  const parts = normalized.split('.').filter(Boolean);");
  lines.push("  let cur = obj;");
  lines.push("  for (const part of parts) {");
  lines.push("    if (cur === null || cur === undefined) return undefined;");
  lines.push("    if (Object(cur) !== cur) return undefined;");
  lines.push("    cur = cur[part];");
  lines.push("  }");
  lines.push("  return cur;");
  lines.push("}");

  lines.push("function tryParseJson() {");
  lines.push("  try { return pm.response.json(); } catch (e) { return undefined; }");
  lines.push("}");

  for (const assertion of assertions || []) {
    if (!assertion || typeof assertion !== "object") continue;

    switch (assertion.type) {
      case "status": {
        lines.push(
          `pm.test('Status is ${assertion.equals}', function () { pm.response.to.have.status(${Number(
            assertion.equals
          )}); });`
        );
        break;
      }

      case "header_present": {
        const name = String(assertion.name || "");
        lines.push(
          `pm.test('Header present: ${name}', function () { pm.expect(pm.response.headers.has(${JSON.stringify(
            name
          )})).to.eql(true); });`
        );
        break;
      }

      case "content_type_includes": {
        const value = String(assertion.value || "");
        lines.push(
          `pm.test('Content-Type includes ${value}', function () { pm.expect(pm.response.headers.get('Content-Type') || '').to.include(${JSON.stringify(
            value
          )}); });`
        );
        break;
      }

      case "json_is_array": {
        lines.push(
          "pm.test('Response JSON is an array', function () { pm.expect(pm.response.json()).to.be.an('array'); });"
        );
        break;
      }

      case "json_array_min_length": {
        const min = Number(assertion.min);
        lines.push(
          `pm.test('JSON array min length ${min}', function () { pm.expect(pm.response.json().length).to.be.at.least(${min}); });`
        );
        break;
      }

      case "json_path_exists": {
        const p = String(assertion.path || "");
        lines.push(
          `pm.test('JSON path exists: ${p}', function () { const json = tryParseJson(); pm.expect(json, 'Response body is valid JSON').to.not.eql(undefined); pm.expect(resolvePath(json, ${JSON.stringify(
            p
          )}), 'Path ${p}').to.not.eql(undefined); });`
        );
        break;
      }

      default:
        // Unknown assertion type: ignore for now (keeps generator robust)
        break;
    }
  }

  return lines;
}

function main() {
  const rootDir = __dirname;
  const testcasesPath = path.join(rootDir, "testcases.json");
  const featurePath = path.join(rootDir, "findByStatus.feature");
  const outputPath = path.join(rootDir, "collection.json");

  if (!fs.existsSync(testcasesPath)) {
    console.error(`Missing file: ${testcasesPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(testcasesPath, "utf8");
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse testcases.json as JSON:", e.message);
    process.exit(1);
  }

  if (!spec || typeof spec !== "object") {
    console.error("Invalid testcases.json: expected an object at top-level");
    process.exit(1);
  }

  const featureDescription = fs.existsSync(featurePath)
    ? fs.readFileSync(featurePath, "utf8")
    : "";

  const collection = new sdk.Collection({
    info: {
      name: spec.name || "API Collection",
      description: featureDescription || undefined
    }
  });

  // Variables: baseUrl + all keys from spec.variables
  const vars = isPlainObject(spec.variables) ? spec.variables : {};
  const varEntries = new Map();
  varEntries.set("baseUrl", vars.baseUrl ?? spec.baseUrl ?? "");
  for (const [k, v] of Object.entries(vars)) varEntries.set(k, v);

  for (const [key, value] of varEntries.entries()) {
    collection.variables.add(new sdk.Variable({ key, value: value ?? "" }));
  }

  const defaultHeaders = isPlainObject(spec.defaultHeaders) ? spec.defaultHeaders : {};

  const intendedUrls = [];

  const testcases = Array.isArray(spec.testcases) ? spec.testcases : [];
  for (const tc of testcases) {
    if (!tc || typeof tc !== "object") continue;

    const method = String(tc.method || spec.endpoint?.method || "GET").toUpperCase();
    const tcPath = String(tc.path || spec.endpoint?.path || "");

    const headers = {
      ...defaultHeaders,
      ...(isPlainObject(tc.headers) ? tc.headers : {})
    };

    // Body handling: if present, ensure Content-Type: application/json
    let requestBody;
    if (tc.body !== null && tc.body !== undefined) {
      if (!hasHeader(headers, "Content-Type")) {
        headers["Content-Type"] = "application/json";
      }

      const rawBody =
        typeof tc.body === "string" ? tc.body : JSON.stringify(tc.body);
      requestBody = {
        mode: "raw",
        raw: rawBody,
        options: { raw: { language: "json" } }
      };
    }

    // Auth handling
    if (tc.requiresAuth === true) {
      const accessToken = String(vars.accessToken || "");
      if (accessToken) {
        headers["Authorization"] = "Bearer {{accessToken}}";
      } else {
        console.warn(
          `[WARN] ${tc.id || tc.name || "testcase"}: requiresAuth=true but variables.accessToken is missing/empty. Proceeding without Authorization header.`
        );
      }
    }

    // URL handling (with strict guards) + intended URL tracking (export workaround)
    const url = new sdk.Url("{{baseUrl}}" + tcPath);

    const queryEntries = buildQueryEntries(tc.query || {});
    for (const { key, value } of queryEntries) {
      url.query.add({ key, value });
    }

    const intendedUrl = {
      raw: buildRawUrl("{{baseUrl}}" + tcPath, queryEntries),
      host: ["{{baseUrl}}"],
      path: splitPathSegments(tcPath),
      ...(queryEntries.length ? { query: queryEntries } : {})
    };
    intendedUrls.push(intendedUrl);

    const request = new sdk.Request({
      method,
      header: Object.entries(headers).map(([key, value]) => ({
        key: String(key),
        value: String(value)
      })),
      url: url.toJSON(),
      ...(requestBody ? { body: requestBody } : {})
    });

    const testLines = buildTestScript(tc.assertions);
    const item = new sdk.Item({
      name: tc.name ? `${tc.id ? tc.id + " - " : ""}${tc.name}` : (tc.id || "Request"),
      request,
      event: [
        new sdk.Event({
          listen: "test",
          script: new sdk.Script({ exec: testLines })
        })
      ]
    });

    collection.items.add(item);
  }

  // Export bug workaround (required): overwrite request.url with plain JSON
  const exported = collection.toJSON();
  if (!Array.isArray(exported.item)) exported.item = [];

  for (let i = 0; i < exported.item.length; i += 1) {
    if (exported.item[i]?.request) {
      exported.item[i].request.url = intendedUrls[i];
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(exported, null, 2), "utf8");
  console.log(`Processed ${testcases.length} testcase(s).`);
  console.log(`Generated: ${outputPath}`);
}

main();
