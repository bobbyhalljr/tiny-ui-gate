# tiny-ui-gate

A tiny TypeScript **UI component gate** for model-emitted interface trees.

Providers are teaching models to emit interactive UI. This gate keeps render under your control:

1. **Allowlisted catalog** of component types + props
2. **Validate** the tree (actions, no raw JS, depth, numeric series, required props)
3. **One repair** (strip unknown props locally, or feed issues back once)
4. **Reject** what still fails

No API key. Scripted fixtures only.

```bash
npm install
npx tsx gate.ts
```

Example metrics from the bundled fixtures (not a real model):

```
pass@1       0.13  (1/8)
pass@repair  0.88  (7/8)
reject rate  0.13  (1/8)
gate: SHIP
```

## Why

Schema gates validate JSON decisions. This validates a **UI tree** before you mount it: unknown components, off-allowlist form actions, `javascript:` buttons, depth bombs, and non-numeric chart series get caught.

## License

MIT
