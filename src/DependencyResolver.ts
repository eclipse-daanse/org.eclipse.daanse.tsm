/**
 * TSM - TypeScript Module System
 * Dependency Resolver - Topological sorting, cycle detection, and version resolution
 */

import * as semver from 'semver'
import type {
  ModuleManifest,
  DependencyResolution,
  Dependency,
  DependencySpec,
  VersionConflict
} from './types.js'

/**
 * Normalize a dependency to DependencySpec format
 */
function normalizeDependency(dep: Dependency): DependencySpec {
  if (typeof dep === 'string') {
    return { id: dep }
  }
  return dep
}

/**
 * Get the module ID from a dependency
 */
function getDependencyId(dep: Dependency): string {
  return typeof dep === 'string' ? dep : dep.id
}

/**
 * Resolves module dependencies and determines load order
 * Supports semver version ranges for dependencies
 */
export class DependencyResolver {
  /**
   * Resolve dependencies and return load order
   * Uses Kahn's algorithm for topological sorting
   * Validates version compatibility using semver
   */
  resolve(modules: ModuleManifest[]): DependencyResolution {
    const result: DependencyResolution = {
      loadOrder: [],
      circular: [],
      missing: [],
      versionConflicts: [],
      resolvedVersions: new Map()
    }

    // Build module map: id -> list of manifests (for multi-version support)
    const moduleVersionsMap = new Map<string, ModuleManifest[]>()
    for (const mod of modules) {
      const existing = moduleVersionsMap.get(mod.id) ?? []
      existing.push(mod)
      moduleVersionsMap.set(mod.id, existing)
    }

    // Build simple module map (latest version or single version)
    const moduleMap = new Map<string, ModuleManifest>()
    for (const [id, versions] of moduleVersionsMap) {
      // Sort by version descending, pick highest
      const sorted = [...versions].sort((a, b) =>
        semver.rcompare(a.version, b.version)
      )
      moduleMap.set(id, sorted[0])
      result.resolvedVersions.set(id, sorted[0].version)
    }

    // Check for missing dependencies and version compatibility
    for (const mod of modules) {
      for (const dep of mod.dependencies ?? []) {
        const depSpec = normalizeDependency(dep)
        const availableModule = moduleMap.get(depSpec.id)

        if (!availableModule) {
          result.missing.push({ moduleId: mod.id, missingDep: depSpec.id })
        } else if (depSpec.versionRange) {
          // Check version compatibility
          if (!semver.satisfies(availableModule.version, depSpec.versionRange)) {
            // Find or create conflict entry
            let conflict = result.versionConflicts.find(c => c.moduleId === depSpec.id)
            if (!conflict) {
              conflict = {
                moduleId: depSpec.id,
                availableVersion: availableModule.version,
                requirements: []
              }
              result.versionConflicts.push(conflict)
            }
            conflict.requirements.push({
              requiredBy: mod.id,
              versionRange: depSpec.versionRange
            })
          }
        }
      }
    }

    // Detect circular dependencies
    result.circular = this.detectCycles(modules)

    // If there are cycles, we can't do a full topological sort
    // but we'll try to give a reasonable order
    if (result.circular.length > 0) {
      result.loadOrder = this.fallbackSort(modules)
      return result
    }

    // Topological sort using Kahn's algorithm
    result.loadOrder = this.topologicalSort(modules, moduleMap)

    return result
  }

  /**
   * Find the best matching version for a dependency spec
   * Returns undefined if no matching version exists
   */
  findMatchingVersion(
    depSpec: DependencySpec,
    modules: ModuleManifest[]
  ): ModuleManifest | undefined {
    const candidates = modules.filter(m => m.id === depSpec.id)

    if (candidates.length === 0) {
      return undefined
    }

    if (!depSpec.versionRange) {
      // No version constraint, return highest version
      return candidates.sort((a, b) => semver.rcompare(a.version, b.version))[0]
    }

    // Filter by version range and return highest matching
    const matching = candidates
      .filter(m => semver.satisfies(m.version, depSpec.versionRange!))
      .sort((a, b) => semver.rcompare(a.version, b.version))

    return matching[0]
  }

