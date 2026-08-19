#!/usr/bin/env node
/**
 * Fetch the OSGi specification chapters tsm is modelled on into docs/osgi/.
 *
 * The documents are not kept in the repository: they are 6.5 MB of material
 * nobody here wrote, and their licence permits copying but not modification, so
 * there is nothing to maintain — only to download when someone wants to read it.
 *
 *   npm run docs:osgi              # skips what is already there
 *   npm run docs:osgi -- --force   # downloads again, e.g. after RELEASE changed
 */

import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE = '8.0.0'
const BASE = 'https://docs.osgi.org/specification'

/**
 * The chapters, and what each one carries. Keep this list in step with the table
 * in docs/osgi/README.md — it is the same information, once for a reader and once
 * for the downloader.
 */
const CHAPTERS = [
  ['osgi.core', 'framework.service', 'Core 5 — Service Layer'],
  ['osgi.core', 'framework.module', 'Core 3 — Module Layer, incl. filter syntax'],
  ['osgi.core', 'framework.lifecycle', 'Core 4 — Life Cycle Layer'],
  ['osgi.core', 'framework.namespaces', 'Core 8 — Framework Namespaces'],
  ['osgi.cmpn', 'service.cm', 'Compendium 104 — Configuration Admin'],
  ['osgi.cmpn', 'service.metatype', 'Compendium 105 — Metatype'],
  ['osgi.cmpn', 'service.component', 'Compendium 112 — Declarative Services'],
  ['osgi.cmpn', 'service.feature', 'Compendium 159 — Feature Service']
]

/** The licence text, which the licence itself requires to travel along */
const LICENCE = ['osgi.cmpn', 'LICENSE', 'Eclipse Foundation Specification License v1.0']

const force = process.argv.includes('--force')
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'osgi')

/** `osgi.core` + `framework.service` becomes `core-framework.service.html` */
function fileNameFor(specification, chapter) {
  return `${specification.replace('osgi.', '')}-${chapter}.html`
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function download(specification, chapter, description, name) {
  const path = join(target, name)

  if (!force && await exists(path)) {
    console.log(`  kept     ${name}  (${description})`)
    return 'kept'
  }

  const url = `${BASE}/${specification}/${RELEASE}/${chapter}.html`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }

  const body = Buffer.from(await response.arrayBuffer())
  await writeFile(path, body)
  console.log(`  fetched  ${name}  ${(body.length / 1024).toFixed(0)} KiB  (${description})`)
  return 'fetched'
}

async function main() {
  await mkdir(target, { recursive: true })
  console.log(`OSGi Release ${RELEASE} → docs/osgi/`)

  const jobs = [
    ...CHAPTERS.map(([specification, chapter, description]) =>
      [specification, chapter, description, fileNameFor(specification, chapter)]),
    [LICENCE[0], LICENCE[1], LICENCE[2], 'LICENSE.html']
  ]

  const results = []
  for (const job of jobs) {
    // One at a time: a readable log matters more here than a second saved
    results.push(await download(...job))
  }

  const fetched = results.filter(result => result === 'fetched').length
  console.log(
    `${fetched} fetched, ${results.length - fetched} already present.` +
    (fetched > 0 ? ' See docs/osgi/README.md for which chapter carries what.' : '')
  )
}

main().catch(error => {
  console.error(`Could not fetch the specifications: ${error.message}`)
  process.exitCode = 1
})
