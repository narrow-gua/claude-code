import type { Command } from '../../commands.js'

const union = {
  type: 'local-jsx',
  name: 'union',
  description: 'Control Union planner/implementer authority levels',
  argumentHint: '[on|off|status|l0|l1|l2|l3|model <name|inherit>]',
  immediate: true,
  load: () => import('./union.js'),
} satisfies Command

export default union