  /**
   * Check if a specific version satisfies a dependency spec
   */
  satisfies(version: string, depSpec: DependencySpec): boolean {
    if (!depSpec.versionRange) {
      return true // No constraint means any version is acceptable
    }
    return semver.satisfies(version, depSpec.versionRange)
  }

  /**
   * Find the maximum version that satisfies all given constraints
   */
  findCompatibleVersion(
    moduleId: string,
    constraints: string[],
    modules: ModuleManifest[]
  ): string | undefined {
    const candidates = modules
      .filter(m => m.id === moduleId)
      .map(m => m.version)
      .sort((a, b) => semver.rcompare(a, b))

    for (const version of candidates) {
      const satisfiesAll = constraints.every(range =>
        semver.satisfies(version, range)
      )
      if (satisfiesAll) {
        return version
      }
    }

    return undefined
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCycles(modules: ModuleManifest[]): string[][] {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const path: string[] = []

    const moduleMap = new Map<string, ModuleManifest>()
    for (const mod of modules) {
      // Use first occurrence for cycle detection
      if (!moduleMap.has(mod.id)) {
        moduleMap.set(mod.id, mod)
      }
    }

    const dfs = (moduleId: string): boolean => {
      visited.add(moduleId)
      recursionStack.add(moduleId)
      path.push(moduleId)

      const mod = moduleMap.get(moduleId)
      if (mod) {
        for (const dep of mod.dependencies ?? []) {
          const depId = getDependencyId(dep)
          if (!visited.has(depId)) {
            if (dfs(depId)) return true
          } else if (recursionStack.has(depId)) {
            // Found cycle
            const cycleStart = path.indexOf(depId)
            const cycle = path.slice(cycleStart)
            cycle.push(depId) // Complete the cycle
            cycles.push(cycle)
            return true
          }
        }
      }

      path.pop()
      recursionStack.delete(moduleId)
      return false
    }

    for (const mod of modules) {
      if (!visited.has(mod.id)) {
        dfs(mod.id)
      }
    }

    return cycles
  }

  /**
   * Topological sort using Kahn's algorithm
   */
  private topologicalSort(
    _modules: ModuleManifest[],
    moduleMap: Map<string, ModuleManifest>
  ): ModuleManifest[] {
    // Deduplicate modules by ID (keep highest version)
    const uniqueModules = Array.from(moduleMap.values())

    // Calculate in-degree for each module
    const inDegree = new Map<string, number>()
    for (const mod of uniqueModules) {
      inDegree.set(mod.id, 0)
    }

    for (const mod of uniqueModules) {
      for (const dep of mod.dependencies ?? []) {
        const depId = getDependencyId(dep)
        if (moduleMap.has(depId)) {
          inDegree.set(mod.id, (inDegree.get(mod.id) ?? 0) + 1)
        }
      }
    }

    // Queue modules with no dependencies
    const queue: ModuleManifest[] = []
    for (const mod of uniqueModules) {
      if (inDegree.get(mod.id) === 0) {
        queue.push(mod)
      }
    }

    // Sort queue by priority (higher first)
    queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    const result: ModuleManifest[] = []

    while (queue.length > 0) {
      // Get module with highest priority
      queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      const mod = queue.shift()!
      result.push(mod)

      // Reduce in-degree for dependent modules
      for (const otherMod of uniqueModules) {
        const dependsOnMod = otherMod.dependencies?.some(
          dep => getDependencyId(dep) === mod.id
        )
        if (dependsOnMod) {
          const newDegree = (inDegree.get(otherMod.id) ?? 1) - 1
          inDegree.set(otherMod.id, newDegree)
          if (newDegree === 0) {
            queue.push(otherMod)
          }
        }
      }
    }

    return result
  }

  /**
   * Fallback sorting when cycles exist
   */
  private fallbackSort(modules: ModuleManifest[]): ModuleManifest[] {
    // Deduplicate by ID (keep highest version)
    const moduleMap = new Map<string, ModuleManifest>()
    for (const mod of modules) {
      const existing = moduleMap.get(mod.id)
      if (!existing || semver.gt(mod.version, existing.version)) {
        moduleMap.set(mod.id, mod)
      }
    }

    return [...moduleMap.values()].sort((a, b) => {
      // Higher priority first
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0)
      if (priorityDiff !== 0) return priorityDiff

      // Fewer dependencies first
      const aDeps = a.dependencies?.length ?? 0
      const bDeps = b.dependencies?.length ?? 0
      return aDeps - bDeps
    })
  }

