# Vendored dependencies

## `cstimer_module.js`

The official csTimer scramble module, version **0.1.5**, copied verbatim from
the `cstimer_module` npm package (author `cs0x7f`, GPL-3.0). It is vendored
because the Rust port embeds it in JavaScriptCore instead of shipping a Node
runtime; see `RUST-PORT.md` and `PLAN.md` M18.

The bundle is Closure-compiled ES5. It is evaluated with a small host shim
(`src/scramble/`), and `SCRAMBLE_NOOBST` / `SCRAMBLE_NOOBSS` from csTimer's
`src/lang/en-us.js` are installed before it runs.

Upstream: <https://www.npmjs.com/package/cstimer_module> ·
csTimer: <https://github.com/cs0x7f/cstimer>
