import type { Command, LocalCommandCall } from '../types/command.js'
import { PRISM_DISPLAY_VERSION } from '../constants/branding.js'

const call: LocalCommandCall = async () => {
  return {
    type: 'text',
    value: MACRO.BUILD_TIME
      ? `${PRISM_DISPLAY_VERSION} (engine ${MACRO.VERSION}, built ${MACRO.BUILD_TIME})`
      : `${PRISM_DISPLAY_VERSION} (engine ${MACRO.VERSION})`,
  }
}

const version = {
  type: 'local',
  name: 'version',
  description:
    'Print the version this session is running (not what autoupdate downloaded)',
  // Was Ant-only upstream; for fork subscribers we want this universally
  // available — version info is harmless and useful for bug reports.
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default version