  /**
   * Get all transitive dependencies of a module
   */
  getTransitiveDependencies(
    moduleId: string,
    modules: ModuleManifest[]
  ): string[] {
    const moduleMap = new Map<string, ModuleManifest>()
    for (const mod of modules) {
      if (!moduleMap.has(mod.id)) {
        moduleMap.set(mod.id, mod)
      }
    }

    const result = new Set<string>()
    const visited = new Set<string>()

    const collect = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)

      const mod = moduleMap.get(id)
      if (mod) {
        for (const dep of mod.dependencies ?? []) {
          const depId = getDependencyId(dep)
          result.add(depId)
          collect(depId)
        }
      }
    }

    collect(moduleId)
    return Array.from(result)
  }

  /**
   * Get modules that depend on the given module
   */
  getDependents(moduleId: string, modules: ModuleManifest[]): string[] {
    return modules
      .filter(mod =>
        mod.dependencies?.some(dep => getDependencyId(dep) === moduleId)
      )
      .map(mod => mod.id)
  }

  /**
   * Check if all version constraints can be satisfied
   * Returns list of modules with unsatisfiable constraints
   */
  validateVersionConstraints(modules: ModuleManifest[]): VersionConflict[] {
    const conflicts: VersionConflict[] = []

    // Collect all version requirements per module
    const requirements = new Map<string, Array<{ requiredBy: string; versionRange: string }>>()

    for (const mod of modules) {
      for (const dep of mod.dependencies ?? []) {
        const depSpec = normalizeDependency(dep)
        if (depSpec.versionRange) {
          const existing = requirements.get(depSpec.id) ?? []
          existing.push({ requiredBy: mod.id, versionRange: depSpec.versionRange })
          requirements.set(depSpec.id, existing)
        }
      }
    }

    // Check each module's requirements
    for (const [moduleId, reqs] of requirements) {
      const available = modules.filter(m => m.id === moduleId)
      if (available.length === 0) continue

      // Find if any version satisfies all requirements
      const satisfyingVersion = available.find(m =>
        reqs.every(r => semver.satisfies(m.version, r.versionRange))
      )

      if (!satisfyingVersion) {
        // Find highest available version for the conflict report
        const highest = available.sort((a, b) =>
          semver.rcompare(a.version, b.version)
        )[0]

        conflicts.push({
          moduleId,
          availableVersion: highest.version,
          requirements: reqs
        })
      }
    }

    return conflicts
  }

  /**
   * Suggest version ranges that could resolve conflicts
   */
  suggestResolution(conflict: VersionConflict): string | undefined {
    // Try to find a range that could work
    const ranges = conflict.requirements.map(r => r.versionRange)

    // Try intersection of all ranges
    // This is a simplified approach - real resolution would be more complex
    try {
      const intersection = semver.intersects(ranges[0], ranges[1])
      if (intersection) {
        return `Consider using version range that satisfies: ${ranges.join(' AND ')}`
      }
    } catch {
      // Ranges don't intersect
    }

    return `No compatible version found. Required: ${ranges.join(', ')}`
  }
}