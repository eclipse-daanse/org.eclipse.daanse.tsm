/**
 * Features (Compendium 159).
 *
 * The specification defines a document and an API to read it, and says
 * explicitly that installing one is a launcher's business. Both halves are here:
 * the document, and the launcher tsm adds.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readFeature,
  writeFeature,
  validateFeature,
  resolveConfigurations,
  missingVariables,
  parseFeatureId,
  formatFeatureId,
  stripComments,
  featureService,
  FEATURE_SERVICE_ID,
  type Feature
} from '../features.js'
import { installFeature, isComplete, unsatisfiedRequirements } from '../featureLauncher.js'
import { ModuleLoader } from '../ModuleLoader.js'
import { ConfigurationAdmin } from '../ConfigurationAdmin.js'
import { component, activate } from '../decorators.js'
import type { ComponentContext, ModuleManifest } from '../types.js'

describe('feature ids', () => {
  it('parses name and version', () => {
    expect(parseFeatureId('acme-app@1.0.0')).toEqual({ name: 'acme-app', version: '1.0.0' })
  })

  it('keeps the leading @ of a scope with the name', () => {
    // Why this is not a split('@')
    expect(parseFeatureId('@acme/app@2.1.0'))
      .toEqual({ name: '@acme/app', version: '2.1.0' })
  })

  it('refuses one without a version', () => {
    expect(() => parseFeatureId('acme-app')).toThrow('no version')
  })

  it('refuses an empty half', () => {
    expect(() => parseFeatureId('acme-app@')).toThrow('empty')
  })

  it('round-trips', () => {
    for (const id of ['a@1.0.0', '@scope/b@2.0.0-rc.1']) {
      expect(formatFeatureId(parseFeatureId(id))).toBe(id)
    }
  })
})

describe('comments', () => {
  it('drops line comments', () => {
    expect(stripComments('{"a":1} // trailing').trim()).toBe('{"a":1}')
  })

  it('drops block comments', () => {
    expect(stripComments('{/* gone */"a":1}')).toBe('{"a":1}')
  })

  it('leaves // inside a string alone', () => {
    // A URL in a configuration value would otherwise be truncated silently
    const text = '{"url":"https://example.com/x"}'
    expect(stripComments(text)).toBe(text)
  })

  it('leaves an escaped quote alone', () => {
    const text = '{"q":"say \\"hi\\" // now"}'
    expect(stripComments(text)).toBe(text)
  })

  it('is applied by readFeature', () => {
    const feature = readFeature(`{
      // the app
      "id": "acme@1.0.0"
      /* and nothing else */
    }`)
    expect(feature.id.name).toBe('acme')
  })
})

describe('reading a feature', () => {
  it('takes the specification\'s minimal document', () => {
    const feature = readFeature(`{
      "feature-resource-version": "1.0",
      "id": "@acme/app@1.0.0",
      "name": "The ACME app",
      "description": "This is the main ACME app."
    }`)

    expect(feature.id).toEqual({ name: '@acme/app', version: '1.0.0' })
    expect(feature.name).toBe('The ACME app')
    expect(feature.complete).toBe(false)
    expect(feature.categories).toEqual([])
    expect(feature.bundles).toEqual([])
  })

  it('refuses a document without an id', () => {
    expect(() => readFeature('{"name":"x"}')).toThrow('needs an "id"')
  })

  it('refuses a resource version it does not know', () => {
    expect(() => readFeature('{"id":"a@1.0.0","feature-resource-version":"2.0"}'))
      .toThrow('Unsupported feature-resource-version')
  })

  it('reads bundles with their metadata', () => {
    const feature = readFeature(`{
      "id": "acme@1.0.1",
      "bundles": [
        { "id": "tiles@1.0.0" },
        { "id": "map@2.0.0", "org.acme.docs": "https://docs/map", "start-order": 2 }
      ]
    }`)

    expect(feature.bundles.map(bundle => formatFeatureId(bundle.id)))
      .toEqual(['tiles@1.0.0', 'map@2.0.0'])
    expect(feature.bundles[0].metadata).toBeUndefined()
    expect(feature.bundles[1].metadata).toEqual({
      'org.acme.docs': 'https://docs/map', 'start-order': 2
    })
  })

  it('refuses bundle metadata that is not a scalar', () => {
    expect(() => readFeature(`{
      "id": "a@1.0.0",
      "bundles": [{ "id": "b@1.0.0", "nested": { "no": true } }]
    }`)).toThrow('only strings, numbers and booleans')
  })

  it('reads configurations by pid', () => {
    const feature = readFeature(`{
      "id": "acme@1.0.0",
      "configurations": {
        "demo.tiles": { "url": "https://tiles/{z}", "zoom": 3 },
        "demo.source~satellite": { "url": "https://sat/{z}" }
      }
    }`)

    expect(feature.configurations['demo.tiles']).toEqual({
      url: 'https://tiles/{z}', zoom: 3
    })
    // A factory configuration uses the same `factoryPid~name` form as everywhere
    expect(feature.configurations['demo.source~satellite']).toBeDefined()
  })

  it('reads variables, null included', () => {
    const feature = readFeature(`{
      "id": "acme@1.0.0",
      "variables": { "port": 8080, "user": "scott", "password": null }
    }`)

    expect(feature.variables).toEqual({ port: 8080, user: 'scott', password: null })
  })

  it('refuses a variable default that is an object', () => {
    expect(() => readFeature('{"id":"a@1.0.0","variables":{"x":{"y":1}}}'))
      .toThrow('has to be a string')
  })

  it('is frozen, as the specification requires', () => {
    const feature = readFeature('{"id":"a@1.0.0"}')
    expect(Object.isFrozen(feature)).toBe(true)
    expect(() => {
      (feature as { name?: string }).name = 'changed'
    }).toThrow()
  })

  it('takes an object as readily as a string', () => {
    expect(readFeature({ id: 'a@1.0.0' }).id.name).toBe('a')
  })
})

