# Beyond one instance per bundle

Four things a component can be, all attached to the same thing — an editor,
because they were built to work together rather than to be demonstrated one at a
time.

```
npm run example:editors      # http://localhost:5185
```

Everything on screen is read from the loader and the registry, so what you see is
the state of the system rather than a description of it. The console has
`tsm.factories()`, `tsm.conditions()` and `tsm.components()`.

## 1 · A condition decides when anything starts

A condition is a service with no behaviour — only the statement that something is
the case. `UpdatingToolbar`, `ReplacingToolbar` and `Editor` name
`(condition.id=workspace.ready)`; the `workspace` bundle registers it when you
press the button. Neither side knows about the other, which is the whole point
over depending on a service by name.

The loader treats it as one more mandatory reference, exactly as DS models it
(112.3.13), so everything that already waits for a reference waits for this too.

## 2 · A factory component: one editor per file

`Editor` registers no service of its own, only a `ComponentFactory`. Each call to
`newInstance({ file })` builds one instance with those properties.

The difference from a factory *configuration* is who decides there should be
another one. A configuration is data — a UI or a stored file creates instances. A
factory component is a call — only the code that opens files knows a file was
opened.

Close the workspace while editors are open: the factory is withdrawn, because
nobody should be able to ask for an instance of a component that cannot run, and
the instances go with it. Open it again and the factory is back but the editors
are not — they belonged to whoever asked for them, and re-creating them would be
inventing state nobody asked for twice.

## 3 · A collection, and what the field option changes

Two toolbars collect the same `editor.tool` services with `@injectAll`, one with
`fieldOption: 'update'` and one with the default `replace`. The page takes the
array from each **once**, when it starts — which is what a view bound to a
collection does.

Toggle a tool bundle:

| | what the page holds | the component's own field |
|---|---|---|
| `update` | 2 | 2 |
| `replace` | 4 | 2 |

Neither is broken. `replace` assigns a new array, so what was taken stops being
the component's and freezes at the moment it was taken. That is why a view bound
to the array needs the other option — and why `update` exists at all.

## 4 · One undo stack per module

`module` scope — OSGi's `bundle` scope under the name tsm uses for a bundle. One
service id, one factory in the `history` bundle, and every bundle that asks gets
its own instance. A singleton would mix three bundles' history into one list;
`transient` would lose it between two calls.

The editors' entries land in the `editors` row rather than in the page's, because
the instance was built for the bundle whose code runs — not for whoever called the
factory. That distinction is what keeps the scope from leaking down a dependency
chain.

The stack in the table is created by *looking*: `get()` builds the instance for
the module that asks, so opening the page is already an ask.

## What building this example found

Both were defects reasoning had not turned up, which is what examples are for:

- A component built through `construct()` — one with no service of its own — lost
  the consumer, so every module got the *same* `module`-scoped instance. The
  scope was wrong there rather than merely absent.
- Withdrawing an **outranked** registration raised no event. `get(id)` answers
  with the same object as before, so it looked like no change — but
  `countProviders` had changed, and a collection reference consumes every
  provider. Cardinality 0..n went stale in silence. OSGi raises UNREGISTERING per
  registration for exactly this reason.

A third thing came out as a small addition: two `register()` calls under one id
from one bundle used to replace each other, so a bundle could not offer two tools
under one id. `instanceKey` now tells them apart, while registering the same thing
twice by accident still replaces.
