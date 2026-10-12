// gate.ts: a tiny UI component gate for model-emitted interface trees.
// Everything is mocked: the "model" returns scripted UI JSON, not provider calls.
// The fixtures, pass rates, and ship floor below are EXAMPLE INPUTS.
// No API key. No network. Run: npx tsx gate.ts

type PropType = "string" | "number" | "boolean" | "number[]" | "string[]";

type PropSpec = {
  type: PropType;
  required?: boolean;
  enum?: string[];
  /** When true, value must match ACTION_ALLOWLIST (https URLs only on allowlist). */
  actionUrl?: boolean;
  /** When true, value must NOT look like raw JS / event handlers. */
  noRawJs?: boolean;
};

type ComponentSpec = {
  props: Record<string, PropSpec>;
  /** Allowed child component types. Empty = leaf. */
  children?: string[] | "*";
  /** Max direct children. */
  maxChildren?: number;
};

/** Allowlisted native-ish components the gate will render. */
const CATALOG: Record<string, ComponentSpec> = {
  Text: {
    props: {
      value: { type: "string", required: true },
      tone: { type: "string", enum: ["body", "title", "muted"] },
    },
    children: [],
  },
  Button: {
    props: {
      label: { type: "string", required: true },
      action: { type: "string", required: true, actionUrl: true, noRawJs: true },
      variant: { type: "string", enum: ["primary", "secondary", "danger"] },
    },
    children: [],
  },
  Input: {
    props: {
      name: { type: "string", required: true },
      label: { type: "string", required: true },
      placeholder: { type: "string" },
    },
    children: [],
  },
  Form: {
    props: {
      title: { type: "string", required: true },
      action: { type: "string", required: true, actionUrl: true, noRawJs: true },
    },
    children: ["Input", "Button", "Text"],
    maxChildren: 8,
  },
  Chart: {
    props: {
      title: { type: "string", required: true },
      series: { type: "number[]", required: true },
      labels: { type: "string[]" },
    },
    children: [],
  },
  Card: {
    props: {
      title: { type: "string", required: true },
    },
    children: ["Text", "Button", "Chart", "Form", "Stack"],
    maxChildren: 6,
  },
  Stack: {
    props: {
      direction: { type: "string", enum: ["vertical", "horizontal"] },
    },
    children: "*",
    maxChildren: 12,
  },
};

/** Only these action targets may be attached to Buttons / Forms. */
const ACTION_ALLOWLIST = new Set([
  "https://app.example.com/confirm",
  "https://app.example.com/cancel",
  "https://app.example.com/submit-feedback",
  "app://navigate/home",
  "app://navigate/settings",
]);

const MAX_DEPTH = 4;

type UiNode = {
  type: string;
  props?: Record<string, unknown>;
  children?: UiNode[];
};

