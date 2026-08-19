# OSGi specifications

Local copies of the chapters tsm is modelled on, so a question about intended
behaviour can be answered by reading rather than by guessing.

**Release 8**, downloaded from <https://docs.osgi.org/specification/>. Open the
`.html` files directly; each is self-contained.

| File | Chapter | What tsm takes from it |
|---|---|---|
| [`core-framework.service.html`](core-framework.service.html) | Core 5 — Service Layer | `ServiceRegistry`: ranking and the visible service, `ServiceReference` vs. `ServiceRegistration`, `setProperties`, the whiteboard pattern |
| [`core-framework.module.html`](core-framework.module.html) | Core 3 — Module Layer | **Filter Syntax** (§3.2.7), which `serviceFilter.ts` implements — and requirements/capabilities, which tsm deliberately does *not* have |
| [`core-framework.lifecycle.html`](core-framework.lifecycle.html) | Core 4 — Life Cycle Layer | Bundle states and activation; the distinction tsm draws between `unsatisfied`, `stopped` and disabled |
| [`core-framework.namespaces.html`](core-framework.namespaces.html) | Core 8 — Framework Namespaces | Background on the `osgi.service` namespace, which is what `provides` / `requiresService` express in manifest form |
| [`cmpn-service.cm.html`](cmpn-service.cm.html) | Compendium 104 — Configuration Admin | `ConfigurationAdmin`: PIDs, `update`/`delete`, change counts, asynchronous delivery, factory PIDs (`factoryPid~name`), `service.pid` |
| [`cmpn-service.metatype.html`](cmpn-service.metatype.html) | Compendium 105 — Metatype | `MetatypeRegistry`: `ObjectClassDefinition`, `AttributeDefinition`, `required` defaulting to true, `%key` localization |
| [`cmpn-service.component.html`](cmpn-service.component.html) | Compendium 112 — Declarative Services | `@component`/`@activate`/`@deactivate`/`@modified`, `configurationPolicy`, immediate vs. delayed, greedy vs. reluctant, target filters, factory configurations |
| [`cmpn-service.feature.html`](cmpn-service.feature.html) | Compendium 159 — Feature Service | Nothing yet — this is the open question of what a "feature" would mean in tsm |

`SPEC.md` in the repository root records where tsm follows these and where it
departs on purpose; the departures are named there rather than left implicit.

## Licence

These documents are published under the **Eclipse Foundation Specification
License – v1.0**, which permits copying and distribution provided the notices
below travel with them. The full text is in [`LICENSE.html`](LICENSE.html).

> Copyright © 2020 Eclipse Foundation, Inc.
> <https://www.eclipse.org/legal/efsl.php>

Originals:

- <https://docs.osgi.org/specification/osgi.core/8.0.0/>
- <https://docs.osgi.org/specification/osgi.cmpn/8.0.0/>

The licence grants no right to create modified versions of these documents, so
they are kept here verbatim. Anything tsm has to say about them belongs in
`SPEC.md`.
