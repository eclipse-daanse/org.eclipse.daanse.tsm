
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { DefaultServiceRegistry } from '../ServiceRegistry'
import { injectable, inject, singleton, transient } from '../decorators'

describe('Decorator-based Constructor Injection', () => {
  describe('@injectable and @inject', () => {
    it('should resolve a class with no dependencies', () => {
      @injectable()
      class HttpClient {
        request(url: string) { return url }
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('http.client', HttpClient)

      const client = registry.get<HttpClient>('http.client')
      expect(client).toBeInstanceOf(HttpClient)
      expect(client!.request('/api')).toBe('/api')
    })

    it('should resolve a class with one dependency', () => {
      @injectable()
      class Logger {
        log(msg: string) { return msg }
      }

      @injectable()
      class UserService {
        constructor(@inject('logger') public logger: Logger) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('logger', Logger)
      registry.bindClass('user.service', UserService)

      const service = registry.getRequired<UserService>('user.service')
      expect(service).toBeInstanceOf(UserService)
      expect(service.logger).toBeInstanceOf(Logger)
    })

    it('should resolve deep dependency chains', () => {
      @injectable()
      class Database {
        query() { return 'result' }
      }

      @injectable()
      class Repository {
        constructor(@inject('db') public db: Database) {}
      }

      @injectable()
      class Service {
        constructor(@inject('repo') public repo: Repository) {}
      }

      @injectable()
      class Controller {
        constructor(@inject('service') public service: Service) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('db', Database)
      registry.bindClass('repo', Repository)
      registry.bindClass('service', Service)
      registry.bindClass('controller', Controller)

      const controller = registry.getRequired<Controller>('controller')
      expect(controller.service.repo.db.query()).toBe('result')
    })

    it('should resolve multiple dependencies in correct order', () => {
      @injectable()
      class A { value = 'a' }

      @injectable()
      class B { value = 'b' }

      @injectable()
      class C { value = 'c' }

      @injectable()
      class Multi {
        constructor(
          @inject('a') public a: A,
          @inject('b') public b: B,
          @inject('c') public c: C
        ) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('a', A)
      registry.bindClass('b', B)
      registry.bindClass('c', C)
      registry.bindClass('multi', Multi)

      const multi = registry.getRequired<Multi>('multi')
      expect(multi.a.value).toBe('a')
      expect(multi.b.value).toBe('b')
      expect(multi.c.value).toBe('c')
    })
  })

  describe('optional dependencies', () => {
    it('should resolve optional dependency as undefined when missing', () => {
      @injectable()
      class Service {
        constructor(
          @inject('logger', { optional: true }) public logger: unknown
        ) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      const service = registry.getRequired<Service>('service')
      expect(service.logger).toBeUndefined()
    })

    it('should resolve optional dependency when present', () => {
      @injectable()
      class Logger { name = 'logger' }

      @injectable()
      class Service {
        constructor(
          @inject('logger', { optional: true }) public logger: Logger | undefined
        ) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('logger', Logger)
      registry.bindClass('service', Service)

      const service = registry.getRequired<Service>('service')
      expect(service.logger).toBeInstanceOf(Logger)
    })
  })

  describe('property injection', () => {
    it('should inject properties after construction', () => {
      @injectable()
      class Logger {
        log(msg: string) { return msg }
      }

      @injectable()
      class Service {
        @inject('logger')
        logger!: Logger
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('logger', Logger)
      registry.bindClass('service', Service)

      const service = registry.getRequired<Service>('service')
      expect(service.logger).toBeInstanceOf(Logger)
      expect(service.logger.log('hi')).toBe('hi')
    })

    it('should support optional property injection', () => {
      @injectable()
      class Service {
        @inject('missing', { optional: true })
        analytics?: unknown
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      const service = registry.getRequired<Service>('service')
      expect(service.analytics).toBeUndefined()
    })

    it('should throw on missing required property dependency', () => {
      @injectable()
      class Service {
        @inject('missing.dep')
        dep!: unknown
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      expect(() => registry.get('service')).toThrow(
        /Property dependency 'missing.dep' not found/
      )
    })

    it('should mix constructor and property injection', () => {
      @injectable()
      class Database { query() { return 'data' } }

      @injectable()
      class Logger { log(msg: string) { return msg } }

      @injectable()
      class Service {
        @inject('logger')
        logger!: Logger

        constructor(@inject('db') public db: Database) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('db', Database)
      registry.bindClass('logger', Logger)
      registry.bindClass('service', Service)

      const service = registry.getRequired<Service>('service')
      expect(service.db.query()).toBe('data')
      expect(service.logger.log('hi')).toBe('hi')
    })

    it('should resolve property injection chains', () => {
      @injectable()
      class Config { port = 3000 }

      @injectable()
      class Inner {
        @inject('config')
        config!: Config
      }

      @injectable()
      class Outer {
        @inject('inner')
        inner!: Inner
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('config', Config)
      registry.bindClass('inner', Inner)
      registry.bindClass('outer', Outer)

      const outer = registry.getRequired<Outer>('outer')
      expect(outer.inner.config.port).toBe(3000)
    })
  })

  describe('error handling', () => {
    it('should throw when class is not @injectable', () => {
      class NotInjectable {}

      const registry = new DefaultServiceRegistry()
      expect(() => registry.bindClass('nope', NotInjectable)).toThrow(
        /not decorated with @injectable/
      )
    })

    it('should throw on missing required dependency', () => {
      @injectable()
      class Service {
        constructor(@inject('missing.dep') public dep: unknown) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      expect(() => registry.get('service')).toThrow(
        /Dependency 'missing.dep' not found \(required by 'service'\)/
      )
    })

    it('should detect circular dependencies', () => {
      @injectable()
      class A {
        constructor(@inject('b') public b: unknown) {}
      }

      @injectable()
      class B {
        constructor(@inject('a') public a: unknown) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('a', A)
      registry.bindClass('b', B)

      expect(() => registry.get('a')).toThrow(/Circular dependency detected/)
    })

    it('should detect indirect circular dependencies', () => {
      @injectable()
      class A {
        constructor(@inject('b') public b: unknown) {}
      }

      @injectable()
      class B {
        constructor(@inject('c') public c: unknown) {}
      }

      @injectable()
      class C {
        constructor(@inject('a') public a: unknown) {}
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('a', A)
      registry.bindClass('b', B)
      registry.bindClass('c', C)

      expect(() => registry.get('a')).toThrow(/Circular dependency detected/)
    })
  })

  describe('scoping', () => {
    it('should default to singleton scope', () => {
      @injectable()
      class Service { id = Math.random() }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      const a = registry.get<Service>('service')
      const b = registry.get<Service>('service')
      expect(a).toBe(b)
    })

    it('should respect @singleton() decorator', () => {
      @injectable()
      @singleton()
      class Service { id = Math.random() }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      const a = registry.get<Service>('service')
      const b = registry.get<Service>('service')
      expect(a).toBe(b)
    })

    it('should respect @transient() decorator', () => {
      @injectable()
      @transient()
      class Service { id = Math.random() }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service)

      const a = registry.get<Service>('service')
      const b = registry.get<Service>('service')
      expect(a).not.toBe(b)
    })

    it('should allow scope override at bindClass()', () => {
      @injectable()
      @singleton()
      class Service { id = Math.random() }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service, { scope: 'transient' })

      const a = registry.get<Service>('service')
      const b = registry.get<Service>('service')
      expect(a).not.toBe(b)
    })

    it('should allow overriding @transient() to singleton at bindClass()', () => {
      @injectable()
      @transient()
      class Service { id = Math.random() }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('service', Service, { scope: 'singleton' })

      const a = registry.get<Service>('service')
      const b = registry.get<Service>('service')
      expect(a).toBe(b)
    })
  })

  describe('interface binding (implements)', () => {
    it('should resolve via implements alias', () => {
      @injectable()
      class InMemoryCache {
        get(key: string) { return `cached:${key}` }
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('cache.inmemory', InMemoryCache, {
        implements: ['cache']
      })

      const viaAlias = registry.get<InMemoryCache>('cache')
      const viaPrimary = registry.get<InMemoryCache>('cache.inmemory')

      expect(viaAlias).toBeInstanceOf(InMemoryCache)
      expect(viaAlias).toBe(viaPrimary) // same singleton
    })

    it('should support multiple implements', () => {
      @injectable()
      class RedisAdapter {
        name = 'redis'
      }

      const registry = new DefaultServiceRegistry()
      registry.bindClass('adapter.redis', RedisAdapter, {
        implements: ['cache', 'session.store']
      })

      expect(registry.get('cache')).toBe(registry.get('adapter.redis'))
      expect(registry.get('session.store')).toBe(registry.get('adapter.redis'))
    })

    it('should report implements IDs via has()', () => {
      @injectable()
      class Impl {}

      const registry = new DefaultServiceRegistry()
      registry.bindClass('impl', Impl, { implements: ['iface'] })

      expect(registry.has('impl')).toBe(true)
      expect(registry.has('iface')).toBe(true)
    })
  })

  describe('backward compatibility', () => {
    it('should still work with register()', () => {
      const registry = new DefaultServiceRegistry()
      const service = { name: 'direct' }
      registry.register('direct', service)

      expect(registry.get('direct')).toBe(service)
    })

    it('should still work with bind()', () => {
      const registry = new DefaultServiceRegistry()
      registry.bind('lazy', () => ({ name: 'lazy' }))

      const service = registry.get<{ name: string }>('lazy')
      expect(service?.name).toBe('lazy')
    })

    it('should allow bindClass services to depend on register/bind services', () => {
      const registry = new DefaultServiceRegistry()

      // Pre-registered instance
      registry.register('config', { dbUrl: 'postgres://...' })

      // Factory-bound service
      registry.bind('logger', () => ({ log: (msg: string) => msg }))

      @injectable()
      class App {
        constructor(
          @inject('config') public config: { dbUrl: string },
          @inject('logger') public logger: { log: (msg: string) => string }
        ) {}
      }

      registry.bindClass('app', App)

      const app = registry.getRequired<App>('app')
      expect(app.config.dbUrl).toBe('postgres://...')
      expect(app.logger.log('hi')).toBe('hi')
    })
  })
})
