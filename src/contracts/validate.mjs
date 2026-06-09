// Minimal JSON-Schema-subset validator for the M0.5 contracts (#156). The
// repo is zero-dependency by policy, so instead of ajv this implements exactly
// the keywords the contract schemas use — and FAILS CLOSED on anything else:
// an unsupported keyword throws at validation time (and statically via
// assertSchemaSupported), so a schema edit can never silently stop
// validating. M2's decisionDoc.mjs is expected to reuse this module at
// runtime; tests and runtime share one code path.

// Keywords that carry no validation semantics here. $defs is traversed only
// through $ref resolution (and statically by assertSchemaSupported).
const ANNOTATION_KEYWORDS = new Set(["$schema", "$id", "title", "description", "$comment", "examples", "$defs"]);

const VALIDATION_KEYWORDS = new Set([
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "const",
  "items",
  "minItems",
  "maxItems",
  "pattern",
  "minLength",
  "minimum",
  "maximum",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // object | string | number | boolean
}

function matchesType(value, type) {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeOf(value) === type;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// $ref is restricted to local "#/$defs/<name>" pointers: the contracts are
// deliberately self-contained files with no cross-file resolution.
function resolveRef(ref, root) {
  const match = /^#\/\$defs\/([^/]+)$/.exec(ref);
  if (!match) throw new Error(`unsupported $ref "${ref}" (only #/$defs/<name> is implemented)`);
  const target = root.$defs?.[match[1]];
  if (!target) throw new Error(`$ref "${ref}" does not resolve`);
  return target;
}

function assertKeywordsSupported(schemaNode, schemaPath) {
  for (const key of Object.keys(schemaNode)) {
    if (!VALIDATION_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      throw new Error(`unsupported schema keyword "${key}" at ${schemaPath || "(root)"}`);
    }
  }
}

function check(schemaNode, value, path, root, errors) {
  if (typeof schemaNode !== "object" || schemaNode === null) {
    throw new Error(`schema node at ${path || "(root)"} is not an object`);
  }
  assertKeywordsSupported(schemaNode, path);

  if (schemaNode.$ref !== undefined) {
    check(resolveRef(schemaNode.$ref, root), value, path, root, errors);
    return;
  }

  if (schemaNode.type !== undefined) {
    const types = Array.isArray(schemaNode.type) ? schemaNode.type : [schemaNode.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({ path, message: `expected type ${types.join("|")}, got ${typeOf(value)}` });
      return; // remaining keyword checks assume the right shape
    }
  }

  if (schemaNode.enum !== undefined && !schemaNode.enum.some((option) => deepEqual(option, value))) {
    errors.push({ path, message: `value ${JSON.stringify(value)} not in enum [${schemaNode.enum.map((o) => JSON.stringify(o)).join(", ")}]` });
  }
  if (schemaNode.const !== undefined && !deepEqual(schemaNode.const, value)) {
    errors.push({ path, message: `expected const ${JSON.stringify(schemaNode.const)}, got ${JSON.stringify(value)}` });
  }

  if (typeOf(value) === "string") {
    if (schemaNode.pattern !== undefined && !new RegExp(schemaNode.pattern).test(value)) {
      errors.push({ path, message: `string does not match pattern ${schemaNode.pattern}` });
    }
    if (schemaNode.minLength !== undefined && value.length < schemaNode.minLength) {
      errors.push({ path, message: `string shorter than minLength ${schemaNode.minLength}` });
    }
  }

  if (typeof value === "number") {
    if (schemaNode.minimum !== undefined && value < schemaNode.minimum) {
      errors.push({ path, message: `number below minimum ${schemaNode.minimum}` });
    }
    if (schemaNode.maximum !== undefined && value > schemaNode.maximum) {
      errors.push({ path, message: `number above maximum ${schemaNode.maximum}` });
    }
  }

  if (typeOf(value) === "array") {
    if (schemaNode.minItems !== undefined && value.length < schemaNode.minItems) {
      errors.push({ path, message: `array shorter than minItems ${schemaNode.minItems}` });
    }
    if (schemaNode.maxItems !== undefined && value.length > schemaNode.maxItems) {
      errors.push({ path, message: `array longer than maxItems ${schemaNode.maxItems}` });
    }
    if (schemaNode.items !== undefined) {
      value.forEach((item, index) => check(schemaNode.items, item, `${path}[${index}]`, root, errors));
    }
  }

  if (typeOf(value) === "object") {
    const properties = schemaNode.properties ?? {};
    for (const name of schemaNode.required ?? []) {
      if (!(name in value)) errors.push({ path, message: `missing required property "${name}"` });
    }
    for (const [name, propValue] of Object.entries(value)) {
      const childPath = path ? `${path}.${name}` : name;
      if (name in properties) {
        check(properties[name], propValue, childPath, root, errors);
      } else if (schemaNode.additionalProperties === false) {
        errors.push({ path: childPath, message: "unexpected additional property" });
      } else if (typeof schemaNode.additionalProperties === "object" && schemaNode.additionalProperties !== null) {
        // Schema-valued additionalProperties supports hash maps such as
        // repoFingerprint.files ({ "<path>": "<sha256>" }).
        check(schemaNode.additionalProperties, propValue, childPath, root, errors);
      }
    }
  }
}

export function validate(schema, instance) {
  const errors = [];
  check(schema, instance, "", schema, errors);
  return { valid: errors.length === 0, errors };
}

// Static fail-closed walk: rejects unsupported keywords on EVERY node,
// including branches a given document never exercises. Tests run this over
// each contract schema; runtime loaders should too.
export function assertSchemaSupported(schema) {
  const walk = (node, path) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return;
    assertKeywordsSupported(node, path);
    if (node.$ref !== undefined) resolveRef(node.$ref, schema); // existence check
    for (const [name, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.properties.${name}`);
    for (const [name, child] of Object.entries(node.$defs ?? {})) walk(child, `${path}.$defs.${name}`);
    if (node.items !== undefined) walk(node.items, `${path}.items`);
    if (typeof node.additionalProperties === "object" && node.additionalProperties !== null) {
      walk(node.additionalProperties, `${path}.additionalProperties`);
    }
  };
  walk(schema, "#");
}
