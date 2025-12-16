const fs = require("fs");
const path = require("path");

const TESTCASE_PATH = path.join(__dirname, "testcases.json");
const OUTPUT_PATH = path.join(__dirname, "collection.json");

function ensureFileExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing required file: ${targetPath}`);
  }
}

function loadTestcases() {
  ensureFileExists(TESTCASE_PATH);
  const raw = fs.readFileSync(TESTCASE_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse testcases.json: ${error.message}`);
  }
}

function toLiteral(value) {
  return JSON.stringify(value == null ? "" : value);
}

function addCollectionVariables(collection, variables) {
  const resolved = variables || {};
  const baseUrl = resolved.baseUrl || "";
  collection.variable.push({ key: "baseUrl", value: baseUrl });

  Object.keys(resolved).forEach((key) => {
    if (key === "baseUrl") {
      return;
    }
    collection.variable.push({ key, value: resolved[key] });
  });
}

function hasHeader(headersObj, name) {
  return Object.keys(headersObj).some((key) => key.toLowerCase() === name.toLowerCase());
}

function mergeHeaders(defaultHeaders, testcaseHeaders) {
  return { ...(defaultHeaders || {}), ...(testcaseHeaders || {}) };
}

function applyAuth(headersObj, requiresAuth, variables) {
  if (!requiresAuth) {
    return;
  }

  if (variables && variables.accessToken) {
    headersObj.Authorization = "Bearer {{accessToken}}";
  } else {
    console.warn("requiresAuth is true but variables.accessToken is missing");
  }
}

function ensureContentType(headersObj, body) {
  if (body == null) {
    return;
  }
  if (!hasHeader(headersObj, "Content-Type")) {
    headersObj["Content-Type"] = "application/json";
  }
}

function buildQueryParams(query) {
  const params = [];
  Object.entries(query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        params.push({ key, value: String(entry) });
      });
    } else if (value !== undefined && value !== null) {
      params.push({ key, value: String(value) });
    }
  });
  return params;
}

function buildTestScript(assertions) {
  const steps = [];
  const needsJson = (assertions || []).some((assertion) => {
    return ["json_is_array", "json_array_min_length", "json_path_exists"].includes(assertion.type);
  });

  if (needsJson) {
    steps.push("const jsonData = (() => {");
    steps.push("  try {");
    steps.push("    return pm.response.json();");
    steps.push("  } catch (e) {");
    steps.push("    return null;");
    steps.push("  }");
    steps.push("})();");

    if ((assertions || []).some((assertion) => assertion.type === "json_path_exists")) {
      steps.push("function resolvePath(obj, path) {");
      steps.push("  if (!obj || typeof path !== 'string') { return undefined; }");
      steps.push("  const segments = path.replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean);");
      steps.push("  return segments.reduce((acc, key) => { return acc && acc[key] !== undefined ? acc[key] : undefined; }, obj);");
      steps.push("}");
    }
  }

  (assertions || []).forEach((assertion, index) => {
    const label = `Assertion ${index + 1}: ${assertion.type}`;
    switch (assertion.type) {
      case "status":
        steps.push(`pm.test(${toLiteral(label)}, function () {`);
        steps.push(`  pm.response.to.have.status(${assertion.equals});`);
        steps.push("});");
        break;
      case "header_present":
        steps.push(`pm.test(${toLiteral(label)}, function () {`);
        steps.push(`  pm.expect(pm.response.headers.has(${toLiteral(assertion.name)})).to.eql(true);`);
        steps.push("});");
        break;
      case "content_type_includes":
        steps.push(`pm.test(${toLiteral(label)}, function () {`);
        steps.push(`  pm.expect(pm.response.headers.get('Content-Type')).to.include(${toLiteral(assertion.value)});`);
        steps.push("});");
        break;
      case "json_is_array":
        steps.push(`pm.test(${toLiteral(label)}, function () {`);
        steps.push("  pm.expect(Array.isArray(jsonData)).to.eql(true);");
        steps.push("});");
        break;
      case "json_array_min_length":
        steps.push(`pm.test(${toLiteral(label)}, function () {`);
        steps.push("  const length = Array.isArray(jsonData) ? jsonData.length : 0;");
        steps.push(`  pm.expect(length).to.be.at.least(${assertion.min});`);
        steps.push("});");
        break;
      case "json_path_exists":
        steps.push(`pm.test(${toLiteral(label)}, function () {`);
        steps.push(`  pm.expect(resolvePath(jsonData, ${toLiteral(assertion.path)}) !== undefined).to.eql(true);`);
        steps.push("});");
        break;
      default:
        steps.push(`pm.test(${toLiteral(`Unhandled assertion type: ${assertion.type}`)}, function () {`);
        steps.push("  pm.expect(true).to.eql(true);");
        steps.push("});");
    }
  });

  if (steps.length === 0) {
    steps.push("pm.test('No assertions defined', function () { pm.expect(true).to.eql(true); });");
  }

  return steps;
}

function buildRequest(testcase, defaultHeaders, variables) {
  const headersObj = mergeHeaders(defaultHeaders, testcase.headers);
  applyAuth(headersObj, testcase.requiresAuth, variables);
  ensureContentType(headersObj, testcase.body);

  const queryParams = buildQueryParams(testcase.query);
  const queryString = queryParams
    .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const rawUrl = queryString ? `{{baseUrl}}${testcase.path}?${queryString}` : `{{baseUrl}}${testcase.path}`;

  const headers = Object.entries(headersObj).map(([key, value]) => ({ key, value }));

  const request = {
    url: rawUrl,
    method: testcase.method,
    header: headers
  };

  if (testcase.body != null) {
    request.body = {
      mode: "raw",
      raw: typeof testcase.body === "string" ? testcase.body : JSON.stringify(testcase.body, null, 2)
    };
  }

  return request;
}

function buildItem(testcase, defaultHeaders, variables) {
  const request = buildRequest(testcase, defaultHeaders, variables);
  const script = buildTestScript(testcase.assertions || []);

  const event = {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: script
    }
  };

  return {
    name: testcase.name || testcase.id,
    request,
    event: [event]
  };
}

function buildCollectionSkeleton(name) {
  return {
    info: {
      name: name || "Generated Collection",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: [],
    variable: []
  };
}

function main() {
  const data = loadTestcases();
  const collection = buildCollectionSkeleton(data.name);

  addCollectionVariables(collection, data.variables || {});

  const defaultHeaders = data.defaultHeaders || {};
  const testcases = Array.isArray(data.testcases) ? data.testcases : [];

  testcases.forEach((testcase) => {
    const item = buildItem(testcase, defaultHeaders, data.variables || {});
    collection.item.push(item);
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(collection, null, 2));
  console.log(`Processed ${testcases.length} testcases. Collection written to ${OUTPUT_PATH}.`);
}

main();