describe('extensions', () => {
  it('reads a text extension', () => {
    const feature = readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "org.acme.doc": { "type": "text", "text": ["one", "two"] } }
    }`)

    const extension = feature.extensions['org.acme.doc']
    expect(extension).toEqual({ type: 'text', kind: 'optional', text: ['one', 'two'] })
  })

  it('reads a json extension', () => {
    const feature = readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "org.acme.env": { "type": "json", "kind": "mandatory",
        "json": { "framework": "tsm" } } }
    }`)

    expect(feature.extensions['org.acme.env']).toEqual({
      type: 'json', kind: 'mandatory', json: { framework: 'tsm' }
    })
  })

  it('reads an artifacts extension', () => {
    const feature = readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "org.acme.ddl": { "type": "artifacts",
        "artifacts": [{ "id": "schema@1.0.0" }] } }
    }`)

    const extension = feature.extensions['org.acme.ddl']
    expect(extension.type).toBe('artifacts')
    expect(extension.type === 'artifacts' && extension.artifacts[0].id.name).toBe('schema')
  })

  it('defaults the kind to optional', () => {
    const feature = readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "x": { "type": "text", "text": [] } }
    }`)
    expect(feature.extensions.x.kind).toBe('optional')
  })

  it('refuses an unknown type', () => {
    expect(() => readFeature(`{
      "id": "a@1.0.0", "extensions": { "x": { "type": "yaml" } }
    }`)).toThrow("expected 'text', 'json' or 'artifacts'")
  })

  it('refuses an unknown kind', () => {
    expect(() => readFeature(`{
      "id": "a@1.0.0", "extensions": { "x": { "type": "text", "text": [], "kind": "vital" } }
    }`)).toThrow("expected 'mandatory', 'optional' or 'transient'")
  })
})

describe('variables', () => {
  const feature = (): Feature => readFeature(`{
    "id": "acme@1.0.0",
    "variables": { "port": 8080, "user": "scott", "password": null },
    "configurations": {
      "acme.http": { "port:Integer": "\${port}" },
      "acme.db": { "user": "\${user}-admin", "password": "\${password}" },
      "acme.other": { "note": "\${nothing.knows.this}", "kept": 42 }
    }
  }`)

  it('substitutes a default', () => {
    expect(resolveConfigurations(feature())['acme.db'].user).toBe('scott-admin')
  })

  it('prefers a supplied value', () => {
    expect(resolveConfigurations(feature(), { user: 'tiger' })['acme.db'].user)
      .toBe('tiger-admin')
  })

  it('converts a typed key and drops the type from the name', () => {
    // A placeholder always yields a string, which is why the typed syntax exists
    const resolved = resolveConfigurations(feature(), { port: 9090 })['acme.http']
    expect(resolved.port).toBe(9090)
    expect(resolved['port:Integer']).toBeUndefined()
  })

  it('leaves an unknown placeholder as it is', () => {
    // The specification requires this: a launcher further along may know it, and
    // emptying it would turn a missing value into a wrong one
    expect(resolveConfigurations(feature())['acme.other'].note)
      .toBe('${nothing.knows.this}')
  })

  it('leaves a null variable as a placeholder until it is supplied', () => {
    expect(resolveConfigurations(feature())['acme.db'].password).toBe('${password}')
    expect(resolveConfigurations(feature(), { password: 's3cret' })['acme.db'].password)
      .toBe('s3cret')
  })

  it('leaves non-string values untouched', () => {
    expect(resolveConfigurations(feature())['acme.other'].kept).toBe(42)
  })

  it('keeps a key whose declared type is unknown', () => {
    // Guessing would put the value under a name the component never declared
    const resolved = resolveConfigurations(readFeature(`{
      "id": "a@1.0.0", "configurations": { "p": { "x:Duration": "5s" } }
    }`))
    expect(resolved.p['x:Duration']).toBe('5s')
  })

  it('reports what still has to be supplied', () => {
    expect(missingVariables(feature())).toEqual(['password'])
    expect(missingVariables(feature(), { password: 'x' })).toEqual([])
  })
})

