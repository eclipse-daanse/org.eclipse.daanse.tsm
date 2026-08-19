# Requirements and Capabilities

OSGi Core 3.3 — the general form of a dependency.

```bash
npm run example:wiring      # http://localhost:5185
```

Everything on the page is computed from **manifests alone**. Nothing is loaded
until you press *Load the resolvable ones*, and that is what resolution is: it
answers whether a module *could* run, before a single line of it is fetched.

## The three columns

**Offered** — what each module brings to the resolution. Note which entries are
greyed: `osgi.identity` and `osgi.service` are **derived**, not written by hand.
Every module has an identity, and every `provides` entry becomes a service
capability. Only `demo.theme` was declared, and it is not a service at all —
just a promise about a stylesheet, with attributes a filter can select on.

**Wired** — one requirement, one capability, one module. Or a reason why not, and
the two reasons differ: *nothing offers this namespace at all* points at a missing
module, *something offers it but nothing matches* at a filter or a version.

**Waiting, and waiting in vain** — the distinction the model buys. `preview` waits
for `demo.editor`, which `editor` promises in its `provides`; it resolves. `exporter`
waits for `demo.pdf`, which nobody promises; it can never run, and that is knowable
now rather than after loading it. Press *Load the resolvable ones* and it is simply
never fetched.

## What to try

**Downgrade the dark theme to 1.5.0.** The editor asked for `^2.0.0`, so it stops
resolving. Its requirement uses `versionRange`, not `(version>=2.0.0)` in the
filter — a filter compares text, and as text `1.10.0` sorts *below* `1.9.0`. That
is the one place tsm deliberately departs from the specification, which puts
versions in the filter.

**Remove the light theme.** The gallery keeps running with one: `cardinality:
'multiple'` means *every* match, not *at least two*.

**Add a PDF provider.** The exporter becomes resolvable — the promise it was
waiting for now exists.

**Load the resolvable ones.** Six modules run; the log states that the exporter was
not even fetched. The panel beside it shows the question resolution does *not*
answer: whether a promised service was actually registered.

## Where the same model sits underneath

| declared in the manifest | becomes |
|---|---|
| an id | `osgi.identity` capability with `version` |
| `provides` | `osgi.service` capability with `objectClass` |
| `dependencies` | `osgi.identity` requirement with a filter and `versionRange` |
| `requiresService` | `osgi.service` requirement |
| `sharedDependencies` | `tsm.library` requirement |

`preview` and `workspace` on the page declare none of this by hand — their
requirements are derived, and the panel shows them next to the ones `editor` and
`gallery` wrote out.

## A detail worth knowing

The page reads `resolution.requirements`, not `requirementsOf(manifest)`. Derived
requirements are fresh objects on every call, so matching wires against a
separately fetched requirement finds nothing — quietly. Building this example is
how that came to light; `RequirementReport` pairs each requirement with its wires
inside one resolution.

In the console after loading: `tsm.capabilities(ns?)`, `tsm.wiring(id)`,
`tsm.unresolved()` — which is Gogo's `inspect`.
