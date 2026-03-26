# Feature Request: Handle TypeScript inline type imports

## Problem

When using `tsmPlugin` with `sharedModules`, TypeScript inline type imports are incorrectly transformed, resulting in invalid JavaScript.

### Example

**Input:**
```typescript
import { ref, computed, type Ref } from 'tsm:vue'
```

**Current output (invalid JS):**
```javascript
const { ref, computed, type Ref } = __tsm__.require('vue')
```

**Expected output:**
```javascript
const { ref, computed } = __tsm__.require('vue')
```

(Type imports should be stripped since they don't exist at runtime)

## Affected Use Cases

- Any plugin using `import { value, type Type } from 'tsm:module'` syntax
- Vue SFC files with `<script setup lang="ts">` that use inline type imports

## Proposed Solution

In `tsmPlugin`, when transforming imports:

1. Parse the import specifiers
2. Filter out any specifiers that start with `type ` (inline type imports)
3. Also filter out `import type { ... }` statements entirely (type-only imports)
4. Only transform value imports to `__tsm__.require()`

## Workaround

Currently, users must separate type imports:

```typescript
// Instead of:
import { ref, computed, type Ref } from 'tsm:vue'

// Use:
import { ref, computed } from 'tsm:vue'
import type { Ref } from 'vue'
```

This is tedious and error-prone for large codebases.
