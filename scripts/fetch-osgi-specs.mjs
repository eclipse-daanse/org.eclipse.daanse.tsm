#!/usr/bin/env node
/**
 * Fetch the OSGi specifications tsm is modelled on into docs/osgi/.
 *
 * The documents are not kept in the repository: 17 MB nobody here wrote, under a
 * licence that permits copying but not modification, so there is nothing to
 * maintain — only to download when someone wants to read it.
 *
 *   npm run docs:osgi              # skips what is already there
 *   npm run docs:osgi -- --force   # downloads again, e.g. after RELEASE changed
 */

import { mkdir, writeFile, access, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE = 'r8'
const VERSION = '8.0.0'
const BASE = `https://docs.osgi.org/download/${RELEASE}`

/**
 * The two specifications, whole rather than by chapter: a PDF reads through, and
 * once the files stay out of the repository their size costs nothing but the
 * download. Which chapter carries which part of tsm is in docs/osgi/README.md.
 */
const DOCUMENTS = [
  ['osgi.core', 'Core — module, life cycle and service layers, filter syntax'],
  ['osgi.cmpn', 'Compendium — Configuration Admin 104, Metatype 105, Declarative Services 112, Feature Service 159']
]

const force = process.argv.includes('--force')
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'osgi')

async function sizeOf(path) {
  try {
    await access(path)
    return (await stat(path)).size
  } catch {
    return undefined
  }
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function download(specification, description) {
  const name = `${specification}-${VERSION}.pdf`
  const path = join(target, name)

  const present = await sizeOf(path)
  if (!force && present !== undefined) {
    console.log(`  kept     ${name}  ${megabytes(present)}`)
    return 'kept'
  }

  const url = `${BASE}/${name}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }

  const body = Buffer.from(await response.arrayBuffer())
  await writeFile(path, body)
  console.log(`  fetched  ${name}  ${megabytes(body.length)}  — ${description}`)
  return 'fetched'
}

async function main() {
  await mkdir(target, { recursive: true })
  console.log(`OSGi Release ${VERSION} → docs/osgi/`)

  const results = []
  for (const [specification, description] of DOCUMENTS) {
    // One at a time: 17 MB with a readable log beats a second saved
    results.push(await download(specification, description))
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
