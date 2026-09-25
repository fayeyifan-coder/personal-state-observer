import assert from 'node:assert/strict'

const answers = {}
const show = (q) => {
  if (!q) return false
  if (!q.showWhen) return true
  const all = q.showWhen.all ?? []
  return all.every(c => {
    const actual = answers[c.field]
    if (c.op === 'lte') return actual != null && Number(actual) <= Number(c.value)
    if (c.op === 'gte') return actual != null && Number(actual) >= Number(c.value)
    if (c.op === 'includes') return Array.isArray(actual) && actual.includes(c.value)
    return true
  })
}
assert.equal(show({ id:'x' }), true)
assert.equal(show({ id:'x', showWhen:{all:[{field:'sleepQuality',op:'lte',value:3}]} }), false)
answers.sleepQuality = 2
assert.equal(show({ id:'x', showWhen:{all:[{field:'sleepQuality',op:'lte',value:3}]} }), true)
answers.sleepProblem = ['hunger']
assert.equal(show({ id:'x', showWhen:{all:[{field:'sleepProblem',op:'includes',value:'hunger'}]} }), true)
console.log('logic tests passed')