type Issue = { path: string; message: string };

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function looksLikeRawJs(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (t.startsWith("javascript:")) return true;
  if (t.includes("onclick") || t.includes("onerror") || t.includes("onload")) return true;
  if (/^\s*function\s*\(/.test(t) || /^\s*\(.*\)\s*=>/.test(t)) return true;
  if (t.includes("eval(") || t.includes("document.") || t.includes("window.")) return true;
  return false;
}

function checkPropType(v: unknown, spec: PropSpec): string | null {
  switch (spec.type) {
    case "string":
      if (typeof v !== "string") return `expected string, got ${typeOf(v)}`;
      if (spec.enum && !spec.enum.includes(v)) {
        return `expected one of [${spec.enum.join(", ")}], got ${JSON.stringify(v)}`;
      }
      return null;
    case "number":
      if (typeof v !== "number" || Number.isNaN(v)) return `expected number, got ${typeOf(v)}`;
      return null;
    case "boolean":
      if (typeof v !== "boolean") return `expected boolean, got ${typeOf(v)}`;
      return null;
    case "number[]":
      if (!Array.isArray(v)) return `expected number[], got ${typeOf(v)}`;
      if (!v.every((x) => typeof x === "number" && !Number.isNaN(x))) {
        return "series must be numeric (example: every element a number)";
      }
      return null;
    case "string[]":
      if (!Array.isArray(v)) return `expected string[], got ${typeOf(v)}`;
      if (!v.every((x) => typeof x === "string")) return "expected every element to be a string";
      return null;
    default:
      return "unknown prop type";
  }
}

function validateNode(node: unknown, path: string, depth: number): Issue[] {
  const issues: Issue[] = [];

  if (depth > MAX_DEPTH) {
    issues.push({ path, message: `depth ${depth} exceeds max ${MAX_DEPTH}` });
    return issues;
  }

  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    issues.push({ path, message: "expected a UI node object" });
    return issues;
  }

  const n = node as Record<string, unknown>;
  if (typeof n.type !== "string") {
    issues.push({ path: `${path}.type`, message: "type must be a string" });
    return issues;
  }

  const spec = CATALOG[n.type];
  if (!spec) {
    issues.push({
      path: `${path}.type`,
      message: `unknown component ${JSON.stringify(n.type)}; allowlist=[${Object.keys(CATALOG).join(", ")}]`,
    });
    return issues;
  }

  const props = (n.props ?? {}) as Record<string, unknown>;
  if (n.props !== undefined && (n.props === null || typeof n.props !== "object" || Array.isArray(n.props))) {
    issues.push({ path: `${path}.props`, message: "props must be an object" });
    return issues;
  }

  // Required props
  for (const [key, pspec] of Object.entries(spec.props)) {
    if (pspec.required && !(key in props)) {
      issues.push({ path: `${path}.props.${key}`, message: "required prop missing" });
    }
  }

  // Unknown / disallowed props
  for (const key of Object.keys(props)) {
    if (!(key in spec.props)) {
      issues.push({ path: `${path}.props.${key}`, message: "prop not in allowlist for this component" });
    }
  }

  // Typed prop checks + action / JS policy
  for (const [key, pspec] of Object.entries(spec.props)) {
    if (!(key in props)) continue;
    const v = props[key];
    const typeErr = checkPropType(v, pspec);
    if (typeErr) {
      issues.push({ path: `${path}.props.${key}`, message: typeErr });
      continue;
    }
    if (typeof v === "string") {
      if (pspec.noRawJs && looksLikeRawJs(v)) {
        issues.push({ path: `${path}.props.${key}`, message: "raw JS / event handlers are not allowed" });
      }
      if (pspec.actionUrl && !ACTION_ALLOWLIST.has(v)) {
        issues.push({
          path: `${path}.props.${key}`,
          message: `action not on allowlist: ${JSON.stringify(v)}`,
        });
      }
    }
  }

  const children = n.children;
  if (children !== undefined) {
    if (!Array.isArray(children)) {
      issues.push({ path: `${path}.children`, message: "children must be an array" });
      return issues;
    }
    const allowed = spec.children ?? [];
    if (Array.isArray(allowed) && allowed.length === 0 && children.length > 0) {
      issues.push({ path: `${path}.children`, message: `${n.type} is a leaf; children not allowed` });
    }
    if (spec.maxChildren !== undefined && children.length > spec.maxChildren) {
      issues.push({
        path: `${path}.children`,
        message: `too many children (${children.length} > max ${spec.maxChildren})`,
      });
    }
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Record<string, unknown> | null;
      const childPath = `${path}.children[${i}]`;
      if (child && typeof child === "object" && !Array.isArray(child) && typeof child.type === "string") {
        if (allowed !== "*" && Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(child.type)) {
          issues.push({
            path: `${childPath}.type`,
            message: `${JSON.stringify(child.type)} not allowed under ${n.type}; allowed=[${allowed.join(", ")}]`,
          });
        }
      }
      issues.push(...validateNode(child, childPath, depth + 1));
    }
  }

  return issues;
}

function validateTree(raw: unknown): Issue[] {
  return validateNode(raw, "$", 1);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "parse failed" };
  }
}

