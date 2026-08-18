import { describe, expect, mock, test } from 'bun:test'

mock.module('bun:bundle', () => ({ feature: () => false }))

const { SettingsSchema } = await import('../../utils/settings/types.js')

describe('Union settings schema', () => {
  test('accepts an omitted or disabled Union configuration', () => {
    expect(SettingsSchema().safeParse({}).success).toBe(true)
    expect(
      SettingsSchema().safeParse({
        union: {
          enabled: false,
          defaultLevel: 'L1',
          implementerModel: 'glm',
        },
      }).success,
    ).toBe(true)
  })

  test('rejects unsupported Union levels', () => {
    expect(
      SettingsSchema().safeParse({
        union: { enabled: true, defaultLevel: 'L9' },
      }).success,
    ).toBe(false)
  })

  test('rejects an empty implementer model', () => {
    expect(
      SettingsSchema().safeParse({
        union: { enabled: true, implementerModel: '   ' },
      }).success,
    ).toBe(false)
  })
})
