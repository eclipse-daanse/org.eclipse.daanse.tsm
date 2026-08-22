/**
 * TSM - TypeScript Module System
 * Typed service ids — the contract and its name as one thing
 *
 * In OSGi a service is named by its interface: `@Reference private TileService
 * tiles;` and the declaration *is* the contract. A TypeScript interface does not
 * survive compilation, so tsm names services with strings — and the consumer ends
 * up importing two things where one should do, with nothing checking that they
 * belong together.
 *
 * A `ServiceId<T>` closes that. It is a string carrying a phantom type: identical
 * at runtime, so a manifest, a target filter and a capability all keep working;
 * but the type it stands for travels with it, so a resolution needs no type
 * argument and a mismatch is a compile error.
 *
 * ```typescript
 * // the contract module — the string appears exactly once, here
 * export interface TileService { tileUrl(z: number): string }
 * export const TileService = serviceId<TileService>('demo.tiles')
 *
 * // the consumer — one import, and it reads like OSGi
 * @component()
 * class Map2D {
 *   constructor(@inject(TileService) private tiles: TileService) {}
 * }
 * ```
 *
 * The two names are the same because TypeScript keeps values and types in
 * separate namespaces — the same trick `Date` and `Array` use in the standard
 * library.
 *
 * What this does **not** do is make the name canonical. `serviceId<Widget>(
 * 'demo.tiles')` is a lie no compiler can catch, where a Java class name cannot
 * lie. The contract is one file that is written once and imported thereafter,
 * which is where the honesty has to come from.
 */

declare const contract: unique symbol

/**
 * A service id that knows what it stands for.
 *
 * A `string` at runtime and everywhere a string is expected: the brand is
 * optional, so a plain string literal is still assignable and nothing that took
 * ids before needs changing.
 *
 * That optionality is also why signatures take `ServiceId<T>` alone rather than
 * `ServiceId<T> | string`. The union looks more permissive but is strictly worse:
 * inference matches the argument against `string`, leaves `T` unresolved, and
 * every call comes back `unknown` — so the union would accept the same arguments
 * while destroying the only thing the type is for.
 */
export type ServiceId<T> = string & { readonly [contract]?: T }

/**
 * Name a service, together with the contract it stands for.
 *
 * An identity function — the value returned *is* the string passed in. The same
 * shape `objectClass()` has for configuration schemas, and for the same reason:
 * the declaration should be the single place both the name and the type come
 * from.
 */
export function serviceId<T>(id: string): ServiceId<T> {
  return id as ServiceId<T>
}

/**
 * What a `ServiceId` stands for, for a signature that has to name it.
 *
 * `ServiceOf<typeof TileService>` is `TileService`. Rarely needed directly —
 * inference covers the ordinary cases — but a wrapper around `get()` cannot be
 * written without it.
 */
export type ServiceOf<Id> = Id extends ServiceId<infer T> ? T : unknown
