/**
 * TSM - TypeScript Module System
 * A module's own context, as a service
 *
 * `@activate(context)` hands a component its context, and that is the closer
 * analogue of what DS does (112.5.8). This is for the case that cannot reach:
 * a class whose dependency on the registry is *constructional* — an identifier
 * resolver, a repository that looks services up when it is called rather than
 * when it starts. Such a class had to be built and registered by hand in the
 * module's `activate`, which is the imperative form of exactly the thing
 * `@component` exists to declare.
 *
 * What makes one service id answer differently per module is `module` scope: the
 * factory is told which module it is building for. That is also the boundary of
 * what this can be — the module's context, not the component's. Configuration and
 * service properties differ per instance, and at construction time the instance
 * does not exist yet.
 */

import { serviceId } from './serviceId.js'
import type { ModuleContext } from './types.js'

/**
 * The service every module's own context is available under.
 *
 * ```typescript
 * @component({ service: [DATASOURCE_REPOSITORY] })
 * export class Datasources implements DatasourceRepository {
 *   constructor(@inject(MODULE_CONTEXT) private readonly context: ModuleContext) {}
 *
 *   resolve<T>(id: ServiceId<T>): T {
 *     // at call time, not at start time — which is why the constructor needs it
 *     return this.context.services.getRequired(id)
 *   }
 * }
 * ```
 *
 * Resolving it from outside a module throws rather than answering: handing over
 * another module's context would make a teardown release the wrong registrations.
 */
export const MODULE_CONTEXT_SERVICE_ID = serviceId<ModuleContext>('tsm.module.context')
