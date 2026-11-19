#!/usr/bin/env node
// Large public benchmarks are downloaded, never committed (GitHub rejects files over 100 MB).
// The five verification suites in this repository run without them; the dataset-backed evals skip.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const wanted = [
  {
    file: join(root, 'eval', 'locomo10.json'),
    url: 'https://github.com/snap-research/locomo/raw/main/data/locomo10.json',
    note: 'LoCoMo (ACL 2024), snap-research/locomo',
  },
  {
    file: join(root, 'eval', 'longmemeval_s.json'),
    url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s',
    note: 'LongMemEval-S, xiaowu0162/longmemeval (MIT)',
  },
]

let missing = 0
for (const item of wanted) {
  if (existsSync(item.file)) {
    console.log('present  ' + item.file)
  } else {
    missing += 1
    console.log('missing  ' + item.file)
    console.log('         curl -L -o "' + item.file + '" "' + item.url + '"')
    console.log('         source: ' + item.note)
  }
}
if (missing > 0) {
  console.log('\n' + missing + ' dataset(s) missing: dataset-backed evals will skip, everything else still runs.')
} else {
  console.log('\nall datasets present')
}