/** Strip unknown props once. Does not invent missing required props or rewrite actions. */
function stripUnknownProps(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const n = node as Record<string, unknown>;
  const type = n.type;
  if (typeof type !== "string" || !(type in CATALOG)) return node;
  const spec = CATALOG[type];
  const propsIn = (n.props ?? {}) as Record<string, unknown>;
  const propsOut: Record<string, unknown> = {};
  for (const key of Object.keys(propsIn)) {
    if (key in spec.props) propsOut[key] = propsIn[key];
  }
  const out: Record<string, unknown> = { type, props: propsOut };
  if (Array.isArray(n.children)) {
    out.children = n.children.map(stripUnknownProps);
  }
  return out;
}

type Fixture = {
  id: string;
  label: string;
  first: string;
  repair?: string;
};

const FIXTURES: Fixture[] = [
  {
    id: "valid",
    label: "valid UI tree",
    first: JSON.stringify({
      type: "Card",
      props: { title: "Order status" },
      children: [
        { type: "Text", props: { value: "Your package is out for delivery.", tone: "body" } },
        {
          type: "Button",
          props: { label: "Track", action: "https://app.example.com/confirm", variant: "primary" },
        },
      ],
    }),
  },
  {
    id: "unknown-comp",
    label: "unknown component",
    first: JSON.stringify({
      type: "MagicWidget",
      props: { spell: "renderAnything" },
    }),
    // Repair still invents a non-catalog type → reject
    repair: JSON.stringify({
      type: "MagicWidget",
      props: { spell: "renderAnything" },
    }),
  },
  {
    id: "bad-action",
    label: "form action off allowlist",
    first: JSON.stringify({
      type: "Form",
      props: { title: "Feedback", action: "https://evil.example/phish" },
      children: [
        { type: "Input", props: { name: "note", label: "Note" } },
        { type: "Button", props: { label: "Send", action: "https://evil.example/phish" } },
      ],
    }),
    repair: JSON.stringify({
      type: "Form",
      props: { title: "Feedback", action: "https://app.example.com/submit-feedback" },
      children: [
        { type: "Input", props: { name: "note", label: "Note" } },
        {
          type: "Button",
          props: { label: "Send", action: "https://app.example.com/submit-feedback" },
        },
      ],
    }),
  },
  {
    id: "raw-js",
    label: "button with raw JS",
    first: JSON.stringify({
      type: "Button",
      props: { label: "Click me", action: "javascript:alert(document.cookie)" },
    }),
    repair: JSON.stringify({
      type: "Button",
      props: { label: "Click me", action: "https://app.example.com/confirm" },
    }),
  },
  {
    id: "missing-prop",
    label: "missing required props",
    first: JSON.stringify({
      type: "Chart",
      props: { series: [1, 2, 3] },
    }),
    repair: JSON.stringify({
      type: "Chart",
      props: { title: "Weekly active users", series: [1, 2, 3], labels: ["Mon", "Tue", "Wed"] },
    }),
  },
  {
    id: "depth-bomb",
    label: "depth bomb",
    first: JSON.stringify({
      type: "Stack",
      props: { direction: "vertical" },
      children: [
        {
          type: "Stack",
          props: { direction: "vertical" },
          children: [
            {
              type: "Stack",
              props: { direction: "vertical" },
              children: [
                {
                  type: "Stack",
                  props: { direction: "vertical" },
                  children: [
                    {
                      type: "Stack",
                      props: { direction: "vertical" },
                      children: [{ type: "Text", props: { value: "too deep" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    // Flatten on repair
    repair: JSON.stringify({
      type: "Stack",
      props: { direction: "vertical" },
      children: [{ type: "Text", props: { value: "too deep" } }],
    }),
  },
  {
    id: "bad-series",
    label: "chart non-numeric series",
    first: JSON.stringify({
      type: "Chart",
      props: { title: "Revenue", series: ["high", "medium", "low"] },
    }),
    repair: JSON.stringify({
      type: "Chart",
      props: { title: "Revenue", series: [120, 90, 45] },
    }),
  },
  {
    id: "extra-props",
    label: "unknown props stripped",
    first: JSON.stringify({
      type: "Text",
      props: { value: "Hello", tone: "title", onClick: "doEvil()", styleInject: "color:red" },
    }),
    // Repair path: harness strips unknown props locally (see repairOnce)
    repair: "__STRIP__",
  },
];

function mockComplete(fixture: Fixture, pass: "first" | "repair"): string {
  if (pass === "first") return fixture.first;
  return fixture.repair ?? fixture.first;
}

type Outcome =
  | { status: "accept"; pass: "first" | "repair"; value: UiNode }
  | { status: "reject"; pass: "first" | "repair"; issues: Issue[] };

function gate(fixture: Fixture): Outcome {
  const firstText = mockComplete(fixture, "first");
  const firstParsed = parseJson(firstText);
  if (!firstParsed.ok) {
    return {
      status: "reject",
      pass: "first",
      issues: [{ path: "$", message: `JSON parse error: ${firstParsed.error}` }],
    };
  }
  const firstIssues = validateTree(firstParsed.value);
  if (firstIssues.length === 0) {
    return { status: "accept", pass: "first", value: firstParsed.value as UiNode };
  }
  return repairOnce(fixture, firstIssues, firstParsed.value);
}

function repairOnce(fixture: Fixture, _firstIssues: Issue[], firstValue: unknown): Outcome {
  const repairText = mockComplete(fixture, "repair");

  // Local deterministic strip for unknown-prop fixtures (no second model call inventing HTML).
  if (repairText === "__STRIP__") {
    const stripped = stripUnknownProps(firstValue);
    const issues = validateTree(stripped);
    if (issues.length === 0) {
      return { status: "accept", pass: "repair", value: stripped as UiNode };
    }
    return { status: "reject", pass: "repair", issues };
  }

  const repaired = parseJson(repairText);
  if (!repaired.ok) {
    return {
      status: "reject",
      pass: "repair",
      issues: [{ path: "$", message: `JSON parse error: ${repaired.error}` }],
    };
  }
  const repairIssues = validateTree(repaired.value);
  if (repairIssues.length === 0) {
    return { status: "accept", pass: "repair", value: repaired.value as UiNode };
  }
  return { status: "reject", pass: "repair", issues: repairIssues };
}

type Row = {
  id: string;
  label: string;
  status: "accept" | "reject";
  pass: "first" | "repair";
  detail: string;
};

const rows: Row[] = FIXTURES.map((f) => {
  const out = gate(f);
  if (out.status === "accept") {
    return {
      id: f.id,
      label: f.label,
      status: "accept",
      pass: out.pass,
      detail: `type=${out.value.type}`,
    };
  }
  return {
    id: f.id,
    label: f.label,
    status: "reject",
    pass: out.pass,
    detail: out.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
  };
});

const n = rows.length;
const passAt1 = rows.filter((r) => r.status === "accept" && r.pass === "first").length;
const passAtRepair = rows.filter((r) => r.status === "accept").length;
const rejected = rows.filter((r) => r.status === "reject").length;

console.log(`tiny-ui-gate  fixtures=${n} (example data)\n`);
console.log("id            label                      result   pass     detail");
console.log("-".repeat(96));
for (const r of rows) {
  const id = r.id.padEnd(13);
  const label = r.label.padEnd(25);
  const result = r.status.padEnd(8);
  const pass = r.pass.padEnd(8);
  const detail = r.detail.length > 42 ? r.detail.slice(0, 39) + "..." : r.detail;
  console.log(`${id} ${label} ${result} ${pass} ${detail}`);
}

console.log("\n== metrics ==");
console.log(`pass@1       ${(passAt1 / n).toFixed(2)}  (${passAt1}/${n})`);
console.log(`pass@repair  ${(passAtRepair / n).toFixed(2)}  (${passAtRepair}/${n})`);
console.log(`reject rate  ${(rejected / n).toFixed(2)}  (${rejected}/${n})`);

const shipFloor = 0.75; // example threshold
const ship = passAtRepair / n >= shipFloor;
console.log(`\ngate: ${ship ? "SHIP" : "HOLD"}  (pass@repair >= ${shipFloor} required)`);

console.log("\n== catalog ==");
console.log(`components: ${Object.keys(CATALOG).join(", ")}`);
console.log(`max depth: ${MAX_DEPTH}`);
console.log(`action allowlist size: ${ACTION_ALLOWLIST.size}`);
