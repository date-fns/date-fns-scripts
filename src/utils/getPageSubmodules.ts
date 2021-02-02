import { Submodule } from '@date-fns/date-fns-db'

export function getPageSubmodules(
  fpAvailableForVersion: boolean,
  type: 'markdown' | 'jsdoc',
  kind?: 'function' | 'typedef',
  isFPFn?: boolean
) {
  if (!fpAvailableForVersion) {
    return [Submodule.Default]
  }

  if (type === 'markdown') {
    return [Submodule.Default, Submodule.FP]
  }

  if (kind === 'typedef') {
    return [Submodule.Default, Submodule.FP]
  }

  return isFPFn ? [Submodule.FP] : [Submodule.Default]
}