describe('writing a feature', () => {
  it('round-trips', () => {
    const original = `{
      "id": "@acme/app@1.2.3",
      "name": "App",
      "complete": true,
      "categories": ["demo"],
      "bundles": [{ "id": "tiles@1.0.0", "start-order": 1 }],
      "configurations": { "demo.tiles": { "zoom": 3 } },
      "variables": { "port": 8080 },
      "extensions": { "x": { "type": "text", "kind": "optional", "text": ["hi"] } }
    }`

    const once = readFeature(original)
    const twice = readFeature(writeFeature(once))
    expect(twice).toEqual(once)
  })

  it('leaves out what was never there', () => {
    const document = JSON.parse(writeFeature(readFeature('{"id":"a@1.0.0"}')))
    expect(Object.keys(document)).toEqual(['feature-resource-version', 'id'])
  })

  it('writes the resource version', () => {
    expect(JSON.parse(writeFeature(readFeature('{"id":"a@1.0.0"}')))['feature-resource-version'])
      .toBe('1.0')
  })
})

describe('validating a feature', () => {
  it('passes a sound one', () => {
    expect(validateFeature(readFeature(`{
      "id": "a@1.0.0", "bundles": [{ "id": "b@1.0.0" }, { "id": "c@1.0.0" }]
    }`))).toEqual([])
  })

  it('reports the same module listed twice', () => {
    const problems = validateFeature(readFeature(`{
      "id": "a@1.0.0", "bundles": [{ "id": "b@1.0.0" }, { "id": "b@1.0.0" }]
    }`))

    expect(problems).toEqual([
      { at: 'bundles[1]', problem: "'b@1.0.0' is already listed at 0" }
    ])
  })

  it('allows two versions of one module', () => {
    // The specification permits it deliberately; the same version twice cannot be
    // deliberate
    expect(validateFeature(readFeature(`{
      "id": "a@1.0.0", "bundles": [{ "id": "b@1.0.0" }, { "id": "b@2.0.0" }]
    }`))).toEqual([])
  })

  it('reports a variable nobody can supply', () => {
    const problems = validateFeature(readFeature(`{
      "id": "a@1.0.0", "variables": { "secret": null }
    }`))
    expect(problems[0].at).toBe('variables.secret')
  })

  it('accepts it once it is supplied', () => {
    expect(validateFeature(
      readFeature('{"id":"a@1.0.0","variables":{"secret":null}}'),
      { supplied: { secret: 'x' } }
    )).toEqual([])
  })

  it('reports a mandatory extension this consumer cannot handle', () => {
    const feature = readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "acme.ddl": { "type": "text", "kind": "mandatory", "text": [] } }
    }`)

    expect(validateFeature(feature)[0].at).toBe('extensions.acme.ddl')
    expect(validateFeature(feature, { handles: ['acme.ddl'] })).toEqual([])
  })

  it('says nothing about an optional extension nobody handles', () => {
    expect(validateFeature(readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "acme.ddl": { "type": "text", "text": [] } }
    }`))).toEqual([])
  })
})

describe('the service', () => {
  it('is published by the loader', () => {
    const loader = new ModuleLoader()
    expect(loader.getServiceRegistry().get(FEATURE_SERVICE_ID)).toBe(featureService)
  })

  it('builds an id', () => {
    expect(featureService.getId('acme', '1.0.0')).toEqual({ name: 'acme', version: '1.0.0' })
  })

  it('is frozen', () => {
    expect(Object.isFrozen(featureService)).toBe(true)
  })
})

