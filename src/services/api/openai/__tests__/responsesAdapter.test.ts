import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../../tests/mocks/debug'
import { formatOpenAIPromptCacheKey } from '../openaiShared.js'
import { calculateCacheHitRate } from '../../../../utils/cacheWarning.js'

mock.module('src/utils/debug.ts', debugMock)

const {
  buildResponsesRequest,
  createChatGPTResponsesStream,
  extractUsage,
  getResponsesCacheFingerprint,
} = await import('../responsesAdapter.js')

describe('buildResponsesRequest', () => {
  test('rejects an empty model before any network request can be made', () => {
    expect(() =>
      buildResponsesRequest({
        model: '   ',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
        toolChoice: undefined,
      }),
    ).toThrow('requires a non-empty model')
  })

  test('includes max reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'max',
    })

    expect(request.reasoning).toEqual({ effort: 'max' })
  })

  test('includes reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'xhigh',
    })

    expect(request.reasoning).toEqual({ effort: 'xhigh' })
  })

  test('does not include unsupported max_output_tokens parameter', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
    }) as Record<string, unknown>

    expect('max_output_tokens' in request).toBe(false)
  })

  test('includes stable prompt_cache_key for session-sticky cache routing', () => {
    const key = formatOpenAIPromptCacheKey('session-abc-123')
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })

    expect(request.prompt_cache_key).toBe('prism:session-abc-123')
  })

  test('defaults prompt_cache_key to process-stable fallback when not overridden', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
    })
    const again = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'next' }],
      tools: [],
      toolChoice: undefined,
    })

    expect(request.prompt_cache_key).toMatch(/^prism:[0-9a-f-]+$/i)
    expect(again.prompt_cache_key).toBe(request.prompt_cache_key)
  })

  test('prompt_cache_key is stable across turns (not derived from messages)', () => {
    const key = formatOpenAIPromptCacheKey('same-session')
    const turn1 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'first' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })
    const turn2 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })

    expect(turn1.prompt_cache_key).toBe(turn2.prompt_cache_key)
    expect(turn1.prompt_cache_key).toBe('prism:same-session')
  })
})

describe('getResponsesCacheFingerprint', () => {
  test('stays stable when later conversation turns are appended', () => {
    const first = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'stable instructions' },
        { role: 'user', content: 'first question' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'read', parameters: { type: 'object' } },
        },
      ],
      toolChoice: undefined,
    })
    const later = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'stable instructions' },
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'follow-up' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'read', parameters: { type: 'object' } },
        },
      ],
      toolChoice: undefined,
    })

    expect(getResponsesCacheFingerprint(first)).toEqual(
      getResponsesCacheFingerprint(later),
    )
  })

  test('changes when instructions or tools change', () => {
    const base = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'instructions-a' },
        { role: 'user', content: 'question' },
      ],
      tools: [],
      toolChoice: undefined,
    })
    const changedInstructions = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'instructions-b' },
        { role: 'user', content: 'question' },
      ],
      tools: [],
      toolChoice: undefined,
    })
    const changedTools = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'instructions-a' },
        { role: 'user', content: 'question' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'read', parameters: { type: 'object' } },
        },
      ],
      toolChoice: undefined,
    })

    expect(getResponsesCacheFingerprint(base).instructions).not.toBe(
      getResponsesCacheFingerprint(changedInstructions).instructions,
    )
    expect(getResponsesCacheFingerprint(base).tools).not.toBe(
      getResponsesCacheFingerprint(changedTools).tools,
    )
  })
})

describe('createChatGPTResponsesStream', () => {
  test('uses a custom API profile instead of requiring ChatGPT OAuth', async () => {
    let capturedUrl = ''
    let capturedHeaders: HeadersInit | undefined
    let capturedBody: Record<string, unknown> | undefined
    let fetchCount = 0
    const doneOnlyBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        // Deliberately leave the connection open. Some compatible gateways
        // keep HTTP alive after [DONE]; the adapter must still terminate.
      },
    })
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
    })

    const stream = await createChatGPTResponsesStream({
      request,
      signal: new AbortController().signal,
      baseUrl: 'https://responses.example.com/v1/',
      authKey: 'test-profile-key',
      querySource: 'workflow',
      agentId: 'agent-test',
      fetchOverride: (async (input, init) => {
        fetchCount++
        capturedUrl = String(input)
        capturedHeaders = init?.headers
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(doneOnlyBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }) as typeof fetch,
    })

    expect(capturedUrl).toBe('https://responses.example.com/v1/responses')
    expect(capturedHeaders).toMatchObject({
      Authorization: 'Bearer test-profile-key',
      'Content-Type': 'application/json',
      'x-prism-query-source': 'workflow',
      'x-prism-agent-id': 'agent-test',
    })
    expect(capturedHeaders).toMatchObject({
      'x-client-request-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(capturedBody?.model).toBe('gpt-5.6-sol')
    expect(fetchCount).toBe(1)
    expect(await stream[Symbol.asyncIterator]().next()).toEqual({
      done: true,
      value: undefined,
    })
  })
})

describe('extractUsage (OpenAI Responses → Anthropic usage)', () => {
  test('subtracts cached_tokens so hit rate uses OpenAI total as denominator', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 20_000 },
      },
    })

    expect(usage).toEqual({
      input_tokens: 10_000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 20_000,
    })

    // Was 40% under the double-count bug; correct is 66.7%.
    const hitRate = calculateCacheHitRate(usage)
    expect(hitRate).toBeCloseTo((20_000 / 30_000) * 100, 5)
  })

  test('full cache hit can report 100% (not capped at 50%)', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 30_000 },
      },
    })

    expect(usage.input_tokens).toBe(0)
    expect(usage.cache_read_input_tokens).toBe(30_000)
    expect(calculateCacheHitRate(usage)).toBe(100)
  })

  test('maps cache_write_tokens to cache_creation without double-counting total', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 10_000,
        output_tokens: 10,
        input_tokens_details: {
          cached_tokens: 6_000,
          cache_write_tokens: 2_000,
        },
      },
    })

    expect(usage).toEqual({
      input_tokens: 2_000,
      output_tokens: 10,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 6_000,
    })
    // segments sum to OpenAI total
    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(10_000)
    expect(calculateCacheHitRate(usage)).toBeCloseTo(60, 5)
  })

  test('clamps overlapping write/read that exceed total input', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 5_000,
        output_tokens: 0,
        input_tokens_details: {
          cached_tokens: 4_000,
          cache_write_tokens: 4_000,
        },
      },
    })

    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(5_000)
    expect(usage.cache_read_input_tokens).toBe(4_000)
    expect(usage.cache_creation_input_tokens).toBe(1_000)
    expect(usage.input_tokens).toBe(0)
  })
})