describe('installing a feature', () => {
  let loader: ModuleLoader
  let admin: ConfigurationAdmin
  let started: Array<Record<string, unknown>>

  const manifests: Record<string, ModuleManifest> = {
    tiles: { id: 'tiles', version: '1.0.0', entry: 'tiles.js', exports: {} },
    map: { id: 'map', version: '2.0.0', entry: 'map.js', exports: {} }
  }

  const resolve = (id: { name: string }): ModuleManifest | undefined => manifests[id.name]

  beforeEach(() => {
    started = []
    admin = new ConfigurationAdmin()
    loader = new ModuleLoader({
      configurationAdmin: admin,
      entryResolver: manifest => {
        const seen = started
        @component({ configurationPid: 'demo.tiles', configurationPolicy: 'require' })
        class Configured {
          @activate() start(context: ComponentContext): void {
            seen.push({ module: manifest.id, ...context.configuration })
          }
        }
        return { Configured }
      }
    })
  })

  const feature = readFeature(`{
    "id": "@acme/app@1.0.0",
    "name": "The app",
    "bundles": [{ "id": "tiles@1.0.0" }, { "id": "map@2.0.0" }],
    "variables": { "zoom": 3 },
    "configurations": { "demo.tiles": { "url": "https://tiles", "zoom:Integer": "\${zoom}" } }
  }`)

  it('registers the modules and loads them', async () => {
    const result = await installFeature(feature, { loader, configurationAdmin: admin, resolve })

    expect(result.loaded.sort()).toEqual(['map', 'tiles'])
    expect(loader.getModule('tiles')?.state).toBe('active')
  })

  it('writes the configuration', async () => {
    const result = await installFeature(feature, { loader, configurationAdmin: admin, resolve })

    expect(result.configured).toEqual(['demo.tiles'])
    expect(admin.findConfiguration('demo.tiles')?.getProperties()?.url).toBe('https://tiles')
  })

  it('writes it before loading, so a required PID is there on the first activation', async () => {
    await installFeature(feature, { loader, configurationAdmin: admin, resolve })

    // configurationPolicy: 'require' — these components could not have started at
    // all if the configuration had arrived after the load
    expect(started).toHaveLength(2)
    expect(started[0].url).toBe('https://tiles')
  })

  it('applies variables and typed keys on the way', async () => {
    await installFeature(feature, {
      loader, configurationAdmin: admin, resolve, variables: { zoom: 7 }
    })

    expect(started[0].zoom).toBe(7)
  })

  it('registers without loading when asked', async () => {
    const result = await installFeature(feature, {
      loader, configurationAdmin: admin, resolve, load: false
    })

    expect(result.loaded).toEqual([])
    expect(result.manifests.map(manifest => manifest.id)).toEqual(['tiles', 'map'])
    expect(loader.getModule('tiles')).toBeUndefined()
    // The configuration is written all the same, which is what a staged rollout
    // wants: resolve and configure now, load later
    expect(admin.findConfiguration('demo.tiles')).toBeDefined()
  })

  it('refuses before doing anything when a module is unavailable', async () => {
    const partial = readFeature(`{
      "id": "a@1.0.0", "bundles": [{ "id": "tiles@1.0.0" }, { "id": "nowhere@1.0.0" }]
    }`)

    await expect(installFeature(partial, { loader, configurationAdmin: admin, resolve }))
      .rejects.toThrow('nowhere@1.0.0')

    // Half-installing is worse than not installing: the half that ran cannot be
    // told from a system meant to look that way
    expect(loader.getModule('tiles')).toBeUndefined()
  })

  it('refuses when a variable has no value', async () => {
    const needsSecret = readFeature(`{
      "id": "a@1.0.0", "variables": { "secret": null },
      "configurations": { "p": { "key": "\${secret}" } }
    }`)

    await expect(installFeature(needsSecret, { loader, configurationAdmin: admin, resolve }))
      .rejects.toThrow('variables.secret')
  })

  it('refuses configuration with nowhere to put it', async () => {
    const bare = new ModuleLoader()

    await expect(installFeature(feature, { loader: bare, resolve }))
      .rejects.toThrow('no Configuration Admin')
  })

  it('installs a feature without configuration into a bare loader', async () => {
    const bare = new ModuleLoader({ entryResolver: () => ({}) })
    const plain = readFeature('{"id":"a@1.0.0","bundles":[{"id":"tiles@1.0.0"}]}')

    const result = await installFeature(plain, { loader: bare, resolve })
    expect(result.loaded).toEqual(['tiles'])
  })

  it('refuses a mandatory extension it cannot handle', async () => {
    const extended = readFeature(`{
      "id": "a@1.0.0",
      "extensions": { "acme.ddl": { "type": "text", "kind": "mandatory", "text": [] } }
    }`)

    await expect(installFeature(extended, { loader, configurationAdmin: admin, resolve }))
      .rejects.toThrow('extensions.acme.ddl')

    await expect(installFeature(extended, {
      loader, configurationAdmin: admin, resolve, handles: ['acme.ddl']
    })).resolves.toBeDefined()
  })
})

describe('completeness', () => {
  it('holds when nothing is missing', async () => {
    const loader = new ModuleLoader({ entryResolver: () => ({}) })
    const feature = readFeature('{"id":"a@1.0.0","complete":true,"bundles":[{"id":"solo@1.0.0"}]}')
    const manifests: ModuleManifest[] = [
      { id: 'solo', version: '1.0.0', entry: 'solo.js', exports: {} }
    ]
    loader.register(manifests)

    expect(isComplete(feature, { loader, manifests })).toBe(true)
  })

  it('reports what a feature relies on but does not bring', () => {
    // `complete: true` is a claim by the author; this is the check
    const loader = new ModuleLoader()
    const manifests: ModuleManifest[] = [{
      id: 'viewer', version: '1.0.0', entry: 'viewer.js', exports: {},
      requirements: [{ namespace: 'acme.screen', filter: '(width>=480)' }]
    }]
    loader.register(manifests)

    const feature = readFeature(
      '{"id":"a@1.0.0","complete":true,"bundles":[{"id":"viewer@1.0.0"}]}'
    )

    const missing = unsatisfiedRequirements(feature, { loader, manifests })
    expect(missing).toHaveLength(1)
    expect(missing[0]).toContain('acme.screen')
    expect(isComplete(feature, { loader, manifests })).toBe(false)
  })

  it('counts what the runtime itself offers', () => {
    // The same feature is complete in a runtime that has the capability and not
    // in one that does not, which is the distinction worth reporting
    const manifests: ModuleManifest[] = [{
      id: 'viewer', version: '1.0.0', entry: 'viewer.js', exports: {},
      requirements: [{ namespace: 'acme.screen', filter: '(width>=480)' }]
    }]
    const loader = new ModuleLoader({
      systemCapabilities: [{ namespace: 'acme.screen', attributes: { width: 640 } }]
    })
    loader.register(manifests)

    const feature = readFeature('{"id":"a@1.0.0","bundles":[{"id":"viewer@1.0.0"}]}')
    expect(isComplete(feature, { loader, manifests })).toBe(true)
  })
})

describe('the devtools command', () => {
  it('describes a feature and says what is missing', async () => {
    const { installDevtools, collectingOutput } = await import('../devtools/index.js')
    const out = collectingOutput()
    const loader = new ModuleLoader()
    const tools = installDevtools({ loader, target: null, output: out })

    const read = tools.feature(`{
      "id": "@acme/app@1.0.0",
      "name": "The app",
      "bundles": [{ "id": "tiles@1.0.0" }],
      "configurations": { "demo.tiles": { "url": "x" } },
      "variables": { "secret": null }
    }`)

    const text = out.lines.join('\n')
    expect(read?.id.name).toBe('@acme/app')
    expect(text).toContain('@acme/app@1.0.0')
    expect(text).toContain('1 module(s)')
    expect(text).toContain('tiles@1.0.0')
    expect(text).toContain('not loaded')
    expect(text).toContain('demo.tiles')
    expect(text).toContain('variables.secret')
  })

  it('reports a document that is not a feature', async () => {
    const { installDevtools, collectingOutput } = await import('../devtools/index.js')
    const out = collectingOutput()
    const tools = installDevtools({ loader: new ModuleLoader(), target: null, output: out })

    expect(tools.feature('{"name":"no id"}')).toBeUndefined()
    expect(out.errors[0].message).toContain('Not a feature')
  })

  it('shows a module that is already running as active', async () => {
    const { installDevtools, collectingOutput } = await import('../devtools/index.js')
    const out = collectingOutput()
    const loader = new ModuleLoader({ entryResolver: () => ({}) })
    await loader.loadModule({ id: 'tiles', version: '1.0.0', entry: 'tiles.js', exports: {} })

    const tools = installDevtools({ loader, target: null, output: out })
    tools.feature('{"id":"a@1.0.0","bundles":[{"id":"tiles@1.0.0"}]}')

    expect(out.lines.join('\n')).toContain('active')
  })
})
